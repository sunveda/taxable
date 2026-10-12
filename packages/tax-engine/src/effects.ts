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
import type { DisposalKind, IssueKind, LotOrigin } from './types';
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
      message: string;
      params: Record<string, string>;
    };

export interface EffectContext {
  rules: YearRules;
  valuer: Valuer;
  reportingCurrency: string;
}

function missingPrice(amount: AssetAmount, eventId: EventId): Effect {
  return {
    type: 'issue',
    kind: 'missing_price',
    asset: amount.asset,
    impact: { min: ZERO, max: ZERO },
    message: `No price for ${amount.quantity} ${amount.asset}; valued at 0 until a price is provided.`,
    params: { asset: amount.asset, quantity: amount.quantity, eventId },
  };
}

function valueOrIssue(
  ctx: EffectContext,
  amount: AssetAmount,
  at: Timestamp,
  eventId: EventId,
  out: Effect[],
): Decimal {
  const v = ctx.valuer.value(amount, at);
  if (v) return v.value;
  out.push(missingPrice(amount, eventId));
  return ZERO;
}

/** A fee paid in crypto disposes of the units (per rule pack) and may be a deductible expense. */
function feeEffects(
  ctx: EffectContext,
  accountId: AccountId,
  fee: AssetAmount,
  feeValue: Decimal,
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
        proceeds: feeValue,
        sellingCosts: ZERO,
        ruleRefs: [rule.rule],
      });
    } else {
      out.push({ type: 'remove', accountId, asset: fee.asset, quantity, marketValue: null });
    }
  }
  if (opts.asExpense && rule.isDeductibleExpense) {
    out.push({
      type: 'expense',
      accountId,
      asset: fee.asset,
      quantity,
      value: feeValue,
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
      const fiatSide = [e.sent, e.received].find((a) => a.asset === reportFiat);
      const v = fiatSide
        ? ctx.valuer.value(fiatSide, at)
        : (ctx.valuer.value(e.received, at) ?? ctx.valuer.value(e.sent, at));
      if (v) {
        tradeValue = v.value;
      } else {
        out.push(missingPrice(receivedFiat ? e.sent : e.received, e.id));
        tradeValue = ZERO;
      }

      let feeValue = ZERO;
      if (e.fee && !dec(e.fee.quantity).isZero()) {
        feeValue = valueOrIssue(ctx, e.fee, at, e.id, out);
        // Trade fees are trade costs (basis/proceeds below), not separate expenses.
        out.push(...feeEffects(ctx, e.accountId, e.fee, feeValue, { asExpense: false }));
      }

      if (!sentFiat) {
        out.push({
          type: 'dispose',
          kind: receivedFiat ? 'sale' : 'swap',
          accountId: e.accountId,
          asset: e.sent.asset,
          quantity: dec(e.sent.quantity),
          proceeds: tradeValue,
          sellingCosts: feeValue,
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
      return out;
    }

    case 'transfer': {
      if (e.fee && !dec(e.fee.quantity).isZero()) {
        const feeValue = valueOrIssue(ctx, e.fee, at, e.id, out);
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
      const value = needsValue ? valueOrIssue(ctx, e.received, at, e.id, out) : ZERO;
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
      const feeValue = valueOrIssue(ctx, e.fee, at, e.id, out);
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
            message: `Cost basis is in ${e.costBasis.currency}, but this report is in ${ctx.reportingCurrency}. Treated as unknown.`,
            params: { currency: e.costBasis.currency },
          });
        }
      }
      if (basis === null) {
        const market = ctx.valuer.value(e.received, at);
        out.push({
          type: 'issue',
          kind: 'missing_basis',
          asset: e.received.asset,
          // Zero basis overstates later gains by up to roughly the value on arrival.
          impact: { min: market ? market.value.negated() : ZERO, max: ZERO },
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
      const market = ctx.valuer.value(e.sent, at);
      out.push({
        type: 'remove',
        accountId: e.accountId,
        asset: e.sent.asset,
        quantity: dec(e.sent.quantity),
        marketValue: market ? market.value : null,
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
