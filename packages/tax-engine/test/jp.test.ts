import { jp, UnsupportedTaxYearError } from '@svdt/rule-packs';
import { describe, expect, it } from 'vitest';
import { calculate, type JpSummary } from '../src';
import { amt, buy, income, jpy, s, sell, transfer } from './helpers';

/**
 * Golden scenarios for the Japan rule pack. Expected figures are computed by hand and must
 * be confirmed by a 税理士 before the pack leaves `draft` (ADR-0007).
 */
const jpSummary = (r: ReturnType<typeof calculate>): JpSummary => {
  if (r.summary.model !== 'jp_miscellaneous_income') throw new Error('expected JP summary');
  return r.summary;
};

// Buy 1 BTC for ¥1,000,000, sell 1 BTC for ¥2,500,000, then buy 1 BTC for ¥3,000,000.
const year = [
  buy('2025-02-01T03:00:00Z', 'bitflyer', amt('1', 'BTC'), jpy('1000000')),
  buy('2025-03-01T03:00:00Z', 'bitflyer', amt('1', 'BTC'), jpy('1000000')),
  sell('2025-04-01T03:00:00Z', 'bitflyer', amt('1', 'BTC'), jpy('2500000')),
  buy('2025-10-01T03:00:00Z', 'coincheck', amt('2', 'BTC'), jpy('6000000')),
];

describe('JP: total average method (総平均法), the default', () => {
  it('uses one average for the whole year, including later purchases', () => {
    const r = calculate({ rulePack: jp, taxYear: 2025, events: year });
    expect(r.methods['BTC']).toBe('TOTAL_AVERAGE');
    // Average = (1,000,000 + 1,000,000 + 6,000,000) / 4 = 2,000,000
    expect(
      r.disposals.map((d) => [s(d.proceeds), s(d.costBasis), s(d.gain), d.term, d.acquiredAt]),
    ).toEqual([['2500000', '2000000', '500000', null, null]]);
    const summary = jpSummary(r);
    expect(s(summary.miscellaneousIncome)).toBe('500000');
    expect(r.holdings.map((h) => [h.accountId, s(h.quantity), s(h.costBasis)])).toEqual([
      [null, '3', '6000000'],
    ]);
  });

  it('carries the closing average into the next year', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2026,
      events: [
        ...year,
        buy('2026-05-01T03:00:00Z', 'bitflyer', amt('1', 'BTC'), jpy('4000000')),
        sell('2026-06-01T03:00:00Z', 'coincheck', amt('2', 'BTC'), jpy('7000000')),
      ],
    });
    // Opening 3 BTC at ¥6,000,000 + 1 BTC at ¥4,000,000 → average ¥2,500,000.
    expect(r.disposals.map((d) => [s(d.quantity), s(d.costBasis), s(d.gain)])).toEqual([
      ['2', '5000000', '2000000'],
    ]);
    expect(s(r.holdings[0]!.costBasis)).toBe('5000000');
  });

  it('pools all exchanges together: transfers never change basis', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [...year, transfer('2025-11-01T03:00:00Z', 'coincheck', 'bitflyer', 'BTC', '2')],
    });
    expect(s(r.disposals[0]!.gain)).toBe('500000');
    expect(r.holdings).toHaveLength(1);
  });
});

describe('JP: moving average method (移動平均法), when elected', () => {
  it('uses the average as of each sale', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: year,
      methods: { byAsset: { BTC: 'MOVING_AVERAGE' } },
    });
    // At the April sale, average = 2,000,000 / 2 = 1,000,000.
    expect(r.disposals.map((d) => [s(d.costBasis), s(d.gain)])).toEqual([['1000000', '1500000']]);
    // Remaining: 1 BTC at ¥1,000,000 + 2 BTC at ¥6,000,000.
    expect(s(r.holdings[0]!.costBasis)).toBe('7000000');
  });

  it('rejects US-style lot methods, falling back to total average with an issue', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: year,
      methods: { default: 'FIFO' },
    });
    expect(r.methods['BTC']).toBe('TOTAL_AVERAGE');
    expect(r.issues.map((i) => i.kind)).toContain('method_not_allowed');
  });
});

describe('JP: swaps, fees, and income', () => {
  it('taxes a crypto-to-crypto swap at the value received', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [
        buy('2025-01-10T03:00:00Z', 'x', amt('10', 'ETH'), jpy('3000000')),
        {
          kind: 'trade',
          id: 'swap-1',
          timestamp: '2025-02-10T03:00:00Z',
          accountId: 'x',
          sent: amt('5', 'ETH'),
          received: amt('0.2', 'BTC', ['2000000', 'JPY']),
        },
      ],
    });
    expect(
      r.disposals.map((d) => [d.kind, d.asset, s(d.proceeds), s(d.costBasis), s(d.gain)]),
    ).toEqual([['swap', 'ETH', '2000000', '1500000', '500000']]);
    expect(r.disposals[0]!.ruleRefs).toEqual(
      expect.arrayContaining(['jp.swap', 'jp.basis.methods', 'jp.basis.scope']),
    );
    expect(r.lots.find((l) => l.asset === 'BTC')?.costBasis.toFixed()).toBe('2000000');
  });

  it('treats a transfer fee paid in crypto as a disposal plus a deductible expense', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [
        buy('2025-01-10T03:00:00Z', 'x', amt('1', 'BTC'), jpy('10000000')),
        transfer(
          '2025-03-10T03:00:00Z',
          'x',
          'y',
          'BTC',
          '0.999',
          amt('0.001', 'BTC', ['15000', 'JPY']),
        ),
      ],
    });
    // Disposal: ¥15,000 proceeds − ¥10,000 basis = ¥5,000; expense ¥15,000 → misc −¥10,000.
    expect(r.disposals.map((d) => [d.kind, s(d.gain)])).toEqual([['fee', '5000']]);
    const summary = jpSummary(r);
    expect(s(summary.expenses)).toBe('15000');
    expect(s(summary.miscellaneousIncome)).toBe('-10000');
    expect(s(summary.taxableMiscellaneousIncome)).toBe('0');
  });

  it('treats staking as income at market value; hard-fork coins have zero basis and no income', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [
        income('2025-05-01T03:00:00Z', 'x', 'staking', amt('1', 'ETH', ['500000', 'JPY'])),
        income('2025-06-01T03:00:00Z', 'x', 'hard_fork', amt('1', 'BCH')),
        sell('2025-07-01T03:00:00Z', 'x', amt('1', 'BCH'), jpy('60000')),
      ],
    });
    const summary = jpSummary(r);
    expect(s(summary.income.staking!)).toBe('500000');
    expect(summary.income.hard_fork).toBeUndefined();
    expect(r.disposals.map((d) => [d.asset, s(d.costBasis), s(d.gain)])).toEqual([
      ['BCH', '0', '60000'],
    ]);
    expect(s(summary.miscellaneousIncome)).toBe('560000');
    expect(r.issues).toEqual([]);
  });

  it('cannot offset a net loss against other income', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [
        buy('2025-01-10T03:00:00Z', 'x', amt('1', 'BTC'), jpy('10000000')),
        sell('2025-02-10T03:00:00Z', 'x', amt('1', 'BTC'), jpy('8000000')),
      ],
    });
    const summary = jpSummary(r);
    expect(s(summary.miscellaneousIncome)).toBe('-2000000');
    expect(s(summary.taxableMiscellaneousIncome)).toBe('0');
  });
});

describe('JP: tax year and supported years', () => {
  it('uses the calendar year in Japan Standard Time', () => {
    const events = [
      buy('2025-06-01T03:00:00Z', 'x', amt('1', 'BTC'), jpy('1000000')),
      // 2025-12-31 15:30 UTC is 2026-01-01 00:30 JST.
      sell('2025-12-31T15:30:00Z', 'x', amt('1', 'BTC'), jpy('2000000')),
    ];
    expect(calculate({ rulePack: jp, taxYear: 2025, events }).disposals).toHaveLength(0);
    expect(calculate({ rulePack: jp, taxYear: 2026, events }).disposals).toHaveLength(1);
    // The taxpayer can't override Japan's time zone.
    expect(calculate({ rulePack: jp, taxYear: 2026, events, timeZone: 'UTC' }).timeZone).toBe(
      'Asia/Tokyo',
    );
  });

  it('refuses 2028+, when separate taxation is expected to apply', () => {
    expect(() => calculate({ rulePack: jp, taxYear: 2028, events: [] })).toThrow(
      UnsupportedTaxYearError,
    );
  });
});
