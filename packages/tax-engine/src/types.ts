import type {
  AccountId,
  AssetId,
  CurrencyCode,
  Decimal,
  DecimalString,
  EventId,
  IncomeType,
  LedgerEvent,
  OpeningPosition,
  PriceQuote,
  Timestamp,
} from '@svdt/domain';
import type { CostBasisMethod, JurisdictionId, RuleId, RulePack } from '@svdt/rule-packs';

export interface CalculationInput {
  rulePack: RulePack;
  taxYear: number;
  events: readonly LedgerEvent[];
  prices?: readonly PriceQuote[];
  openingPositions?: readonly OpeningPosition[];
  /** Cost-basis method elections. Falls back to the rule pack's default. */
  methods?: {
    default?: CostBasisMethod;
    byAsset?: Readonly<Record<AssetId, CostBasisMethod>>;
  };
  /** Taxpayer's IANA time zone. Only honoured when the rule pack takes it from the user. */
  timeZone?: string;
  /**
   * User/accountant corrections (ADR-0009), oldest first. Latest active one per target wins:
   * by `createdAt`, and by position in this list when timestamps tie.
   */
  overrides?: readonly Override[];
}

/**
 * A correction from the fix queue. Keyed on a stable event id so it survives
 * re-normalization; amounts are in the report currency.
 */
export type OverrideAction =
  /** Price for an asset in this event (resolves `missing_price`). */
  | { type: 'set_unit_price'; asset: AssetId; unitPrice: DecimalString }
  /** Original basis of an external deposit (resolves `missing_basis`). */
  | { type: 'set_cost_basis'; costBasis: DecimalString; acquiredAt?: Timestamp }
  /**
   * What an external withdrawal was (resolves `unmatched_withdrawal`): a move to a wallet
   * the user owns, or crypto sold or spent (a disposal, at `proceeds` or market value).
   */
  | { type: 'classify_withdrawal'; as: 'own_wallet' | 'spent'; proceeds?: DecimalString }
  /** Withdraws an earlier override on the same event. */
  | { type: 'revoke'; overrideId: string };

export interface Override {
  id: string;
  eventId: EventId;
  createdAt: Timestamp;
  author: string;
  note?: string;
  action: OverrideAction;
}

export interface OverrideOutcome {
  overrideId: string;
  eventId: EventId;
  /**
   * `applied`: in effect. `superseded`: a later override replaced it. `revoked`: withdrawn.
   * `event_not_found`: its event is gone (e.g. after re-import); `not_applicable`: it
   * doesn't fit its event (see `reason`). The last two also raise an issue.
   */
  status: 'applied' | 'superseded' | 'revoked' | 'event_not_found' | 'not_applicable';
  reason?: string;
}

/** A ready-to-apply override the fix queue can offer as a one-tap resolution. */
export interface SuggestedResolution {
  override: { eventId: EventId; action: OverrideAction };
  /** 0–1: how likely this is the right answer. A heuristic, not a probability. */
  confidence: number;
  message: string;
  params: Record<string, string>;
}

export type LotOrigin =
  | 'purchase'
  | 'swap'
  | 'income'
  | 'external_deposit'
  | 'opening_position'
  | 'transfer'
  | 'shortfall';

/** A parcel of units with its own basis. Child lots are created when a transfer moves part of a lot. */
export interface Lot {
  id: string;
  accountId: AccountId;
  asset: AssetId;
  quantity: Decimal;
  costBasis: Decimal;
  acquiredAt: Timestamp;
  origin: LotOrigin;
  eventId: EventId | null;
  parentLotId: string | null;
  /** Rules that set this lot's basis (e.g. trade-fee capitalisation, income basis, safe harbor). */
  ruleRefs: RuleId[];
}

export interface ConsumedPart {
  /** `null` for average-cost pools, which have no individual lots. */
  lotId: string | null;
  quantity: Decimal;
  costBasis: Decimal;
  /** `null` for average-cost pools. */
  acquiredAt: Timestamp | null;
}

/** `spend`: crypto sent out and reclassified by the user as sold or spent. */
export type DisposalKind = 'sale' | 'swap' | 'fee' | 'spend';

/** One line of realized gain or loss. Lot-based methods emit one line per lot consumed. */
export interface Disposal {
  id: string;
  eventId: EventId;
  kind: DisposalKind;
  accountId: AccountId;
  asset: AssetId;
  quantity: Decimal;
  disposedAt: Timestamp;
  acquiredAt: Timestamp | null;
  taxYear: number;
  /** Gross amount realized, in the report currency. */
  proceeds: Decimal;
  /** Fees and other costs of the sale, deducted from proceeds. */
  sellingCosts: Decimal;
  costBasis: Decimal;
  gain: Decimal;
  term: 'short' | 'long' | null;
  lotId: string | null;
  /** True when part of the quantity had no basis available (negative balance). */
  basisShortfall: boolean;
  ruleRefs: RuleId[];
}

export interface IncomeRecord {
  id: string;
  eventId: EventId;
  accountId: AccountId;
  asset: AssetId;
  incomeType: IncomeType;
  quantity: Decimal;
  receivedAt: Timestamp;
  taxYear: number;
  value: Decimal;
  taxable: boolean;
  ruleRefs: RuleId[];
}

export interface ExpenseRecord {
  id: string;
  eventId: EventId;
  accountId: AccountId;
  asset: AssetId;
  quantity: Decimal;
  paidAt: Timestamp;
  taxYear: number;
  value: Decimal;
  ruleRefs: RuleId[];
}

export type IssueKind =
  | 'missing_price'
  | 'negative_balance'
  | 'missing_basis'
  | 'unmatched_withdrawal'
  | 'method_not_allowed'
  | 'opening_position_mismatch'
  | 'opening_position_order'
  | 'basis_currency_mismatch'
  | 'unsupported_history_year'
  | 'orphaned_override'
  | 'invalid_override';

/**
 * Something the user should review. `impact` is the plausible change to taxable amounts
 * if it's resolved, in the report currency; the fix queue is ordered by it.
 *
 * `impactKnown` is false when the engine has no basis for an estimate (e.g. no price for
 * the asset anywhere). Such issues rank below issues with a known non-zero impact and
 * above those known to be zero, so they are never buried at the bottom.
 */
export interface Issue {
  id: string;
  kind: IssueKind;
  eventIds: EventId[];
  asset: AssetId | null;
  taxYear: number;
  impact: { min: Decimal; max: Decimal };
  impactKnown: boolean;
  /** Plain-language explanation. UI layers localize by `kind` + `params`. */
  message: string;
  params: Record<string, string>;
  /** Present when there is a defensible default; absent when only the user can know. */
  suggestedResolution?: SuggestedResolution;
}

export interface Holding {
  /** `null` when basis is pooled across accounts. */
  accountId: AccountId | null;
  asset: AssetId;
  method: CostBasisMethod;
  quantity: Decimal;
  costBasis: Decimal;
}

export interface Bucket {
  proceeds: Decimal;
  sellingCosts: Decimal;
  costBasis: Decimal;
  gain: Decimal;
}

export interface Form8949Line {
  part: 'I' | 'II';
  description: string;
  dateAcquired: string;
  dateSold: string;
  proceeds: Decimal;
  costBasis: Decimal;
  gain: Decimal;
  disposalId: string;
}

export interface UsSummary {
  model: 'us_capital_gains';
  shortTerm: Bucket;
  longTerm: Bucket;
  ordinaryIncome: Decimal;
  /**
   * Rounded to the rule pack's reporting precision. Checkbox (box G–L / A–F) assignment
   * waits on 1099-DA reconciliation and is not produced yet.
   */
  form8949: Form8949Line[];
  /**
   * Totals of the rounded Form 8949 lines (what carries to Schedule D), so they always
   * equal the sum of the lines. `shortTerm`/`longTerm` above are the unrounded figures.
   */
  form8949Totals: { partI: Form8949Totals; partII: Form8949Totals };
  /** `ordinaryIncome` rounded per the rule pack. */
  reportedOrdinaryIncome: Decimal;
}

export interface Form8949Totals {
  proceeds: Decimal;
  costBasis: Decimal;
  gain: Decimal;
}

export interface JpSummary {
  model: 'jp_miscellaneous_income';
  /** 譲渡: disposals of crypto assets. Gain is after selling costs. */
  disposals: Bucket;
  /** Crypto received as income, by type. */
  income: Partial<Record<IncomeType, Decimal>>;
  incomeTotal: Decimal;
  /** Deductible fees not already inside a disposal (必要経費). */
  expenses: Decimal;
  /** 雑所得 from crypto: disposal gain + income − expenses. May be negative. */
  miscellaneousIncome: Decimal;
  /** Amount that adds to taxable income: a loss can't offset other income categories. */
  taxableMiscellaneousIncome: Decimal;
  /**
   * Figures for the return, rounded per the rule pack (whole yen, truncated). Each
   * component is rounded first and the income is derived from the rounded components.
   */
  reported: {
    /** 収入金額: disposal proceeds + income received. */
    revenue: Decimal;
    /** 必要経費: cost basis + selling costs + deductible expenses. */
    necessaryExpenses: Decimal;
    miscellaneousIncome: Decimal;
    taxableMiscellaneousIncome: Decimal;
  };
}

export interface CalculationResult {
  engineVersion: string;
  rulePack: { id: JurisdictionId; version: string; status: RulePack['status'] };
  taxYear: number;
  reportingCurrency: CurrencyCode;
  timeZone: string;
  methods: Record<AssetId, CostBasisMethod>;
  disposals: Disposal[];
  income: IncomeRecord[];
  expenses: ExpenseRecord[];
  /** Every lot created up to the end of the tax year, for provenance (ADR-0012). */
  lots: Lot[];
  holdings: Holding[];
  /** Fix queue: ordered by absolute impact, largest first. */
  issues: Issue[];
  /** What happened to each input override, oldest first. */
  overrides: OverrideOutcome[];
  summary: UsSummary | JpSummary;
}
