import { jp, us } from '@svdt/rule-packs';
import { describe, expect, it } from 'vitest';
import { calculate } from '../src';
import { amt, buy, jpy, s, sell, usd } from './helpers';

/** Regression tests for the code review of sunveda/taxable#1 (one block per finding). */
const quote = (asset: string, currency: string, timestamp: string, unitPrice: string) => ({
  asset,
  currency,
  timestamp,
  unitPrice,
  source: 'test',
});

describe('#1 trade fee paid in the asset received', () => {
  const trade = buy(
    '2025-03-01T15:00:00Z',
    'kraken',
    amt('0.01', 'BTC'),
    usd('1000'),
    amt('0.0001', 'BTC', ['10', 'USD']),
  );

  it('US: spends the fee from the coins just bought, with no negative balance', () => {
    const r = calculate({ rulePack: us, taxYear: 2025, events: [trade] });
    expect(r.issues).toEqual([]);
    expect(
      r.disposals.map((d) => [
        d.kind,
        s(d.quantity),
        s(d.proceeds),
        s(d.costBasis),
        d.basisShortfall,
      ]),
    ).toEqual([['fee', '0.0001', '10', '10.1', false]]);
    expect(r.holdings.map((h) => [s(h.quantity), s(h.costBasis)])).toEqual([['0.0099', '999.9']]);
  });

  it('JP: holdings are net of the fee', () => {
    const jpTrade = buy(
      '2025-03-01T03:00:00Z',
      'bitflyer',
      amt('0.01', 'BTC'),
      jpy('150000'),
      amt('0.0001', 'BTC', ['1500', 'JPY']),
    );
    const r = calculate({ rulePack: jp, taxYear: 2025, events: [jpTrade] });
    expect(r.issues).toEqual([]);
    expect(s(r.holdings[0]!.quantity)).toBe('0.0099');
  });
});

describe('#2 history older than the rule pack', () => {
  it('uses the earliest supported rules and flags it, instead of failing', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [
        buy('2013-06-01T03:00:00Z', 'mtgox', amt('1', 'BTC'), jpy('10000')),
        sell('2025-06-01T03:00:00Z', 'mtgox', amt('1', 'BTC'), jpy('15000000')),
      ],
    });
    expect(r.disposals.map((d) => [s(d.costBasis), s(d.gain)])).toEqual([['10000', '14990000']]);
    expect(r.issues.map((i) => [i.kind, i.taxYear, i.impactKnown])).toEqual([
      ['unsupported_history_year', 2013, false],
    ]);
  });

  it('still refuses a tax year the pack cannot compute', () => {
    expect(() => calculate({ rulePack: jp, taxYear: 2013, events: [] })).toThrow(/2013/);
  });
});

describe('#5 shortfall on an unpriced disposal', () => {
  const swap = {
    kind: 'trade' as const,
    id: 'swap-1',
    timestamp: '2025-04-01T15:00:00Z',
    accountId: 'w',
    sent: amt('100', 'XYZ'),
    received: amt('5', 'ABC'),
  };

  it('estimates the impact from the nearest price when one exists', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [swap],
      prices: [quote('XYZ', 'USD', '2025-03-25T00:00:00Z', '2')],
    });
    const nb = r.issues.find((i) => i.kind === 'negative_balance')!;
    expect([nb.impactKnown, s(nb.impact.min)]).toEqual([true, '-200']);
  });

  it('marks the impact unknown, not zero, when there is no price at all', () => {
    const r = calculate({ rulePack: us, taxYear: 2025, events: [swap] });
    const nb = r.issues.find((i) => i.kind === 'negative_balance')!;
    expect(nb.impactKnown).toBe(false);
  });
});

describe('#6 other issues use the nearest-price estimate', () => {
  it('missing_basis and unmatched_withdrawal get an estimated impact', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        {
          kind: 'external_deposit',
          id: 'in-1',
          timestamp: '2025-02-01T15:00:00Z',
          accountId: 'a',
          received: amt('1', 'BTC'),
        },
        {
          kind: 'external_withdrawal',
          id: 'out-1',
          timestamp: '2025-02-10T15:00:00Z',
          accountId: 'a',
          sent: amt('1', 'BTC'),
        },
      ],
      prices: [quote('BTC', 'USD', '2025-01-28T00:00:00Z', '90000')],
    });
    expect(r.issues.map((i) => [i.kind, i.impactKnown, s(i.impact.min), s(i.impact.max)])).toEqual([
      ['missing_basis', true, '-90000', '0'],
      ['unmatched_withdrawal', true, '0', '90000'],
    ]);
  });
});

describe('#8 report rounding', () => {
  it('JP: reported figures are whole yen, truncated, derived from rounded components', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [
        buy('2025-01-10T03:00:00Z', 'x', amt('3', 'BTC'), jpy('1000000')),
        sell('2025-02-10T03:00:00Z', 'x', amt('1', 'BTC'), jpy('500000.9')),
      ],
    });
    if (r.summary.model !== 'jp_miscellaneous_income') throw new Error('expected JP');
    // Basis 1,000,000 / 3 = 333,333.33…
    expect(s(r.summary.miscellaneousIncome).startsWith('166667.5666')).toBe(true);
    expect(r.summary.reported).toEqual(
      expect.objectContaining({ revenue: expect.anything(), necessaryExpenses: expect.anything() }),
    );
    expect([
      s(r.summary.reported.revenue),
      s(r.summary.reported.necessaryExpenses),
      s(r.summary.reported.miscellaneousIncome),
    ]).toEqual(['500000', '333333', '166667']);
  });

  it('US: Form 8949 totals equal the sum of the rounded lines', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        buy('2025-01-10T15:00:00Z', 'a', amt('3', 'ETH'), usd('1000')),
        sell('2025-02-10T15:00:00Z', 'a', amt('1', 'ETH'), usd('400')),
        sell('2025-02-11T15:00:00Z', 'a', amt('1', 'ETH'), usd('400')),
        sell('2025-02-12T15:00:00Z', 'a', amt('1', 'ETH'), usd('400')),
      ],
    });
    if (r.summary.model !== 'us_capital_gains') throw new Error('expected US');
    // Each line's basis rounds 333.333… → 333.33, so the lines total 999.99 while the
    // unrounded bucket says 1000. The totals carried to Schedule D must match the lines.
    expect(r.summary.form8949.map((l) => s(l.costBasis))).toEqual(['333.33', '333.33', '333.33']);
    expect(s(r.summary.shortTerm.costBasis)).toBe('1000');
    expect(s(r.summary.form8949Totals.partI.costBasis)).toBe('999.99');
    expect(s(r.summary.form8949Totals.partI.gain)).toBe('200.01');
    expect(s(r.summary.reportedOrdinaryIncome)).toBe('0');
  });
});
