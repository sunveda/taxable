import {
  dec,
  fiatAsset,
  parseInstant,
  type AssetAmount,
  type CurrencyCode,
  type Decimal,
  type EventId,
  type LedgerEvent,
} from '@svdt/domain';
import type { Override, OverrideOutcome } from './types';

/** How the user says an external withdrawal should be treated. */
export interface WithdrawalTreatment {
  as: 'own_wallet' | 'spent';
  /** Stated proceeds in the report currency; otherwise valued at market. */
  proceeds: Decimal | null;
}

export interface ResolvedOverrides {
  /** Input events with price and basis overrides written into them. Same ids, same order. */
  events: LedgerEvent[];
  withdrawals: Map<EventId, WithdrawalTreatment>;
  /** One per input override, oldest first. */
  outcomes: OverrideOutcome[];
}

/**
 * Applies the override layer (ADR-0009) to the normalized events.
 *
 * Overrides are append-only. For each target (event + what it changes) the latest active
 * override wins (by `createdAt`, then input order); earlier ones are `superseded`, and a `revoke` deactivates the override it
 * names. Overrides that can't apply never take a slot, so a mistyped correction can't
 * displace a valid earlier one. Pure: the same events and overrides give the same result.
 */
export function resolveOverrides(
  events: readonly LedgerEvent[],
  overrides: readonly Override[],
  reportingCurrency: CurrencyCode,
): ResolvedOverrides {
  const byId = new Map<EventId, LedgerEvent>(events.map((e) => [e.id, e]));
  // Stable sort: overrides with the same timestamp keep their input order, which callers
  // set to insertion order (timestamps can tie; ids carry no order).
  const ordered = [...overrides].sort(
    (a, b) => parseInstant(a.createdAt) - parseInstant(b.createdAt),
  );
  const status = new Map<string, OverrideOutcome>();
  const set = (o: Override, s: OverrideOutcome['status'], reason?: string): void => {
    status.set(o.id, {
      overrideId: o.id,
      eventId: o.eventId,
      status: s,
      ...(reason ? { reason } : {}),
    });
  };

  // Validate, and collect revocations.
  const valid: Override[] = [];
  const revoked = new Set<string>();
  const known = new Map(ordered.map((o) => [o.id, o]));
  for (const o of ordered) {
    const event = byId.get(o.eventId);
    if (!event) {
      set(o, 'event_not_found');
      continue;
    }
    const problem = checkOverride(o, event, known, reportingCurrency);
    if (problem) {
      set(o, 'not_applicable', problem);
      continue;
    }
    if (o.action.type === 'revoke') {
      revoked.add(o.action.overrideId);
      set(o, 'applied');
    } else {
      valid.push(o);
    }
  }

  // Latest active override per slot wins.
  const winners = new Map<string, Override>();
  for (const o of valid) {
    if (revoked.has(o.id)) {
      set(o, 'revoked');
      continue;
    }
    const slot = slotOf(o);
    const prev = winners.get(slot);
    if (prev) set(prev, 'superseded');
    winners.set(slot, o);
    set(o, 'applied');
  }

  const patched = new Map<EventId, LedgerEvent>();
  const withdrawals = new Map<EventId, WithdrawalTreatment>();
  for (const o of winners.values()) {
    const event = patched.get(o.eventId) ?? byId.get(o.eventId)!;
    const action = o.action;
    switch (action.type) {
      case 'set_unit_price': {
        const price = dec(action.unitPrice);
        const priced = (a: AssetAmount): AssetAmount =>
          a.asset === action.asset
            ? {
                ...a,
                value: {
                  amount: dec(a.quantity).times(price).toFixed(),
                  currency: reportingCurrency,
                },
              }
            : a;
        patched.set(o.eventId, mapAmounts(event, priced));
        break;
      }
      case 'set_cost_basis': {
        if (event.kind !== 'external_deposit') break; // checked above
        patched.set(o.eventId, {
          ...event,
          costBasis: { amount: dec(action.costBasis).toFixed(), currency: reportingCurrency },
          ...(action.acquiredAt ? { acquiredAt: action.acquiredAt } : {}),
        });
        break;
      }
      case 'classify_withdrawal':
        withdrawals.set(o.eventId, {
          as: action.as,
          proceeds: action.as === 'spent' && action.proceeds ? dec(action.proceeds) : null,
        });
        break;
      case 'revoke':
        break;
    }
  }

  return {
    events: events.map((e) => patched.get(e.id) ?? e),
    withdrawals,
    outcomes: ordered.map((o) => status.get(o.id)!),
  };
}

function slotOf(o: Override): string {
  const a = o.action;
  switch (a.type) {
    case 'set_unit_price':
      return `${o.eventId}\u0000price\u0000${a.asset}`;
    case 'set_cost_basis':
      return `${o.eventId}\u0000basis`;
    case 'classify_withdrawal':
      return `${o.eventId}\u0000withdrawal`;
    case 'revoke':
      return `${o.eventId}\u0000revoke\u0000${o.id}`;
  }
}

/** Why an override can't apply to its event, or `null` if it can. */
function checkOverride(
  o: Override,
  event: LedgerEvent,
  all: ReadonlyMap<string, Override>,
  reportingCurrency: CurrencyCode,
): string | null {
  const a = o.action;
  switch (a.type) {
    case 'set_unit_price':
      if (a.asset === fiatAsset(reportingCurrency)) return 'report_currency_has_no_price';
      if (!amountsOf(event).some((x) => x.asset === a.asset)) return 'asset_not_in_event';
      return nonNegative(a.unitPrice) ? null : 'invalid_amount';
    case 'set_cost_basis':
      if (event.kind !== 'external_deposit') return 'event_kind_mismatch';
      if (!nonNegative(a.costBasis)) return 'invalid_amount';
      if (a.acquiredAt !== undefined) {
        const at = instantOrNull(a.acquiredAt);
        if (at === null) return 'invalid_timestamp';
        if (at > parseInstant(event.timestamp)) return 'acquired_after_receipt';
      }
      return null;
    case 'classify_withdrawal':
      if (event.kind !== 'external_withdrawal') return 'event_kind_mismatch';
      if (a.proceeds !== undefined && (a.as !== 'spent' || !nonNegative(a.proceeds))) {
        return 'invalid_amount';
      }
      return null;
    case 'revoke': {
      const target = all.get(a.overrideId);
      if (!target || target.eventId !== o.eventId) return 'target_not_found';
      if (target.action.type === 'revoke') return 'cannot_revoke_revoke';
      return null;
    }
  }
}

function amountsOf(e: LedgerEvent): AssetAmount[] {
  switch (e.kind) {
    case 'trade':
      return [e.sent, e.received, ...(e.fee ? [e.fee] : [])];
    case 'transfer':
      return e.fee ? [e.fee] : [];
    case 'income':
    case 'external_deposit':
      return [e.received];
    case 'fee':
      return [e.fee];
    case 'external_withdrawal':
      return [e.sent];
  }
}

function mapAmounts(e: LedgerEvent, f: (a: AssetAmount) => AssetAmount): LedgerEvent {
  switch (e.kind) {
    case 'trade':
      return {
        ...e,
        sent: f(e.sent),
        received: f(e.received),
        ...(e.fee ? { fee: f(e.fee) } : {}),
      };
    case 'transfer':
      return e.fee ? { ...e, fee: f(e.fee) } : e;
    case 'income':
    case 'external_deposit':
      return { ...e, received: f(e.received) };
    case 'fee':
      return { ...e, fee: f(e.fee) };
    case 'external_withdrawal':
      return { ...e, sent: f(e.sent) };
  }
}

function nonNegative(s: string): boolean {
  try {
    const d = dec(s);
    return d.isFinite() && !d.isNegative();
  } catch {
    return false;
  }
}

function instantOrNull(ts: string): number | null {
  try {
    return parseInstant(ts);
  } catch {
    return null;
  }
}
