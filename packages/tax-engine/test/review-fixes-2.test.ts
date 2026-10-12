import type { LedgerEvent } from '@svdt/domain';
import { jp, us } from '@svdt/rule-packs';
import { describe, expect, it } from 'vitest';
import { calculate } from '../src';
import { amt, buy, s, usd } from './helpers';

/** Regression tests for the second code review of sunveda/taxable#1 (engine findings). */
const quote = (asset: string, currency: string, timestamp: string, unitPrice: string) => ({
  asset,
  currency,
  timestamp,
  unitPrice,
  source: 'test',
});

describe('#1 events in the same second', () => {
  const t = '2025-03-01T10:00:00Z';
  // Ids chosen so the sell sorts first alphabetically, as content hashes can.
  const sellFirstById: LedgerEvent = {
    kind: 'trade',
    id: 'a-sell',
    timestamp: t,
    accountId: 'x',
    sent: amt('0.1', 'BTC'),
    received: usd('6000'),
  };
  const buyLastById: LedgerEvent = {
    kind: 'trade',
    id: 'z-buy',
    timestamp: t,
    accountId: 'x',
    sent: usd('5000'),
    received: amt('0.1', 'BTC'),
  };

  it.each([
    ['sell listed first', [sellFirstById, buyLastById]],
    ['buy listed first', [buyLastById, sellFirstById]],
  ])('applies the acquisition before the disposal (%s)', (_name, events) => {
    const r = calculate({ rulePack: us, taxYear: 2025, events });
    expect(r.issues).toEqual([]);
    expect(r.disposals.map((d) => [s(d.costBasis), s(d.gain), d.basisShortfall])).toEqual([
      ['5000', '1000', false],
    ]);
    expect(r.holdings).toEqual([]);
  });
});

describe('#4 rule citations carried on lots', () => {
  it('a sale of safe-harbor lots cites Rev. Proc. 2024-28', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2023-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('20000')),
        {
          kind: 'trade',
          id: 'sell-1',
          timestamp: '2025-03-05T15:00:00Z',
          accountId: 'a',
          sent: amt('1', 'BTC'),
          received: usd('80000'),
        },
      ],
      openingPositions: [
        {
          asOf: '2025-01-01T05:00:00Z',
          accountId: 'a',
          asset: 'BTC',
          reason: 'us_safe_harbor_2024_28',
          lots: [{ quantity: '1', costBasis: '25000', acquiredAt: '2023-01-05T15:00:00Z' }],
        },
      ],
    });
    expect(r.disposals[0]!.ruleRefs).toContain('us.safe_harbor');
    expect(r.lots.find((l) => l.origin === 'opening_position')!.ruleRefs).toEqual([
      'us.safe_harbor',
    ]);
  });

  it('a capitalised purchase fee is cited on the lot, after a transfer, and on the sale', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-05T15:00:00Z', 'exchange', amt('1', 'ETH'), usd('2000'), usd('10')),
        {
          kind: 'transfer',
          id: 'x-1',
          timestamp: '2025-01-06T15:00:00Z',
          fromAccountId: 'exchange',
          toAccountId: 'ledger',
          asset: 'ETH',
          quantity: '1',
        },
        {
          kind: 'trade',
          id: 'sell-2',
          timestamp: '2025-02-05T15:00:00Z',
          accountId: 'ledger',
          sent: amt('1', 'ETH'),
          received: usd('2500'),
        },
      ],
    });
    expect(r.lots.map((l) => [l.origin, l.ruleRefs])).toEqual([
      ['purchase', ['us.trade_fee']],
      ['transfer', ['us.trade_fee']],
    ]);
    expect(r.disposals[0]!.ruleRefs).toContain('us.trade_fee');
  });
});

describe('#6 direction of a missing purchase price', () => {
  it('a purchase paid in another fiat lowers later gains when priced', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        {
          kind: 'trade',
          id: 'eur-buy',
          timestamp: '2025-03-01T10:00:00Z',
          accountId: 'x',
          sent: amt('900', 'fiat:EUR'),
          received: amt('0.01', 'BTC'),
        },
      ],
      prices: [quote('BTC', 'USD', '2025-02-20T00:00:00Z', '100000')],
    });
    const missing = r.issues.find((i) => i.kind === 'missing_price')!;
    expect([s(missing.impact.min), s(missing.impact.max), missing.impactKnown]).toEqual([
      '-1000',
      '0',
      true,
    ]);
  });

  it('an unpriced swap could go either way', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [
        {
          kind: 'trade',
          id: 'swap',
          timestamp: '2025-03-01T03:00:00Z',
          accountId: 'x',
          sent: amt('10', 'AAA'),
          received: amt('5', 'BBB'),
        },
      ],
      prices: [quote('BBB', 'JPY', '2025-02-01T00:00:00Z', '100')],
    });
    const missing = r.issues.find((i) => i.kind === 'missing_price')!;
    expect([s(missing.impact.min), s(missing.impact.max)]).toEqual(['-500', '500']);
  });
});

describe('#8 price lookups', () => {
  // Hourly quotes for 30 days: price = hour index.
  const quotes = Array.from({ length: 24 * 30 }, (_, h) =>
    quote('BTC', 'USD', new Date(Date.UTC(2025, 0, 1, h)).toISOString(), String(h)),
  );
  const sale = (ts: string): LedgerEvent => ({
    kind: 'income',
    id: `inc-${ts}`,
    timestamp: ts,
    accountId: 'a',
    incomeType: 'staking',
    received: amt('1', 'BTC'),
  });

  it.each([
    ['exactly on a quote', '2025-01-02T05:00:00.000Z', '29'],
    ['between quotes: latest at or before', '2025-01-02T05:59:59.000Z', '29'],
    // 06:00 UTC: early times on 1 January are still 2024 in New York.
    ['a quote on the first day', '2025-01-01T06:00:00.000Z', '6'],
  ])('%s', (_name, ts, expected) => {
    const r = calculate({ rulePack: us, taxYear: 2025, events: [sale(ts)], prices: quotes });
    expect(s(r.income[0]!.value)).toBe(expected);
  });

  it('rejects quotes older than a day, and estimates from the nearest one', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [sale('2025-03-01T00:00:00Z')],
      prices: quotes,
    });
    expect(s(r.income[0]!.value)).toBe('0');
    const missing = r.issues.find((i) => i.kind === 'missing_price')!;
    expect(missing.params['estimate']).toBe('719');
  });
});
