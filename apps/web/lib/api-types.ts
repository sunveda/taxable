/**
 * JSON shapes of the svdt API (`apps/api`, OpenAPI at /v1/openapi.json). Decimals are exact
 * strings. Hand-written until `packages/api-client` is generated from the OpenAPI document.
 */

export type Jurisdiction = 'us' | 'jp';
export type Method = 'FIFO' | 'LIFO' | 'HIFO' | 'MOVING_AVERAGE' | 'TOTAL_AVERAGE';

export type OverrideAction =
  | { type: 'set_unit_price'; asset: string; unitPrice: string }
  | { type: 'set_cost_basis'; costBasis: string; acquiredAt?: string }
  | { type: 'classify_withdrawal'; as: 'own_wallet' | 'spent'; proceeds?: string }
  | { type: 'revoke'; overrideId: string };

export interface AssetAmount {
  asset: string;
  quantity: string;
  value?: { amount: string; currency: string };
}

/** A LedgerEvent as stored (see packages/domain/src/ledger.ts). */
export type LedgerEvent = { id: string; timestamp: string; sourceRef?: string } & (
  | {
      kind: 'trade';
      accountId: string;
      sent: AssetAmount;
      received: AssetAmount;
      fee?: AssetAmount;
    }
  | {
      kind: 'transfer';
      fromAccountId: string;
      toAccountId: string;
      asset: string;
      quantity: string;
      fee?: AssetAmount;
    }
  | { kind: 'income'; accountId: string; incomeType: string; received: AssetAmount }
  | { kind: 'fee'; accountId: string; fee: AssetAmount }
  | { kind: 'external_deposit'; accountId: string; received: AssetAmount; costBasis?: unknown }
  | { kind: 'external_withdrawal'; accountId: string; sent: AssetAmount }
);

export interface EventRow {
  id: string;
  accountName: string;
  occurredAt: string;
  importerId: string;
  event: LedgerEvent;
}

export interface EventPage {
  data: EventRow[];
  nextCursor: string | null;
}

export interface ImportWarning {
  line: number | null;
  code: string;
  message: string;
}

export interface ImportResult {
  importId: string;
  importer: { id: string; name: string; status: 'verified' | 'unverified' };
  encoding: string;
  stats: { rows: number; imported: number; skipped: number };
  warnings: ImportWarning[];
  upserted: number;
  conflicts: string[];
}

export interface ImportSummary {
  id: string;
  accountName: string;
  filename: string | null;
  importerId: string;
  stats: { rows: number; imported: number; skipped: number };
  warningCount: number;
  createdAt: string;
}

export interface OverrideRow {
  id: string;
  eventId: string;
  author: string;
  note: string | null;
  action: OverrideAction;
  createdAt: string;
}

export interface SuggestedResolution {
  override: { eventId: string; action: OverrideAction };
  confidence: number;
  message: string;
  params: Record<string, string>;
}

export interface Issue {
  id: string;
  kind: string;
  eventIds: string[];
  asset: string | null;
  taxYear: number;
  impact: { min: string; max: string };
  impactKnown: boolean;
  message: string;
  params: Record<string, string>;
  suggestedResolution?: SuggestedResolution;
}

export interface Disposal {
  id: string;
  eventId: string;
  kind: string;
  accountId: string;
  asset: string;
  quantity: string;
  disposedAt: string;
  acquiredAt: string | null;
  proceeds: string;
  sellingCosts: string;
  costBasis: string;
  gain: string;
  term: 'short' | 'long' | null;
  lotId: string | null;
  basisShortfall: boolean;
  ruleRefs: string[];
}

export interface IncomeRecord {
  id: string;
  eventId: string;
  accountId: string;
  asset: string;
  incomeType: string;
  quantity: string;
  receivedAt: string;
  value: string;
  taxable: boolean;
  ruleRefs: string[];
}

export interface Lot {
  id: string;
  accountId: string;
  asset: string;
  quantity: string;
  costBasis: string;
  acquiredAt: string;
  origin: string;
  eventId: string | null;
  parentLotId: string | null;
  ruleRefs: string[];
}

export interface Holding {
  accountId: string | null;
  asset: string;
  method: Method;
  quantity: string;
  costBasis: string;
}

interface Bucket {
  proceeds: string;
  sellingCosts: string;
  costBasis: string;
  gain: string;
}

export type Summary =
  | {
      model: 'us_capital_gains';
      shortTerm: Bucket;
      longTerm: Bucket;
      ordinaryIncome: string;
      reportedOrdinaryIncome: string;
      form8949Totals: {
        partI: { proceeds: string; costBasis: string; gain: string };
        partII: { proceeds: string; costBasis: string; gain: string };
      };
    }
  | {
      model: 'jp_miscellaneous_income';
      disposals: Bucket;
      income: Record<string, string>;
      incomeTotal: string;
      expenses: string;
      miscellaneousIncome: string;
      taxableMiscellaneousIncome: string;
      reported: {
        revenue: string;
        necessaryExpenses: string;
        miscellaneousIncome: string;
        taxableMiscellaneousIncome: string;
      };
    };

export interface Calculation {
  engineVersion: string;
  rulePack: { id: Jurisdiction; version: string; status: string };
  taxYear: number;
  reportingCurrency: string;
  timeZone: string;
  methods: Record<string, Method>;
  disposals: Disposal[];
  income: IncomeRecord[];
  expenses: { id: string; eventId: string; asset: string; quantity: string; value: string }[];
  lots: Lot[];
  holdings: Holding[];
  issues: Issue[];
  overrides: { overrideId: string; eventId: string; status: string; reason?: string }[];
  transferMatches: { withdrawalId: string; depositId: string; transferId: string }[];
  summary: Summary;
}

export interface CalculateRequest {
  jurisdiction: Jurisdiction;
  taxYear: number;
  methods?: { default?: Method };
}

/** An error the API reported, with its machine-readable code. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
