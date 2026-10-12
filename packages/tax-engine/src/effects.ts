import {
  dec,
  isFiat,
  ZERO,
  type AccountId,
  type AssetAmount,
  type AssetId,
  type Decimal,
  type EventId,
  type IncomeType,
  type LedgerEvent,
  type OpeningPosition,
  type Timestamp,
} from '@svdt/domain';
import type { RuleId, YearRules } from '@svdt/rule-packs';
import type { WithdrawalTreatment } from './overrides';
import type { DisposalKind, IssueKind, LotOrigin, SuggestedResolution } from './types';
import type { Valuer } from './valuation';

/**
 * Effects describe what an event does to holdings, independent of current basis state.
 * Because they don't depend on pools, the engine can compute a year's acquisitions before
 * applying it, which the total-average method (総平均法) needs.
 */
export type Effect =
  | {
      type: 'acquire';
      accountId: AccountId;
      asset: AssetId;
      quantity: Decimal;
      costBasis: Decimal;
      acquiredAt: Timestamp;
      origin: LotOrigin;
      ruleRefs: RuleId[];
    }
  | {
      type: 'dispose';
      kind: DisposalKind;
      accountId: AccountId;
      asset: AssetId;
      quantity: Decimal;
      proceeds: Decimal;
      sellingCosts: Decimal;
      /** False when proceeds or costs were valued at 0 for lack of a price. */
      proceedsKnown: boolean;
      ruleRefs: RuleId[];
    }
  | {
      type: 'move';
      fromAccountId: AccountId;
      toAccountId: AccountId;
      asset: AssetId;
      quantity: Decimal;
    }
  | {
      type: 'remove';
      accountId: AccountId;
      asset: AssetId;
      quantity: Decimal;
      marketValue: Decimal | null;
      /** An external withdrawal (not a non-disposal fee), so the user can classify it. */
      withdrawal: boolean;
      /** The user confirmed it went to a wallet they own: no issue. */
      confirmedOwnWallet: boolean;
    }
  | {
      type: 'income';
      accountId: AccountId;
      asset: AssetId;
      incomeType: IncomeType;
      quantity: Decimal;
      value: Decimal;
      taxable: boolean;
      ruleRefs: RuleId[];
    }
  | {
      type: 'expense';
      accountId: AccountId;
      asset: AssetId;
      quantity: Decimal;
      value: Decimal;
      ruleRefs: RuleId[];
    }
  | {
      type: 'reset';
      accountId: AccountId;
      asset: AssetId;
      lots: { quantity: Decimal; costBasis: Decimal; acquiredAt: Timestamp }[];
      ruleRefs: RuleId[];
    }
  | {
      type: 'issue';
      kind: IssueKind;
      asset: AssetId | null;
      impact: { min: Decimal; max: Decimal };
      impactKnown: boolean;
      message: string;
      params: Record<string, string>;
      suggestedResolution?: SuggestedResolution;
    };

export interface EffectContext {
  rules: YearRules;
  valuer: Valuer;
  reportingCurrency: string;
  /** User classifications of external withdrawals (override layer). */
  withdrawals: ReadonlyMap<EventId, WithdrawalTreatment>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Confidence in a suggested price, by how far the quote is from the event. */
function priceConfidence(ageMs: number): number {
  if (ageMs <= DAY_MS) return 0.8;
  if (ageMs <= 7 * DAY_MS) return 0.6;
  if (ageMs <= 30 * DAY_MS) return 0.4;
  return 0.2;
}

/**
 * How resolving a missing price would move taxable amounts:
 * `raises`: a value counted as 0 should be positive (sale proceeds, taxable income);
 * `lowers`: the missing value is cost basis, so supplying it reduces later gains (purchases);
 * `either`: the effect could go either way (swaps, fees, basis of non-taxable receipts).
 */
type PriceEffect = 'raises' | 'lowers' | 'either';

function missingPrice(
  ctx: EffectContext,
  amount: AssetAmount,
  at: Timestamp,
  eventId: EventId,
  effect: PriceEffect,
): Effect {
  const detail = ctx.valuer.estimateDetail(amount, at);
  const estimate = detail?.value ?? null;
  const params: Record<string, string> = {
    asset: amount.asset,
    quantity: amount.quantity,
    eventId,
  };
  if (estimate) params['estimate'] = estimate.toFixed();
  const unitPrice = detail?.unitPrice?.toFixed();
  return {
    type: 'issue',
    kind: 'missing_price',
    asset: amount.asset,
    impact: estimate
      ? {
          min: effect === 'raises' ? ZERO : estimate.negated(),
          max: effect === 'lowers' ? ZERO : estimate,
        }
      : { min: ZERO, max: ZERO },
    impactKnown: estimate !== null,
    message: estimate
      ? `No price for ${amount.quantity} ${amount.asset} at this time; valued at 0 until a price is provided (roughly ${estimate.toFixed(2)} ${ctx.reportingCurrency} from the nearest known price).`
      : `No price for ${amount.quantity} ${amount.asset}; valued at 0 until a price is provided. Impact unknown.`,
    params,
    ...(detail && unitPrice !== undefined
      ? {
          suggestedResolution: {
            override: {
              eventId,
              action: { type: 'set_unit_price', asset: amount.asset, unitPrice },
            },
            confidence: priceConfidence(detail.ageMs),
            message: `Use ${unitPrice} ${ctx.reportingCurrency} per ${amount.asset}, the nearest known price (quoted ${detail.quotedAt}).`,
            params: { unitPrice, quotedAt: detail.quotedAt },
          },
        }
      : {}),
  };
}

function valueOrIssue(
  ctx: EffectContext,
  amount: AssetAmount,
  at: Timestamp,
  eventId: EventId,
  out: Effect[],
  effect: PriceEffect,
): { value: Decimal; known: boolean } {
  const v = ctx.valuer.value(amount, at);
  if (v) return { value: v.value, known: true };
  out.push(missingPrice(ctx, amount, at, eventId, effect));
  return { value: ZERO, known: false };
}

/** A fee paid in crypto disposes of the units (per rule pack) and may be a deductible expense. */
function feeEffects(
  ctx: EffectContext,
  accountId: AccountId,
  fee: AssetAmount,
  feeValue: { value: Decimal; known: boolean },
  opts: { asExpense: boolean },
): Effect[] {
  const out: Effect[] = [];
  const quantity = dec(fee.quantity);
  if (quantity.isZero()) return out;
  const rule = ctx.rules.cryptoFee;
  if (!isFiat(fee.asset)) {
    if (rule.isDisposal) {
      out.push({
        type: 'dispose',
        kind: 'fee',
        accountId,
        asset: fee.asset,
        quantity,
        proceeds: feeValue.value,
        sellingCosts: ZERO,
        proceedsKnown: feeValue.known,
        ruleRefs: [rule.rule],
      });
    } else {
      out.push({
        type: 'remove',
        accountId,
        asset: fee.asset,
        quantity,
        marketValue: feeValue.known ? feeValue.value : null,
        withdrawal: false,
        confirmedOwnWallet: false,
      });
    }
  }
  if (opts.asExpense && rule.isDeductibleExpense) {
    out.push({
      type: 'expense',
      accountId,
      asset: fee.asset,
      quantity,
      value: feeValue.value,
      ruleRefs: [rule.rule],
    });
  }
  return out;
}

export function effectsOfEvent(ctx: EffectContext, e: LedgerEvent): Effect[] {
  const out: Effect[] = [];
  const at = e.timestamp;
  switch (e.kind) {
    case 'trade': {
      const sentFiat = isFiat(e.sent.asset);
      const receivedFiat = isFiat(e.received.asset);
      if (sentFiat && receivedFiat) return out; // currency exchange: out of scope

      // Value the trade from a report-currency side when there is one, else what was
      // received, else what was given up.
      const reportFiat = `fiat:${ctx.reportingCurrency}`;
      let tradeValue: Decimal;
      let tradeKnown = true;
      const fiatSide = [e.sent, e.received].find((a) => a.asset === reportFiat);
      const v = fiatSide
        ? ctx.valuer.value(fiatSide, at)
        : (ctx.valuer.value(e.received, at) ?? ctx.valuer.value(e.sent, at));
      if (v) {
        tradeValue = v.value;
      } else {
        // Sale: proceeds are missing (raises tax). Purchase with another fiat: basis is
        // missing (lowers later gains). Swap: both, so it could go either way.
        const direction: PriceEffect = receivedFiat ? 'raises' : sentFiat ? 'lowers' : 'either';
        out.push(missingPrice(ctx, receivedFiat ? e.sent : e.received, at, e.id, direction));
        tradeValue = ZERO;
        tradeKnown = false;
      }

      let fee: { value: Decimal; known: boolean } = { value: ZERO, known: true };
      if (e.fee && !dec(e.fee.quantity).isZero()) {
        fee = valueOrIssue(ctx, e.fee, at, e.id, out, 'either');
      }
      const feeValue = fee.value;

      if (!sentFiat) {
        out.push({
          type: 'dispose',
          kind: receivedFiat ? 'sale' : 'swap',
          accountId: e.accountId,
          asset: e.sent.asset,
          quantity: dec(e.sent.quantity),
          proceeds: tradeValue,
          sellingCosts: feeValue,
          proceedsKnown: tradeKnown && fee.known,
          ruleRefs: [
            ...(receivedFiat ? [] : [ctx.rules.swap.rule]),
            ...(feeValue.isZero() ? [] : [ctx.rules.tradeFee.rule]),
          ],
        });
      }
      if (!receivedFiat) {
        const costBasis = sentFiat ? tradeValue.plus(feeValue) : tradeValue;
        out.push({
          type: 'acquire',
          accountId: e.accountId,
          asset: e.received.asset,
          quantity: dec(e.received.quantity),
          costBasis,
          acquiredAt: at,
          origin: sentFiat ? 'purchase' : 'swap',
          ruleRefs: sentFiat && !feeValue.isZero() ? [ctx.rules.tradeFee.rule] : [],
        });
      }
      // The fee comes last: when it's paid in the asset just received, those units must
      // exist before they can be spent. Trade fees are trade costs (basis/proceeds above),
      // not separate expenses.
      if (e.fee && !dec(e.fee.quantity).isZero()) {
        out.push(...feeEffects(ctx, e.accountId, e.fee, fee, { asExpense: false }));
      }
      return out;
    }

    case 'transfer': {
      if (e.fee && !dec(e.fee.quantity).isZero()) {
        const feeValue = valueOrIssue(ctx, e.fee, at, e.id, out, 'either');
        out.push(...feeEffects(ctx, e.fromAccountId, e.fee, feeValue, { asExpense: true }));
      }
      if (!isFiat(e.asset)) {
        out.push({
          type: 'move',
          fromAccountId: e.fromAccountId,
          toAccountId: e.toAccountId,
          asset: e.asset,
          quantity: dec(e.quantity),
        });
      }
      return out;
    }

    case 'income': {
      const treatment = ctx.rules.income[e.incomeType];
      const needsValue = treatment.taxableAtReceipt || treatment.basis === 'fair_market_value';
      const value = needsValue
        ? valueOrIssue(
            ctx,
            e.received,
            at,
            e.id,
            out,
            treatment.taxableAtReceipt ? 'raises' : 'either',
          ).value
        : ZERO;
      out.push({
        type: 'income',
        accountId: e.accountId,
        asset: e.received.asset,
        incomeType: e.incomeType,
        quantity: dec(e.received.quantity),
        value: treatment.taxableAtReceipt ? value : ZERO,
        taxable: treatment.taxableAtReceipt,
        ruleRefs: [treatment.rule],
      });
      if (!isFiat(e.received.asset)) {
        out.push({
          type: 'acquire',
          accountId: e.accountId,
          asset: e.received.asset,
          quantity: dec(e.received.quantity),
          costBasis: treatment.basis === 'fair_market_value' ? value : ZERO,
          acquiredAt: at,
          origin: 'income',
          ruleRefs: [treatment.rule],
        });
      }
      return out;
    }

    case 'fee': {
      const feeValue = valueOrIssue(ctx, e.fee, at, e.id, out, 'either');
      out.push(...feeEffects(ctx, e.accountId, e.fee, feeValue, { asExpense: true }));
      return out;
    }

    case 'external_deposit': {
      if (isFiat(e.received.asset)) return out;
      const quantity = dec(e.received.quantity);
      let basis: Decimal | null = null;
      if (e.costBasis) {
        if (e.costBasis.currency === ctx.reportingCurrency) {
          basis = dec(e.costBasis.amount);
        } else {
          out.push({
            type: 'issue',
            kind: 'basis_currency_mismatch',
            asset: e.received.asset,
            impact: { min: ZERO, max: ZERO },
            impactKnown: true,
            message: `Cost basis is in ${e.costBasis.currency}, but this report is in ${ctx.reportingCurrency}. Treated as unknown.`,
            params: { currency: e.costBasis.currency },
          });
        }
      }
      if (basis === null) {
        const market = ctx.valuer.valueOrEstimate(e.received, at);
        out.push({
          type: 'issue',
          kind: 'missing_basis',
          asset: e.received.asset,
          // Zero basis overstates later gains by up to roughly the value on arrival.
          impact: { min: market ? market.negated() : ZERO, max: ZERO },
          impactKnown: market !== null,
          message: `Cost basis unknown for ${e.received.quantity} ${e.received.asset} received from an external wallet; assumed 0.`,
          params: { asset: e.received.asset, quantity: e.received.quantity },
        });
      }
      out.push({
        type: 'acquire',
        accountId: e.accountId,
        asset: e.received.asset,
        quantity,
        costBasis: basis ?? ZERO,
        acquiredAt: e.acquiredAt ?? at,
        origin: 'external_deposit',
        ruleRefs: [],
      });
      return out;
    }

    case 'external_withdrawal': {
      if (isFiat(e.sent.asset)) return out;
      const treatment = ctx.withdrawals.get(e.id);
      if (treatment?.as === 'spent') {
        // The user says it was sold or spent: a disposal at the stated proceeds, or at
        // market value.
        const proceeds = treatment.proceeds
          ? { value: treatment.proceeds, known: true }
          : valueOrIssue(ctx, e.sent, at, e.id, out, 'raises');
        out.push({
          type: 'dispose',
          kind: 'spend',
          accountId: e.accountId,
          asset: e.sent.asset,
          quantity: dec(e.sent.quantity),
          proceeds: proceeds.value,
          sellingCosts: ZERO,
          proceedsKnown: proceeds.known,
          ruleRefs: [],
        });
        return out;
      }
      const market = ctx.valuer.valueOrEstimate(e.sent, at);
      out.push({
        type: 'remove',
        accountId: e.accountId,
        asset: e.sent.asset,
        quantity: dec(e.sent.quantity),
        marketValue: market,
        withdrawal: true,
        confirmedOwnWallet: treatment?.as === 'own_wallet',
      });
      return out;
    }
  }
}

export function effectsOfOpeningPosition(
  p: OpeningPosition,
  replacesAccountLots: boolean,
  ruleRefs: RuleId[],
): Effect[] {
  const lots = p.lots.map((l) => ({
    quantity: dec(l.quantity),
    costBasis: dec(l.costBasis),
    acquiredAt: l.acquiredAt,
  }));
  if (replacesAccountLots) {
    return [{ type: 'reset', accountId: p.accountId, asset: p.asset, lots, ruleRefs }];
  }
  return lots.map((l) => ({
    type: 'acquire',
    accountId: p.accountId,
    asset: p.asset,
    quantity: l.quantity,
    costBasis: l.costBasis,
    acquiredAt: l.acquiredAt,
    origin: 'opening_position',
    ruleRefs,
  }));
}
