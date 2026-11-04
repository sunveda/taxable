import type { CurrencyCode, IncomeType, RoundingMode } from '@svdt/domain';

/**
 * Rule packs declare *what the law says* as data; the engine implements the mechanisms
 * (ADR-0007). Every rule a pack applies points at a citation so "explain this number" can
 * reach the legal source.
 */

export type JurisdictionId = 'us' | 'jp';

export type CostBasisMethod = 'FIFO' | 'LIFO' | 'HIFO' | 'MOVING_AVERAGE' | 'TOTAL_AVERAGE';

/**
 * `per_account`: each wallet/exchange account has its own basis (US from 2025).
 * `per_user`: one pool per asset across every account the person holds (Japan).
 */
export type BasisScope = 'per_account' | 'per_user';

export type RuleId = string;

export interface RuleCitation {
  id: RuleId;
  summary: string;
  /** Statute, regulation, or official guidance. */
  source: string;
  url?: string;
  /**
   * `draft` until a qualified tax professional for the jurisdiction has reviewed the rule
   * and its golden tests (ADR-0007).
   */
  reviewStatus: 'draft' | 'reviewed';
}

export interface IncomeTreatment {
  /** Whether the fair-market value at receipt is income in the year received. */
  taxableAtReceipt: boolean;
  /** Cost basis assigned to the received units. */
  basis: 'fair_market_value' | 'zero';
  rule: RuleId;
}

export interface YearRules {
  taxYear: number;
  basisScope: BasisScope;
  basisScopeRule: RuleId;
  costBasis: {
    allowed: readonly CostBasisMethod[];
    default: CostBasisMethod;
    rule: RuleId;
  };
  /** Long/short-term split. `null` when the jurisdiction doesn't distinguish (Japan). */
  holdingPeriod: { longTermAfterYears: number; rule: RuleId } | null;
  income: Record<IncomeType, IncomeTreatment>;
  /** Crypto-for-crypto exchanges are taxable disposals. */
  swap: { rule: RuleId };
  /** Network/standalone fees paid in crypto. */
  cryptoFee: {
    /** The spent units are disposed of at fair-market value. */
    isDisposal: boolean;
    /** The fee's value is a deductible expense (separate from trade costs). */
    isDeductibleExpense: boolean;
    rule: RuleId;
  };
  /** Trade fees: added to basis on purchase, deducted from proceeds on disposal. */
  tradeFee: { rule: RuleId };
}

export type SummaryModel = 'us_capital_gains' | 'jp_miscellaneous_income';

export interface RulePack {
  id: JurisdictionId;
  name: string;
  version: string;
  status: 'draft' | 'reviewed' | 'stable';
  reportingCurrency: CurrencyCode;
  /**
   * Time zone that decides which tax year an event falls in and calendar-day holding
   * periods. When `timeZoneFromUser` is true the taxpayer's own zone overrides it.
   */
  defaultTimeZone: string;
  timeZoneFromUser: boolean;
  summaryModel: SummaryModel;
  /** Rounding applied only when producing report figures (ADR-0008). */
  reportRounding: { decimalPlaces: number; mode: RoundingMode; rule: RuleId };
  /** Inclusive range of tax years this pack can compute. */
  supportedYears: { from: number; to: number };
  rules: Record<RuleId, RuleCitation>;
  yearRules(taxYear: number): YearRules;
}

export class UnsupportedTaxYearError extends Error {
  constructor(
    readonly jurisdiction: JurisdictionId,
    readonly taxYear: number,
    reason: string,
  ) {
    super(`Rule pack "${jurisdiction}" does not support tax year ${taxYear}: ${reason}`);
    this.name = 'UnsupportedTaxYearError';
  }
}

export function defineRules(citations: readonly RuleCitation[]): Record<RuleId, RuleCitation> {
  const out: Record<RuleId, RuleCitation> = {};
  for (const c of citations) {
    if (out[c.id]) throw new Error(`Duplicate rule id ${c.id}`);
    out[c.id] = c;
  }
  return out;
}
