import type { LedgerEvent } from './api-types';

/**
 * Sample history for the placeholder backend: a Japanese user with two exchanges and a
 * self-custody wallet, 2025–2026. It deliberately includes things the fix queue should
 * catch: a withdrawal to an unconnected wallet, coins received with no known cost, and an
 * airdrop with no price. One withdrawal/deposit pair is a transfer between own accounts.
 */
const jpy = (quantity: string) => ({ asset: 'fiat:JPY', quantity });

export const demoEvents: LedgerEvent[] = [
  // --- 2025 ---
  {
    kind: 'trade',
    id: 'demo:bitflyer:1',
    timestamp: '2025-01-10T01:00:00Z',
    accountId: 'bitflyer',
    sent: jpy('1400000'),
    received: { asset: 'BTC', quantity: '0.1' },
    fee: { asset: 'BTC', quantity: '0.00015' },
  },
  {
    kind: 'trade',
    id: 'demo:coincheck:1',
    timestamp: '2025-02-05T03:00:00Z',
    accountId: 'coincheck',
    sent: jpy('1000000'),
    received: { asset: 'ETH', quantity: '2' },
  },
  {
    kind: 'trade',
    id: 'demo:bitflyer:2',
    timestamp: '2025-06-01T05:00:00Z',
    accountId: 'bitflyer',
    sent: { asset: 'BTC', quantity: '0.05' },
    received: jpy('800000'),
  },
  {
    kind: 'income',
    id: 'demo:coincheck:2',
    timestamp: '2025-07-01T00:00:00Z',
    accountId: 'coincheck',
    incomeType: 'staking',
    received: { asset: 'ETH', quantity: '0.05', value: { amount: '25000', currency: 'JPY' } },
  },
  {
    kind: 'external_withdrawal',
    id: 'demo:coincheck:3',
    timestamp: '2025-09-01T02:00:00Z',
    accountId: 'coincheck',
    sent: { asset: 'ETH', quantity: '0.5', value: { amount: '260000', currency: 'JPY' } },
  },
  // --- 2026 ---
  {
    kind: 'trade',
    id: 'demo:bitflyer:3',
    timestamp: '2026-02-01T01:00:00Z',
    accountId: 'bitflyer',
    sent: jpy('700000'),
    received: { asset: 'BTC', quantity: '0.05' },
  },
  {
    kind: 'external_deposit',
    id: 'demo:coincheck:4',
    timestamp: '2026-03-01T04:00:00Z',
    accountId: 'coincheck',
    received: { asset: 'SOL', quantity: '10', value: { amount: '220000', currency: 'JPY' } },
  },
  {
    kind: 'income',
    id: 'demo:wallet:1',
    timestamp: '2026-04-01T09:00:00Z',
    accountId: 'wallet',
    incomeType: 'airdrop',
    received: { asset: 'XYZ', quantity: '1000' },
  },
  {
    kind: 'trade',
    id: 'demo:bitflyer:4',
    timestamp: '2026-05-15T06:00:00Z',
    accountId: 'bitflyer',
    sent: { asset: 'BTC', quantity: '0.08' },
    received: jpy('1200000'),
    fee: { asset: 'fiat:JPY', quantity: '1500' },
  },
  {
    kind: 'trade',
    id: 'demo:coincheck:5',
    timestamp: '2026-06-10T03:00:00Z',
    accountId: 'coincheck',
    sent: { asset: 'SOL', quantity: '6' },
    received: jpy('150000'),
  },
  {
    kind: 'external_withdrawal',
    id: 'demo:bitflyer:5',
    timestamp: '2026-06-20T02:00:00Z',
    accountId: 'bitflyer',
    sent: { asset: 'BTC', quantity: '0.0199' },
  },
  {
    kind: 'external_deposit',
    id: 'demo:wallet:2',
    timestamp: '2026-06-20T03:00:00Z',
    accountId: 'wallet',
    received: { asset: 'BTC', quantity: '0.0198' },
  },
];
