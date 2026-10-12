import type { AssetAmount, Decimal, LedgerEvent } from '@svdt/domain';

/** Builders that keep scenario tests short. All amounts are decimal strings. */
let counter = 0;
const nextId = (prefix: string): string => `${prefix}-${String(++counter).padStart(4, '0')}`;

export const amt = (quantity: string, asset: string, value?: [string, string]): AssetAmount =>
  value
    ? { asset, quantity, value: { amount: value[0], currency: value[1] } }
    : { asset, quantity };

export const usd = (q: string): AssetAmount => amt(q, 'fiat:USD');
export const jpy = (q: string): AssetAmount => amt(q, 'fiat:JPY');

export function buy(
  timestamp: string,
  accountId: string,
  received: AssetAmount,
  sent: AssetAmount,
  fee?: AssetAmount,
): LedgerEvent {
  return {
    kind: 'trade',
    id: nextId('buy'),
    timestamp,
    accountId,
    sent,
    received,
    ...(fee ? { fee } : {}),
  };
}

export function sell(
  timestamp: string,
  accountId: string,
  sent: AssetAmount,
  received: AssetAmount,
  fee?: AssetAmount,
): LedgerEvent {
  return {
    kind: 'trade',
    id: nextId('sell'),
    timestamp,
    accountId,
    sent,
    received,
    ...(fee ? { fee } : {}),
  };
}

export function transfer(
  timestamp: string,
  fromAccountId: string,
  toAccountId: string,
  asset: string,
  quantity: string,
  fee?: AssetAmount,
): LedgerEvent {
  return {
    kind: 'transfer',
    id: nextId('xfer'),
    timestamp,
    fromAccountId,
    toAccountId,
    asset,
    quantity,
    ...(fee ? { fee } : {}),
  };
}

export function income(
  timestamp: string,
  accountId: string,
  incomeType: 'staking' | 'mining' | 'airdrop' | 'interest' | 'hard_fork' | 'other',
  received: AssetAmount,
): LedgerEvent {
  return { kind: 'income', id: nextId('inc'), timestamp, accountId, incomeType, received };
}

/** Compares decimals by value so tests read as plain strings. */
export const s = (d: Decimal): string => d.toFixed();
