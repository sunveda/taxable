import type { LedgerEvent, PriceQuote } from '@svdt/domain';

/** Sample histories that show the engine end to end until importers exist. */

export const usEvents: LedgerEvent[] = [
  {
    kind: 'trade',
    id: 'cb-1',
    timestamp: '2024-01-15T17:00:00Z',
    accountId: 'Coinbase',
    sent: { asset: 'fiat:USD', quantity: '42000' },
    received: { asset: 'BTC', quantity: '1' },
    fee: { asset: 'fiat:USD', quantity: '25' },
  },
  {
    kind: 'transfer',
    id: 'cb-2',
    timestamp: '2024-08-01T17:00:00Z',
    fromAccountId: 'Coinbase',
    toAccountId: 'Ledger',
    asset: 'BTC',
    quantity: '0.5',
  },
  {
    kind: 'income',
    id: 'stake-1',
    timestamp: '2025-03-01T17:00:00Z',
    accountId: 'Ledger',
    incomeType: 'staking',
    received: { asset: 'ETH', quantity: '0.2' },
  },
  {
    kind: 'trade',
    id: 'ledger-1',
    timestamp: '2025-04-02T17:00:00Z',
    accountId: 'Ledger',
    sent: { asset: 'BTC', quantity: '0.5' },
    received: { asset: 'fiat:USD', quantity: '41000' },
  },
  {
    kind: 'trade',
    id: 'cb-3',
    timestamp: '2025-06-10T17:00:00Z',
    accountId: 'Coinbase',
    sent: { asset: 'BTC', quantity: '0.6' },
    received: { asset: 'fiat:USD', quantity: '63000' },
  },
  {
    kind: 'external_withdrawal',
    id: 'cb-4',
    timestamp: '2025-07-01T17:00:00Z',
    accountId: 'Coinbase',
    sent: { asset: 'ETH', quantity: '1', value: { amount: '2500', currency: 'USD' } },
  },
];

export const usPrices: PriceQuote[] = [
  {
    asset: 'ETH',
    currency: 'USD',
    timestamp: '2025-03-01T00:00:00Z',
    unitPrice: '2200',
    source: 'demo',
  },
];

export const jpEvents: LedgerEvent[] = [
  {
    kind: 'trade',
    id: 'bf-1',
    timestamp: '2025-02-01T03:00:00Z',
    accountId: 'bitFlyer',
    sent: { asset: 'fiat:JPY', quantity: '1000000' },
    received: { asset: 'BTC', quantity: '0.1' },
  },
  {
    kind: 'trade',
    id: 'bf-2',
    timestamp: '2025-05-01T03:00:00Z',
    accountId: 'bitFlyer',
    sent: { asset: 'BTC', quantity: '0.05' },
    received: { asset: 'fiat:JPY', quantity: '800000' },
  },
  {
    kind: 'trade',
    id: 'cc-1',
    timestamp: '2025-09-01T03:00:00Z',
    accountId: 'Coincheck',
    sent: { asset: 'fiat:JPY', quantity: '1500000' },
    received: { asset: 'BTC', quantity: '0.1' },
  },
  {
    kind: 'income',
    id: 'cc-2',
    timestamp: '2025-10-01T03:00:00Z',
    accountId: 'Coincheck',
    incomeType: 'staking',
    received: { asset: 'ETH', quantity: '0.5', value: { amount: '300000', currency: 'JPY' } },
  },
];
