import { jp, us } from '@svdt/rule-packs';
import { describe, expect, it } from 'vitest';
import { calculate } from '../src';
import { amt, income, jpy, s, sell, usd } from './helpers';

/**
 * Regression tests for fix-queue ordering (gap review 2026-10, D1): a missing price used to
 * report zero impact and sink to the bottom of the queue however large it was.
 */
const quote = (asset: string, currency: string, timestamp: string, unitPrice: string) => ({
  asset,
  currency,
  timestamp,
  unitPrice,
  source: 'test',
});

describe('fix queue: missing prices', () => {
  // 0.1 SOL sold with no history: a known $20 negative-balance issue.
  const smallKnownIssue = sell('2025-02-06T15:00:00Z', 'b', amt('0.1', 'SOL'), usd('20'));
  // 100 XYZ airdropped with no price at that time.
  const airdrop = income('2025-04-01T15:00:00Z', 'w', 'airdrop', amt('100', 'XYZ'));

  it('estimates impact from the nearest price and ranks a large missing price first', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [smallKnownIssue, airdrop],
      // A week away: too old to value the event, close enough to rank the issue.
      prices: [quote('XYZ', 'USD', '2025-03-25T00:00:00Z', '5')],
    });
    expect(r.issues.map((i) => [i.kind, i.impactKnown, s(i.impact.min), s(i.impact.max)])).toEqual([
      ['missing_price', true, '0', '500'],
      ['negative_balance', true, '-20', '0'],
    ]);
    expect(r.issues[0]!.params['estimate']).toBe('500');
    // The estimate is for ranking only: reported income stays 0 until a real price exists.
    expect(s(r.income[0]!.value)).toBe('0');
  });

  it('ranks an unknown impact below known non-zero issues and above zero-impact ones', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [smallKnownIssue, airdrop],
      methods: { default: 'TOTAL_AVERAGE' }, // not allowed in the US → zero-impact issue
    });
    expect(r.issues.map((i) => [i.kind, i.impactKnown])).toEqual([
      ['negative_balance', true],
      ['missing_price', false],
      ['method_not_allowed', true],
      ['method_not_allowed', true],
    ]);
  });

  it('treats an unpriced fee as moving the result either way', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [
        {
          kind: 'fee',
          id: 'gas-1',
          timestamp: '2025-05-01T03:00:00Z',
          accountId: 'x',
          fee: amt('0.01', 'ETH'),
        },
        sell('2025-05-02T03:00:00Z', 'x', amt('1', 'BTC'), jpy('100')),
      ],
      prices: [quote('ETH', 'JPY', '2025-04-01T00:00:00Z', '500000')],
    });
    const missing = r.issues.find((i) => i.kind === 'missing_price')!;
    expect([s(missing.impact.min), s(missing.impact.max), missing.impactKnown]).toEqual([
      '-5000',
      '5000',
      true,
    ]);
  });
});

describe('fix queue: other unknown impacts', () => {
  it('marks crypto sent beyond known holdings as unknown impact', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [
        {
          kind: 'external_withdrawal',
          id: 'out-1',
          timestamp: '2025-02-05T15:00:00Z',
          accountId: 'a',
          sent: amt('1', 'ETH'),
        },
      ],
    });
    expect(r.issues.map((i) => [i.kind, i.impactKnown])).toEqual([
      ['negative_balance', false],
      ['unmatched_withdrawal', false],
    ]);
  });
});
