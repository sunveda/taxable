import type { LedgerEvent } from '@svdt/domain';
import { jp, us } from '@svdt/rule-packs';
import { describe, expect, it } from 'vitest';
import { calculate, type Override } from '../src';
import { UNCONNECTED_WALLETS } from '../src/effects';
import { amt, buy, jpy, s, sell, usd } from './helpers';

/** Regression tests for the third review of sunveda/taxable#1 (Codex, engine findings). */
const withdrawal = (id: string, timestamp: string, quantity: string): LedgerEvent => ({
  kind: 'external_withdrawal',
  id,
  timestamp,
  accountId: 'a',
  sent: amt(quantity, 'BTC'),
});
const deposit = (
  id: string,
  timestamp: string,
  quantity: string,
  extra: Partial<Extract<LedgerEvent, { kind: 'external_deposit' }>> = {},
): LedgerEvent => ({
  kind: 'external_deposit',
  id,
  timestamp,
  accountId: 'a',
  received: amt(quantity, 'BTC'),
  ...extra,
});

describe('own-wallet withdrawals keep their basis', () => {
  it('Japan: coins in an unconnected wallet still count in the per-user average', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [
        buy('2025-01-05T01:00:00Z', 'a', amt('1', 'BTC'), jpy('1000000')),
        withdrawal('out-1', '2025-02-01T01:00:00Z', '1'),
        buy('2025-03-01T01:00:00Z', 'a', amt('1', 'BTC'), jpy('3000000')),
        sell('2025-04-01T01:00:00Z', 'a', amt('1', 'BTC'), jpy('3000000')),
      ],
    });
    // Average over both coins (2,000,000), not just the one still on the exchange.
    expect(r.disposals.map((d) => [s(d.costBasis), s(d.gain)])).toEqual([['2000000', '1000000']]);
    expect(r.holdings.map((h) => [h.asset, s(h.quantity), s(h.costBasis)])).toEqual([
      ['BTC', '1', '2000000'],
    ]);
    expect(r.issues.map((i) => i.kind)).toEqual(['unmatched_withdrawal']);
  });

  it('US: coins that come back keep their basis and holding period', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2023-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('20000')),
        withdrawal('out-1', '2024-06-01T15:00:00Z', '1'),
        deposit('in-1', '2025-01-10T15:00:00Z', '1'),
        sell('2025-03-01T15:00:00Z', 'a', amt('1', 'BTC'), usd('60000')),
      ],
    });
    expect(r.disposals.map((d) => [s(d.costBasis), s(d.gain), d.term])).toEqual([
      ['20000', '40000', 'long'],
    ]);
    expect(r.issues.some((i) => i.kind === 'missing_basis')).toBe(false);
    expect(r.holdings).toEqual([]);
  });

  it('a deposit with a user-supplied basis is new coins, not a return', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2023-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('20000')),
        withdrawal('out-1', '2024-06-01T15:00:00Z', '1'),
        deposit('in-1', '2025-01-10T15:00:00Z', '1', {
          costBasis: { amount: '50000', currency: 'USD' },
        }),
        sell('2025-03-01T15:00:00Z', 'a', amt('1', 'BTC'), usd('60000')),
      ],
    });
    expect(r.disposals.map((d) => [s(d.costBasis), d.term])).toEqual([['50000', 'short']]);
    expect(r.holdings.map((h) => [h.accountId, s(h.quantity), s(h.costBasis)])).toEqual([
      [UNCONNECTED_WALLETS, '1', '20000'],
    ]);
  });

  it('only the parked quantity returns; the rest still needs a basis', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('20000')),
        withdrawal('out-1', '2025-02-01T15:00:00Z', '1'),
        deposit('in-1', '2025-03-01T15:00:00Z', '1.5'),
      ],
    });
    const missing = r.issues.filter((i) => i.kind === 'missing_basis');
    expect(missing.map((i) => [i.params['quantity'], i.params['returned']])).toEqual([
      ['0.5', '1'],
    ]);
    expect(r.holdings.map((h) => [h.accountId, s(h.quantity), s(h.costBasis)])).toEqual([
      ['a', '1.5', '20000'],
    ]);
  });

  it('a withdrawal classified as spent is not parked', () => {
    const spent: Override = {
      id: 'ov-1',
      eventId: 'out-1',
      createdAt: '2026-01-01T00:00:00Z',
      author: 'user',
      action: { type: 'classify_withdrawal', as: 'spent', proceeds: '30000' },
    };
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('20000')),
        withdrawal('out-1', '2025-02-01T15:00:00Z', '1'),
        deposit('in-1', '2025-03-01T15:00:00Z', '1'),
      ],
      overrides: [spent],
    });
    expect(r.disposals.map((d) => [d.kind, s(d.gain)])).toEqual([['spend', '10000']]);
    expect(r.issues.map((i) => i.kind)).toEqual(['missing_basis']);
  });
});

describe('fees on fiat-to-fiat trades', () => {
  it('a crypto fee on a currency exchange still disposes of the units', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('20000')),
        {
          kind: 'trade',
          id: 'fx-1',
          timestamp: '2025-02-01T15:00:00Z',
          accountId: 'a',
          sent: usd('1000'),
          received: amt('900', 'fiat:EUR'),
          fee: amt('0.001', 'BTC'),
        },
      ],
      prices: [
        {
          asset: 'BTC',
          currency: 'USD',
          timestamp: '2025-02-01T15:00:00Z',
          unitPrice: '50000',
          source: 'test',
        },
      ],
    });
    expect(r.disposals.map((d) => [d.kind, s(d.quantity), s(d.proceeds), s(d.gain)])).toEqual([
      ['fee', '0.001', '50', '30'],
    ]);
    expect(r.holdings.map((h) => [h.asset, s(h.quantity)])).toEqual([['BTC', '0.999']]);
  });

  it('a fiat fee on a currency exchange stays out of scope', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        {
          kind: 'trade',
          id: 'fx-2',
          timestamp: '2025-02-01T15:00:00Z',
          accountId: 'a',
          sent: usd('1000'),
          received: amt('900', 'fiat:EUR'),
          fee: usd('5'),
        },
      ],
    });
    expect(r.disposals).toEqual([]);
    expect(r.expenses).toEqual([]);
    expect(r.issues).toEqual([]);
  });
});
