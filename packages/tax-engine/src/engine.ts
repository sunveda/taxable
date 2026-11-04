import {
  addYears,
  compareLocalDates,
  localDate,
  parseInstant,
  allocateProportionally,
  ZERO,
  type AccountId,
  type AssetId,
  type Decimal,
  type EventId,
  type Timestamp,
} from '@svdt/domain';
import {
  UnsupportedTaxYearError,
  type CostBasisMethod,
  type RuleId,
  type YearRules,
} from '@svdt/rule-packs';
import {
  effectsOfEvent,
  effectsOfOpeningPosition,
  type Effect,
  type EffectContext,
} from './effects';
import { sortIssues } from './issues';
import { resolveOverrides } from './overrides';
import { createPool, TotalAveragePool, type Pool } from './pools';
import { summarize } from './summary';
import type {
  CalculationInput,
  CalculationResult,
  ConsumedPart,
  Disposal,
  ExpenseRecord,
  Holding,
  IncomeRecord,
  Issue,
  Lot,
} from './types';
import { Valuer } from './valuation';

export const ENGINE_VERSION = '0.2.0';

/** One thing that happens at a point in time: a ledger event or a declared opening position. */
interface Item {
  ms: number;
  /**
   * Order within the same instant: opening positions (0), then events that acquire units
   * (1), then everything else (2). Exports often share a timestamp between a buy and a sell
   * and list rows newest-first, so file order and ids can't be trusted for ties.
   */
  rank: number;
  id: string;
  eventId: EventId | null;
  timestamp: Timestamp;
  year: number;
  effects: Effect[];
}

/**
 * Computes a tax year. Pure and deterministic (ADR-0006): no I/O, no clock, no randomness;
 * the same input always yields the same output.
 */
export function calculate(input: CalculationInput): CalculationResult {
  const pack = input.rulePack;
  const timeZone = pack.timeZoneFromUser && input.timeZone ? input.timeZone : pack.defaultTimeZone;
  const targetRules = pack.yearRules(input.taxYear);
  const scope = targetRules.basisScope;
  const valuer = new Valuer(pack.reportingCurrency, input.prices ?? []);
  const yearOf = (ts: Timestamp): number => localDate(ts, timeZone).year;

  const issues: Issue[] = [];
  const issueIds = new Set<string>();
  const addIssue = (issue: Omit<Issue, 'id'>, key: string): void => {
    let id = `${issue.kind}:${key}`;
    for (let n = 2; issueIds.has(id); n++) id = `${issue.kind}:${key}:${n}`;
    issueIds.add(id);
    issues.push({ id, ...issue });
  };

  // --- Override layer (ADR-0009) ----------------------------------------------------------
  const resolved = resolveOverrides(input.events, input.overrides ?? [], pack.reportingCurrency);
  const eventsById = new Map(resolved.events.map((e) => [e.id, e]));
  for (const o of resolved.outcomes) {
    if (o.status === 'event_not_found') {
      addIssue(
        {
          kind: 'orphaned_override',
          eventIds: [o.eventId],
          asset: null,
          taxYear: input.taxYear,
          impact: { min: ZERO, max: ZERO },
          impactKnown: false,
          message: `Correction ${o.overrideId} points to event ${o.eventId}, which is no longer in the imported data (it may have been re-imported under a different id). It was not applied.`,
          params: { overrideId: o.overrideId, eventId: o.eventId },
        },
        o.overrideId,
      );
    } else if (o.status === 'not_applicable') {
      const event = eventsById.get(o.eventId)!;
      const year = yearOf(event.timestamp);
      if (year > input.taxYear) continue;
      addIssue(
        {
          kind: 'invalid_override',
          eventIds: [o.eventId],
          asset: null,
          taxYear: year,
          impact: { min: ZERO, max: ZERO },
          impactKnown: true,
          message: `Correction ${o.overrideId} can't be applied to event ${o.eventId} (${o.reason ?? 'invalid'}); it was ignored.`,
          params: { overrideId: o.overrideId, eventId: o.eventId, reason: o.reason ?? '' },
        },
        o.overrideId,
      );
    }
  }

  // --- Cost-basis method per asset ------------------------------------------------------
  const methods: Record<AssetId, CostBasisMethod> = {};
  const methodFor = (asset: AssetId): CostBasisMethod => {
    const existing = methods[asset];
    if (existing) return existing;
    const requested =
      input.methods?.byAsset?.[asset] ?? input.methods?.default ?? targetRules.costBasis.default;
    let method = requested;
    const allowed = targetRules.costBasis.allowed.includes(requested);
    const needsPooling = requested === 'TOTAL_AVERAGE' && scope !== 'per_user';
    if (!allowed || needsPooling) {
      method = targetRules.costBasis.default;
      addIssue(
        {
          kind: 'method_not_allowed',
          eventIds: [],
          asset,
          taxYear: input.taxYear,
          impact: { min: ZERO, max: ZERO },
          impactKnown: true,
          message: `${requested} is not available for ${asset} under ${pack.name}; using ${method}.`,
          params: { requested, used: method },
        },
        asset,
      );
    }
    methods[asset] = method;
    return method;
  };

  // --- Collect and order everything up to the end of the tax year -----------------------
  const rulesCache = new Map<number, YearRules>();
  const rulesFor = (year: number): YearRules => {
    let r = rulesCache.get(year);
    if (!r) {
      r = historyRules(year);
      if (r.basisScope !== scope) {
        throw new Error(
          `${pack.id}: basis scope changes between ${year} and ${input.taxYear}; not supported yet`,
        );
      }
      rulesCache.set(year, r);
    }
    return r;
  };
  /**
   * Rules for a year of history. Years before the pack's first supported year (e.g. a 2013
   * purchase under a pack that starts in 2014) use the earliest supported rules, and the
   * fix queue says so, rather than failing the whole calculation.
   */
  function historyRules(year: number): YearRules {
    try {
      return pack.yearRules(year);
    } catch (err) {
      if (!(err instanceof UnsupportedTaxYearError) || year >= pack.supportedYears.from) throw err;
      const fallback = pack.supportedYears.from;
      addIssue(
        {
          kind: 'unsupported_history_year',
          eventIds: [],
          asset: null,
          taxYear: year,
          impact: { min: ZERO, max: ZERO },
          impactKnown: false,
          message: `${pack.name} rules for ${year} are not modelled; activity from ${year} was processed with the ${fallback} rules. Check the cost basis it carries forward.`,
          params: { year: String(year), appliedYear: String(fallback) },
        },
        String(year),
      );
      return pack.yearRules(fallback);
    }
  }
  const ctxFor = (year: number): EffectContext => ({
    rules: rulesFor(year),
    valuer,
    reportingCurrency: pack.reportingCurrency,
    withdrawals: resolved.withdrawals,
  });

  const items: Item[] = [];
  const firstEventMs = new Map<AssetId, number>();
  for (const e of resolved.events) {
    const year = yearOf(e.timestamp);
    if (year > input.taxYear) continue;
    const ms = parseInstant(e.timestamp);
    const effects = effectsOfEvent(ctxFor(year), e);
    items.push({
      ms,
      rank: effects.some((f) => f.type === 'acquire') ? 1 : 2,
      id: e.id,
      eventId: e.id,
      timestamp: e.timestamp,
      year,
      effects,
    });
  }
  for (const item of items) {
    for (const eff of item.effects) {
      if (eff.type === 'issue') continue;
      const prev = firstEventMs.get(eff.asset);
      if (prev === undefined || item.ms < prev) firstEventMs.set(eff.asset, item.ms);
    }
  }
  for (const p of input.openingPositions ?? []) {
    const year = yearOf(p.asOf);
    if (year > input.taxYear) continue;
    const ms = parseInstant(p.asOf);
    const method = methodFor(p.asset);
    const replaces =
      scope === 'per_account' && (method === 'FIFO' || method === 'LIFO' || method === 'HIFO');
    const id = `opening:${p.accountId}:${p.asset}:${p.asOf}`;
    const first = firstEventMs.get(p.asset);
    if (!replaces && first !== undefined && first < ms) {
      addIssue(
        {
          kind: 'opening_position_order',
          eventIds: [],
          asset: p.asset,
          taxYear: year,
          impact: { min: ZERO, max: ZERO },
          impactKnown: true,
          message: `Opening position for ${p.asset} is dated after earlier activity; with pooled basis it is added as an acquisition, not a replacement.`,
          params: { asOf: p.asOf },
        },
        id,
      );
    }
    const ruleRefs =
      p.reason === 'us_safe_harbor_2024_28' && pack.rules['us.safe_harbor']
        ? ['us.safe_harbor']
        : [];
    items.push({
      ms,
      rank: 0,
      id,
      eventId: null,
      timestamp: p.asOf,
      year,
      effects: effectsOfOpeningPosition(p, replaces, ruleRefs),
    });
  }
  items.sort((a, b) => a.ms - b.ms || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  // --- State ------------------------------------------------------------------------------
  const pools = new Map<string, Pool>();
  const physical = new Map<string, Decimal>();
  const lots: Lot[] = [];
  const disposals: Disposal[] = [];
  const income: IncomeRecord[] = [];
  const expenses: ExpenseRecord[] = [];
  const holdingKey = (account: AccountId, asset: AssetId): string => `${account}\u0000${asset}`;
  const poolKey = (account: AccountId, asset: AssetId): string =>
    scope === 'per_account' ? holdingKey(account, asset) : `*\u0000${asset}`;
  const poolFor = (account: AccountId, asset: AssetId): Pool => {
    const key = poolKey(account, asset);
    let pool = pools.get(key);
    if (!pool) {
      pool = createPool(asset, methodFor(asset));
      pools.set(key, pool);
    }
    return pool;
  };
  const adjustPhysical = (account: AccountId, asset: AssetId, delta: Decimal): void => {
    const key = holdingKey(account, asset);
    physical.set(key, (physical.get(key) ?? ZERO).plus(delta));
  };

  const termOf = (
    rules: YearRules,
    acquiredAt: Timestamp | null,
    disposedAt: Timestamp,
  ): 'short' | 'long' | null => {
    if (!rules.holdingPeriod || !acquiredAt) return null;
    const acquired = localDate(acquiredAt, timeZone);
    const disposed = localDate(disposedAt, timeZone);
    return compareLocalDates(disposed, addYears(acquired, rules.holdingPeriod.longTermAfterYears)) >
      0
      ? 'long'
      : 'short';
  };

  const shortfallIssue = (
    item: Item,
    asset: AssetId,
    shortfall: Decimal,
    impactMin: Decimal | null,
    what: string,
  ): void => {
    addIssue(
      {
        kind: 'negative_balance',
        eventIds: item.eventId ? [item.eventId] : [],
        asset,
        taxYear: item.year,
        impact: { min: impactMin ?? ZERO, max: ZERO },
        impactKnown: impactMin !== null,
        message: `${what} ${shortfall.toString()} ${asset} more than the history shows was held; that part is given a cost basis of 0. Import missing history or add an opening balance.`,
        params: { asset, shortfall: shortfall.toString() },
      },
      `${item.id}:${asset}`,
    );
  };

  const lotsById = new Map<string, Lot>();
  const newLot = (fields: Omit<Lot, 'id'>, id: string): Lot => {
    const lot: Lot = { id, ...fields };
    if (lot.quantity.isZero()) return lot;
    lots.push(lot);
    lotsById.set(id, lot);
    return lot;
  };
  const lotRules = (lotId: string | null): RuleId[] =>
    lotId ? (lotsById.get(lotId)?.ruleRefs ?? []) : [];

  // --- Apply effects ----------------------------------------------------------------------
  const apply = (item: Item, eff: Effect, seq: number): void => {
    const rules = rulesFor(item.year);
    const reportable = item.year === input.taxYear;
    const baseId = item.eventId ?? item.id;
    switch (eff.type) {
      case 'issue': {
        const { type: _t, ...rest } = eff;
        addIssue(
          { ...rest, eventIds: item.eventId ? [item.eventId] : [], taxYear: item.year },
          `${baseId}:${seq}`,
        );
        return;
      }
      case 'acquire': {
        const lot = newLot(
          {
            accountId: eff.accountId,
            asset: eff.asset,
            quantity: eff.quantity,
            costBasis: eff.costBasis,
            acquiredAt: eff.acquiredAt,
            origin: eff.origin,
            eventId: item.eventId,
            parentLotId: null,
            ruleRefs: eff.ruleRefs,
          },
          `${baseId}#${seq}`,
        );
        poolFor(eff.accountId, eff.asset).add(lot);
        adjustPhysical(eff.accountId, eff.asset, eff.quantity);
        return;
      }
      case 'dispose': {
        const pool = poolFor(eff.accountId, eff.asset);
        const { parts, shortfall } = pool.take(eff.quantity);
        adjustPhysical(eff.accountId, eff.asset, eff.quantity.negated());
        const all: (ConsumedPart & { shortfall: boolean })[] = parts.map((p) => ({
          ...p,
          shortfall: false,
        }));
        if (!shortfall.isZero()) {
          const pooled = pool.method === 'MOVING_AVERAGE' || pool.method === 'TOTAL_AVERAGE';
          all.push({
            lotId: null,
            quantity: shortfall,
            costBasis: ZERO,
            acquiredAt: pooled ? null : item.timestamp,
            shortfall: true,
          });
        }
        const quantities = all.map((p) => p.quantity);
        const proceeds = allocateProportionally(eff.proceeds, quantities);
        const costs = allocateProportionally(eff.sellingCosts, quantities);
        all.forEach((part, i) => {
          const p = proceeds[i] ?? ZERO;
          const c = costs[i] ?? ZERO;
          const term = termOf(rules, part.acquiredAt, item.timestamp);
          if (part.shortfall) {
            // With unpriced proceeds, p − c is 0 only for lack of a price: fall back to an
            // estimate of the units, or mark the impact unknown.
            const est = eff.proceedsKnown
              ? p.minus(c)
              : valuer.estimate(
                  { asset: eff.asset, quantity: part.quantity.toString() },
                  item.timestamp,
                );
            shortfallIssue(
              item,
              eff.asset,
              part.quantity,
              est ? est.negated() : null,
              'Disposes of',
            );
          }
          if (!reportable) return;
          disposals.push({
            id: `${baseId}#${seq}.${i}`,
            eventId: item.eventId ?? item.id,
            kind: eff.kind,
            accountId: eff.accountId,
            asset: eff.asset,
            quantity: part.quantity,
            disposedAt: item.timestamp,
            acquiredAt: part.acquiredAt,
            taxYear: item.year,
            proceeds: p,
            sellingCosts: c,
            costBasis: part.costBasis,
            gain: p.minus(c).minus(part.costBasis),
            term,
            lotId: part.lotId,
            basisShortfall: part.shortfall,
            ruleRefs: dedupe([
              ...eff.ruleRefs,
              ...lotRules(part.lotId),
              rules.costBasis.rule,
              rules.basisScopeRule,
              ...(term && rules.holdingPeriod ? [rules.holdingPeriod.rule] : []),
            ]),
          });
        });
        return;
      }
      case 'move': {
        adjustPhysical(eff.fromAccountId, eff.asset, eff.quantity.negated());
        adjustPhysical(eff.toAccountId, eff.asset, eff.quantity);
        if (scope === 'per_user') return; // same pool: basis is unaffected
        const { parts, shortfall } = poolFor(eff.fromAccountId, eff.asset).take(eff.quantity);
        const dest = poolFor(eff.toAccountId, eff.asset);
        parts.forEach((part, i) => {
          const lot = newLot(
            {
              accountId: eff.toAccountId,
              asset: eff.asset,
              quantity: part.quantity,
              costBasis: part.costBasis,
              acquiredAt: part.acquiredAt ?? item.timestamp,
              origin: 'transfer',
              eventId: item.eventId,
              parentLotId: part.lotId,
              ruleRefs: lotRules(part.lotId),
            },
            part.lotId ? `${part.lotId}>${baseId}` : `${baseId}#${seq}.${i}`,
          );
          dest.add(lot);
        });
        if (!shortfall.isZero()) {
          const market = valuer.valueOrEstimate(
            { asset: eff.asset, quantity: shortfall.toString() },
            item.timestamp,
          );
          shortfallIssue(item, eff.asset, shortfall, market ? market.negated() : null, 'Transfers');
          dest.add(
            newLot(
              {
                accountId: eff.toAccountId,
                asset: eff.asset,
                quantity: shortfall,
                costBasis: ZERO,
                acquiredAt: item.timestamp,
                origin: 'shortfall',
                eventId: item.eventId,
                parentLotId: null,
                ruleRefs: [],
              },
              `${baseId}#${seq}.shortfall`,
            ),
          );
        }
        return;
      }
      case 'remove': {
        const { parts, shortfall } = poolFor(eff.accountId, eff.asset).take(eff.quantity);
        adjustPhysical(eff.accountId, eff.asset, eff.quantity.negated());
        const removedBasis = parts.reduce((acc, p) => acc.plus(p.costBasis), ZERO);
        if (!shortfall.isZero()) shortfallIssue(item, eff.asset, shortfall, null, 'Sends');
        if (eff.confirmedOwnWallet) return;
        const potentialGain = eff.marketValue ? eff.marketValue.minus(removedBasis) : ZERO;
        addIssue(
          {
            kind: 'unmatched_withdrawal',
            eventIds: item.eventId ? [item.eventId] : [],
            asset: eff.asset,
            taxYear: item.year,
            impact: { min: ZERO, max: potentialGain.isPositive() ? potentialGain : ZERO },
            impactKnown: eff.marketValue !== null,
            message: `${eff.quantity.toString()} ${eff.asset} left to a wallet that isn't connected. Treated as a move to your own wallet (not taxable). If it was a payment or sale, it is taxable.`,
            params: { asset: eff.asset, quantity: eff.quantity.toString() },
            // Spec §4: the default is a move to a wallet the user owns, which isn't a
            // disposal. Accepting it confirms what the engine already assumes.
            ...(eff.withdrawal && item.eventId
              ? {
                  suggestedResolution: {
                    override: {
                      eventId: item.eventId,
                      action: { type: 'classify_withdrawal' as const, as: 'own_wallet' as const },
                    },
                    confidence: 0.5,
                    message: `Confirm this went to a wallet you own. If it was sold or spent, classify it as spent instead.`,
                    params: {},
                  },
                }
              : {}),
          },
          `${baseId}:${seq}`,
        );
        return;
      }
      case 'reset': {
        const key = holdingKey(eff.accountId, eff.asset);
        const held = physical.get(key) ?? ZERO;
        const declared = eff.lots.reduce((acc, l) => acc.plus(l.quantity), ZERO);
        if (!held.equals(declared)) {
          addIssue(
            {
              kind: 'opening_position_mismatch',
              eventIds: [],
              asset: eff.asset,
              taxYear: item.year,
              impact: { min: ZERO, max: ZERO },
              impactKnown: false,
              message: `Declared lots for ${eff.asset} in ${eff.accountId} total ${declared.toString()}, but the history shows ${held.toString()} held at that time.`,
              params: {
                declared: declared.toString(),
                held: held.toString(),
                accountId: eff.accountId,
              },
            },
            item.id,
          );
        }
        const pool = poolFor(eff.accountId, eff.asset);
        pool.reset();
        eff.lots.forEach((l, i) => {
          pool.add(
            newLot(
              {
                accountId: eff.accountId,
                asset: eff.asset,
                quantity: l.quantity,
                costBasis: l.costBasis,
                acquiredAt: l.acquiredAt,
                origin: 'opening_position',
                eventId: null,
                parentLotId: null,
                ruleRefs: eff.ruleRefs,
              },
              `${item.id}#${i}`,
            ),
          );
        });
        return;
      }
      case 'income': {
        if (!reportable) return;
        income.push({
          id: `${baseId}#${seq}`,
          eventId: item.eventId ?? item.id,
          accountId: eff.accountId,
          asset: eff.asset,
          incomeType: eff.incomeType,
          quantity: eff.quantity,
          receivedAt: item.timestamp,
          taxYear: item.year,
          value: eff.value,
          taxable: eff.taxable,
          ruleRefs: eff.ruleRefs,
        });
        return;
      }
      case 'expense': {
        if (!reportable) return;
        expenses.push({
          id: `${baseId}#${seq}`,
          eventId: item.eventId ?? item.id,
          accountId: eff.accountId,
          asset: eff.asset,
          quantity: eff.quantity,
          paidAt: item.timestamp,
          taxYear: item.year,
          value: eff.value,
          ruleRefs: eff.ruleRefs,
        });
        return;
      }
    }
  };

  // --- Run year by year (total average needs each year's acquisitions up front) ----------
  const firstYear = items.reduce((min, i) => Math.min(min, i.year), input.taxYear);
  for (let year = firstYear; year <= input.taxYear; year++) {
    const yearItems = items.filter((i) => i.year === year);
    const announced = new Map<string, { quantity: Decimal; cost: Decimal }>();
    for (const item of yearItems) {
      for (const eff of item.effects) {
        if (eff.type !== 'acquire' || methodFor(eff.asset) !== 'TOTAL_AVERAGE') continue;
        poolFor(eff.accountId, eff.asset);
        const key = poolKey(eff.accountId, eff.asset);
        const a = announced.get(key) ?? { quantity: ZERO, cost: ZERO };
        announced.set(key, {
          quantity: a.quantity.plus(eff.quantity),
          cost: a.cost.plus(eff.costBasis),
        });
      }
    }
    for (const [key, pool] of pools) {
      if (pool instanceof TotalAveragePool) {
        const a = announced.get(key) ?? { quantity: ZERO, cost: ZERO };
        pool.beginYear(a.quantity, a.cost);
      }
    }
    for (const item of yearItems) item.effects.forEach((eff, seq) => apply(item, eff, seq));
    for (const pool of pools.values()) {
      if (pool instanceof TotalAveragePool) pool.endYear();
    }
  }

  // --- Output -----------------------------------------------------------------------------
  const holdings: Holding[] = [];
  for (const [key, pool] of pools) {
    const quantity = pool.quantity();
    const costBasis = pool.costBasis();
    if (quantity.isZero() && costBasis.isZero()) continue;
    const accountId = scope === 'per_account' ? (key.split('\u0000')[0] ?? null) : null;
    holdings.push({ accountId, asset: pool.asset, method: pool.method, quantity, costBasis });
  }
  holdings.sort((a, b) => cmp(a.asset, b.asset) || cmp(a.accountId ?? '', b.accountId ?? ''));

  return {
    engineVersion: ENGINE_VERSION,
    rulePack: { id: pack.id, version: pack.version, status: pack.status },
    taxYear: input.taxYear,
    reportingCurrency: pack.reportingCurrency,
    timeZone,
    methods,
    disposals,
    income,
    expenses,
    lots,
    holdings,
    issues: sortIssues(issues),
    overrides: resolved.outcomes,
    summary: summarize(pack, { disposals, income, expenses }, timeZone),
  };
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function dedupe(ids: RuleId[]): RuleId[] {
  return [...new Set(ids)];
}
