/**
 * Canonical ledger events consumed by the tax engine.
 *
 * Importers turn raw exchange/chain data into these events (see
 * docs/spec/data-ingestion-spec.md). Amounts are decimal strings, never JS numbers
 * (ADR-0008), so events are plain JSON and can cross API and storage boundaries as-is.
 */

export type EventId = string;
export type AccountId = string;

/**
 * Asset identifier.
 * - Fiat currencies: `fiat:USD`, `fiat:JPY`, …
 * - Crypto: a canonical id such as `BTC`, `ETH`, or `eip155:1/erc20:0x…`.
 */
export type AssetId = string;

/** ISO 4217 currency code of a tax report, e.g. `USD`, `JPY`. */
export type CurrencyCode = string;

/** Decimal number encoded as a string, e.g. `"0.000000000000000001"`. */
export type DecimalString = string;

/** ISO-8601 instant with an explicit offset, e.g. `2025-03-01T12:00:00Z`. */
export type Timestamp = string;

export function fiatAsset(currency: CurrencyCode): AssetId {
  return `fiat:${currency}`;
}

export function isFiat(asset: AssetId): boolean {
  return asset.startsWith('fiat:');
}

export function fiatCurrency(asset: AssetId): CurrencyCode | undefined {
  return isFiat(asset) ? asset.slice('fiat:'.length) : undefined;
}

/** A fair-market value stated by the source, in any currency. */
export interface ValueInput {
  amount: DecimalString;
  currency: CurrencyCode;
}

export interface AssetAmount {
  asset: AssetId;
  quantity: DecimalString;
  /** Total fair-market value of this amount, if the source provides it. */
  value?: ValueInput;
}

interface EventBase {
  id: EventId;
  timestamp: Timestamp;
  /** Free-form pointer to the raw source rows (ADR-0009). */
  sourceRef?: string;
}

/** Exchange of one asset for another: buy (fiat → crypto), sell (crypto → fiat) or swap. */
export interface TradeEvent extends EventBase {
  kind: 'trade';
  accountId: AccountId;
  sent: AssetAmount;
  received: AssetAmount;
  fee?: AssetAmount;
}

/** Move between two accounts the user owns. Not a disposal. */
export interface TransferEvent extends EventBase {
  kind: 'transfer';
  fromAccountId: AccountId;
  toAccountId: AccountId;
  asset: AssetId;
  /** Quantity that arrives at the destination. */
  quantity: DecimalString;
  /** Network fee paid by the sender on top of `quantity`. */
  fee?: AssetAmount;
}

export type IncomeType = 'staking' | 'mining' | 'airdrop' | 'interest' | 'hard_fork' | 'other';

/** Crypto received as income (staking reward, mining, airdrop, …). */
export interface IncomeEvent extends EventBase {
  kind: 'income';
  accountId: AccountId;
  incomeType: IncomeType;
  received: AssetAmount;
}

/** Crypto spent purely on a fee (e.g. gas for a failed transaction or an approval). */
export interface FeeEvent extends EventBase {
  kind: 'fee';
  accountId: AccountId;
  fee: AssetAmount;
}

/** Inbound from a wallet we can't see. Basis is unknown unless the user supplies it. */
export interface ExternalDepositEvent extends EventBase {
  kind: 'external_deposit';
  accountId: AccountId;
  received: AssetAmount;
  /** User-supplied original cost basis in the report currency, if known. */
  costBasis?: ValueInput;
  /** User-supplied original acquisition time, if known. */
  acquiredAt?: Timestamp;
}

/** Outbound to a wallet we can't see. Treated as a non-taxable move out, flagged for review. */
export interface ExternalWithdrawalEvent extends EventBase {
  kind: 'external_withdrawal';
  accountId: AccountId;
  sent: AssetAmount;
}

export type LedgerEvent =
  | TradeEvent
  | TransferEvent
  | IncomeEvent
  | FeeEvent
  | ExternalDepositEvent
  | ExternalWithdrawalEvent;

/** A unit price quote, used when an event carries no value in the report currency. */
export interface PriceQuote {
  asset: AssetId;
  currency: CurrencyCode;
  timestamp: Timestamp;
  unitPrice: DecimalString;
  source: string;
}

/**
 * Lots the user declares as of a point in time, replacing what the engine computed.
 * Used for the US Rev. Proc. 2024-28 safe-harbor allocation and for opening balances
 * when earlier history is unavailable.
 */
export interface OpeningPosition {
  asOf: Timestamp;
  accountId: AccountId;
  asset: AssetId;
  reason: 'us_safe_harbor_2024_28' | 'opening_balance';
  lots: {
    quantity: DecimalString;
    costBasis: DecimalString;
    acquiredAt: Timestamp;
  }[];
}
