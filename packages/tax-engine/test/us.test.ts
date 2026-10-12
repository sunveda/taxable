import { us } from '@svdt/rule-packs';
import { describe, expect, it } from 'vitest';
import { calculate, type UsSummary } from '../src';
import { amt, buy, income, s, sell, transfer, usd } from './helpers';

/**
 * Golden scenarios for the US rule pack. Expected figures are computed by hand and must
 * be confirmed by a US tax professional before the pack leaves `draft` (ADR-0007).
 */
const usSummary = (r: ReturnType<typeof calculate>): UsSummary => {
  if (r.summary.model !== 'us_capital_gains') throw new Error('expected US summary');
  return r.summary;
};

describe('US: purchase and sale with fees', () => {
  it('adds the purchase fee to basis and deducts the sale fee from proceeds', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-10T15:00:00Z', 'coinbase', amt('1', 'BTC'), usd('30000'), usd('10')),
        sell('2025-06-01T15:00:00Z', 'coinbase', amt('0.5', 'BTC'), usd('20000'), usd('10')),
      ],
    });
    expect(r.disposals).toHaveLength(1);
    const d = r.disposals[0]!;
    expect(s(d.proceeds)).toBe('20000');
    expect(s(d.sellingCosts)).toBe('10');
    expect(s(d.costBasis)).toBe('15005');
    expect(s(d.gain)).toBe('4985');
    expect(d.term).toBe('short');
    expect(d.ruleRefs).toEqual(
      expect.arrayContaining(['us.basis.methods', 'us.basis.per_wallet', 'us.holding_period']),
    );
    const summary = usSummary(r);
    expect(s(summary.shortTerm.gain)).toBe('4985');
    expect(s(summary.longTerm.gain)).toBe('0');
    expect(summary.form8949[0]).toMatchObject({
      part: 'I',
      dateAcquired: '2025-01-10',
      dateSold: '2025-06-01',
    });
    expect(s(summary.form8949[0]!.proceeds)).toBe('19990');
    expect(s(r.holdings[0]!.costBasis)).toBe('15005');
    expect(r.issues).toEqual([]);
  });
});

describe('US: lot selection and holding period', () => {
  const events = [
    buy('2024-01-15T17:00:00Z', 'kraken', amt('1', 'ETH'), usd('2000')),
    buy('2024-09-01T17:00:00Z', 'kraken', amt('1', 'ETH'), usd('4000')),
    sell('2025-03-01T17:00:00Z', 'kraken', amt('1.5', 'ETH'), usd('4500')),
  ];

  it('FIFO consumes the oldest lot first and splits the line by term', () => {
    const r = calculate({ rulePack: us, taxYear: 2025, events });
    expect(
      r.disposals.map((d) => [d.term, s(d.quantity), s(d.proceeds), s(d.costBasis), s(d.gain)]),
    ).toEqual([
      ['long', '1', '3000', '2000', '1000'],
      ['short', '0.5', '1500', '2000', '-500'],
    ]);
    const summary = usSummary(r);
    expect(s(summary.longTerm.gain)).toBe('1000');
    expect(s(summary.shortTerm.gain)).toBe('-500');
  });

  it('HIFO consumes the highest-cost lot first', () => {
    const r = calculate({ rulePack: us, taxYear: 2025, events, methods: { default: 'HIFO' } });
    expect(r.disposals.map((d) => [d.term, s(d.quantity), s(d.costBasis), s(d.gain)])).toEqual([
      ['short', '1', '4000', '-1000'],
      ['long', '0.5', '1000', '500'],
    ]);
  });

  it('is short-term on the one-year anniversary and long-term the day after', () => {
    const base = buy('2024-03-10T15:00:00Z', 'a', amt('2', 'BTC'), usd('20000'));
    const onAnniversary = sell('2025-03-10T15:00:00Z', 'a', amt('1', 'BTC'), usd('15000'));
    const dayAfter = sell('2025-03-11T15:00:00Z', 'a', amt('1', 'BTC'), usd('15000'));
    const r = calculate({ rulePack: us, taxYear: 2025, events: [base, onAnniversary, dayAfter] });
    expect(r.disposals.map((d) => d.term)).toEqual(['short', 'long']);
  });

  it('rejects methods the US does not allow, falling back to FIFO with an issue', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events,
      methods: { default: 'TOTAL_AVERAGE' },
    });
    expect(r.methods['ETH']).toBe('FIFO');
    expect(r.issues.map((i) => i.kind)).toContain('method_not_allowed');
  });
});

describe('US: per-wallet basis (Treas. Reg. §1.1012-1(j))', () => {
  it('uses only the selling wallet’s lots', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-02T15:00:00Z', 'wallet-a', amt('1', 'BTC'), usd('10000')),
        buy('2025-02-02T15:00:00Z', 'wallet-b', amt('1', 'BTC'), usd('50000')),
        sell('2025-03-02T15:00:00Z', 'wallet-b', amt('1', 'BTC'), usd('60000')),
      ],
    });
    // A universal FIFO pool would have used the $10,000 lot from wallet A.
    expect(s(r.disposals[0]!.costBasis)).toBe('50000');
    expect(s(r.disposals[0]!.gain)).toBe('10000');
    expect(r.holdings.map((h) => [h.accountId, s(h.quantity), s(h.costBasis)])).toEqual([
      ['wallet-a', '1', '10000'],
    ]);
  });

  it('moves basis and acquisition date with a self-transfer; the fee is a disposal', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2024-01-05T15:00:00Z', 'exchange', amt('2', 'ETH'), usd('4000')),
        transfer(
          '2024-06-01T15:00:00Z',
          'exchange',
          'ledger',
          'ETH',
          '1',
          amt('0.01', 'ETH', ['30', 'USD']),
        ),
        sell('2025-02-01T15:00:00Z', 'ledger', amt('1', 'ETH'), usd('3000')),
      ],
    });
    const sale = r.disposals.find((d) => d.kind === 'sale')!;
    expect(sale.acquiredAt).toBe('2024-01-05T15:00:00Z');
    expect(sale.term).toBe('long');
    expect(s(sale.costBasis)).toBe('2000');
    const moved = r.lots.find((l) => l.origin === 'transfer')!;
    expect(moved.parentLotId).not.toBeNull();
    expect(sale.lotId).toBe(moved.id);
    // The 2024 fee disposal belongs to 2024 and is not reported in 2025.
    expect(r.disposals.filter((d) => d.kind === 'fee')).toEqual([]);
    expect(r.holdings.map((h) => [h.accountId, s(h.quantity), s(h.costBasis)])).toEqual([
      ['exchange', '0.99', '1980'],
    ]);
  });

  it('reports a network fee paid in crypto as a disposal at market value', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-05T15:00:00Z', 'exchange', amt('1', 'ETH'), usd('2000')),
        transfer(
          '2025-02-01T15:00:00Z',
          'exchange',
          'ledger',
          'ETH',
          '0.9',
          amt('0.1', 'ETH', ['300', 'USD']),
        ),
      ],
    });
    expect(r.disposals.map((d) => [d.kind, s(d.proceeds), s(d.costBasis), s(d.gain)])).toEqual([
      ['fee', '300', '200', '100'],
    ]);
  });
});

describe('US: swaps and income', () => {
  it('treats a swap as a disposal at fair-market value; the new asset’s basis is that value', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-05T15:00:00Z', 'uniswap', amt('1', 'ETH'), usd('2000')),
        {
          kind: 'trade',
          id: 'swap-1',
          timestamp: '2025-02-05T15:00:00Z',
          accountId: 'uniswap',
          sent: amt('1', 'ETH'),
          received: amt('3000', 'USDC', ['3000', 'USD']),
        },
        sell('2025-03-05T15:00:00Z', 'uniswap', amt('3000', 'USDC'), usd('3000')),
      ],
    });
    expect(r.disposals.map((d) => [d.kind, d.asset, s(d.gain)])).toEqual([
      ['swap', 'ETH', '1000'],
      ['sale', 'USDC', '0'],
    ]);
    expect(r.disposals[0]!.ruleRefs).toContain('us.swap');
  });

  it('treats staking rewards as ordinary income and uses that value as basis', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        income('2025-04-01T15:00:00Z', 'staking', 'staking', amt('0.1', 'ETH')),
        sell('2025-05-01T15:00:00Z', 'staking', amt('0.1', 'ETH'), usd('350')),
      ],
      prices: [
        {
          asset: 'ETH',
          currency: 'USD',
          timestamp: '2025-04-01T00:00:00Z',
          unitPrice: '3000',
          source: 'test',
        },
      ],
    });
    expect(s(usSummary(r).ordinaryIncome)).toBe('300');
    expect(r.income[0]!.ruleRefs).toEqual(['us.income.staking']);
    expect(s(r.disposals[0]!.costBasis)).toBe('300');
    expect(s(r.disposals[0]!.gain)).toBe('50');
  });
});

describe('US: tax year boundaries and issues', () => {
  it('assigns events to the tax year in the taxpayer’s time zone', () => {
    const events = [
      buy('2024-06-01T15:00:00Z', 'a', amt('1', 'BTC'), usd('100')),
      // 2025-01-01 03:00 UTC is still 31 Dec 2024 in New York.
      sell('2025-01-01T03:00:00Z', 'a', amt('1', 'BTC'), usd('200')),
    ];
    expect(calculate({ rulePack: us, taxYear: 2024, events }).disposals).toHaveLength(1);
    expect(calculate({ rulePack: us, taxYear: 2025, events }).disposals).toHaveLength(0);
    expect(
      calculate({ rulePack: us, taxYear: 2025, events, timeZone: 'UTC' }).disposals,
    ).toHaveLength(1);
  });

  it('gives a zero basis to units sold without history and ranks the issue by impact', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('50000')),
        sell('2025-02-05T15:00:00Z', 'a', amt('1.5', 'BTC'), usd('90000')),
        sell('2025-02-06T15:00:00Z', 'b', amt('0.1', 'SOL'), usd('20')),
      ],
    });
    expect(
      r.disposals.filter((d) => d.basisShortfall).map((d) => [d.asset, s(d.quantity), s(d.gain)]),
    ).toEqual([
      ['BTC', '0.5', '30000'],
      ['SOL', '0.1', '20'],
    ]);
    expect(r.issues.map((i) => [i.kind, i.asset, s(i.impact.min)])).toEqual([
      ['negative_balance', 'BTC', '-30000'],
      ['negative_balance', 'SOL', '-20'],
    ]);
  });

  it('flags crypto sent to an unknown wallet with the gain it would realize if sold', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('50000')),
        {
          kind: 'external_withdrawal',
          id: 'out-1',
          timestamp: '2025-02-05T15:00:00Z',
          accountId: 'a',
          sent: amt('1', 'BTC', ['80000', 'USD']),
        },
      ],
    });
    expect(r.disposals).toEqual([]);
    expect(r.issues.map((i) => [i.kind, s(i.impact.max)])).toEqual([
      ['unmatched_withdrawal', '30000'],
    ]);
  });

  it('flags a missing price instead of guessing', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [income('2025-04-01T15:00:00Z', 'w', 'airdrop', amt('100', 'XYZ'))],
    });
    expect(r.issues.map((i) => i.kind)).toEqual(['missing_price']);
    expect(s(r.income[0]!.value)).toBe('0');
  });
});

describe('US: Rev. Proc. 2024-28 safe-harbor allocation', () => {
  const events = [
    buy('2023-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('20000')),
    buy('2023-06-05T15:00:00Z', 'b', amt('1', 'BTC'), usd('30000')),
    sell('2025-03-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('80000')),
  ];

  it('replaces wallet lots with the declared allocation as of 2025-01-01', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events,
      openingPositions: [
        {
          asOf: '2025-01-01T05:00:00Z',
          accountId: 'a',
          asset: 'BTC',
          reason: 'us_safe_harbor_2024_28',
          lots: [{ quantity: '1', costBasis: '30000', acquiredAt: '2023-06-05T15:00:00Z' }],
        },
        {
          asOf: '2025-01-01T05:00:00Z',
          accountId: 'b',
          asset: 'BTC',
          reason: 'us_safe_harbor_2024_28',
          lots: [{ quantity: '1', costBasis: '20000', acquiredAt: '2023-01-05T15:00:00Z' }],
        },
      ],
    });
    expect(s(r.disposals[0]!.costBasis)).toBe('30000');
    expect(r.disposals[0]!.ruleRefs).toContain('us.basis.per_wallet');
    expect(r.lots.find((l) => l.id === r.disposals[0]!.lotId)?.origin).toBe('opening_position');
    expect(r.issues).toEqual([]);
  });

  it('flags an allocation that does not match units actually held', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events,
      openingPositions: [
        {
          asOf: '2025-01-01T05:00:00Z',
          accountId: 'a',
          asset: 'BTC',
          reason: 'us_safe_harbor_2024_28',
          lots: [{ quantity: '2', costBasis: '50000', acquiredAt: '2023-01-05T15:00:00Z' }],
        },
      ],
    });
    expect(r.issues.map((i) => i.kind)).toContain('opening_position_mismatch');
  });
});
