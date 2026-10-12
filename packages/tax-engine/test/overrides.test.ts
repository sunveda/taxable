import { jp, us } from '@svdt/rule-packs';
import { describe, expect, it } from 'vitest';
import { calculate, type CalculationInput, type Override, type OverrideAction } from '../src';
import { amt, buy, income, s, sell, usd } from './helpers';

/** Override layer (ADR-0009) and suggested resolutions (spec §8). */
const quote = (asset: string, currency: string, timestamp: string, unitPrice: string) => ({
  asset,
  currency,
  timestamp,
  unitPrice,
  source: 'test',
});

let n = 0;
const override = (
  eventId: string,
  action: OverrideAction,
  createdAt = '2026-01-01T00:00:00Z',
): Override => ({ id: `ov-${++n}`, eventId, createdAt, author: 'user', action });

const airdrop = income('2025-04-01T15:00:00Z', 'w', 'airdrop', amt('100', 'XYZ'));
const deposit = {
  kind: 'external_deposit' as const,
  id: 'dep-1',
  timestamp: '2025-01-10T15:00:00Z',
  accountId: 'a',
  received: amt('1', 'ETH'),
};
const sellEth = sell('2025-06-01T15:00:00Z', 'a', amt('1', 'ETH'), usd('3000'));
const withdrawal = {
  kind: 'external_withdrawal' as const,
  id: 'out-1',
  timestamp: '2025-03-01T15:00:00Z',
  accountId: 'a',
  sent: amt('1', 'BTC'),
};
const buyBtc = buy('2025-01-05T15:00:00Z', 'a', amt('1', 'BTC'), usd('40000'));
const btcPrice = [quote('BTC', 'USD', '2025-03-01T12:00:00Z', '50000')];

const run = (extra: Partial<CalculationInput>) =>
  calculate({ rulePack: us, taxYear: 2025, events: [], ...extra });

describe('suggested resolutions', () => {
  it('suggests the nearest price for a missing price, and applying it resolves the issue', () => {
    const prices = [quote('XYZ', 'USD', '2025-03-25T00:00:00Z', '5')];
    const before = run({ events: [airdrop], prices });
    const issue = before.issues.find((i) => i.kind === 'missing_price')!;
    expect(issue.suggestedResolution).toMatchObject({
      override: {
        eventId: airdrop.id,
        action: { type: 'set_unit_price', asset: 'XYZ', unitPrice: '5' },
      },
      confidence: 0.4, // quote is about a week away
      params: { quotedAt: '2025-03-25T00:00:00Z' },
    });

    const s1 = issue.suggestedResolution!.override;
    const after = run({ events: [airdrop], prices, overrides: [override(s1.eventId, s1.action)] });
    expect(after.issues.filter((i) => i.kind === 'missing_price')).toEqual([]);
    expect(s(after.income[0]!.value)).toBe('500');
    expect(after.overrides.map((o) => o.status)).toEqual(['applied']);
  });

  it('offers no price suggestion when there is no quote at all', () => {
    const r = run({ events: [airdrop] });
    expect(r.issues.find((i) => i.kind === 'missing_price')!.suggestedResolution).toBeUndefined();
  });

  it('suggests "own wallet" for an unmatched withdrawal, and accepting it clears the issue', () => {
    const before = run({ events: [buyBtc, withdrawal], prices: btcPrice });
    const issue = before.issues.find((i) => i.kind === 'unmatched_withdrawal')!;
    expect(issue.suggestedResolution?.override).toEqual({
      eventId: 'out-1',
      action: { type: 'classify_withdrawal', as: 'own_wallet' },
    });

    const s1 = issue.suggestedResolution!.override;
    const after = run({
      events: [buyBtc, withdrawal],
      prices: btcPrice,
      overrides: [override(s1.eventId, s1.action)],
    });
    expect(after.issues).toEqual([]);
    expect(after.disposals).toEqual([]);
  });

  it('has no suggestion for a missing basis: only the user knows what they paid', () => {
    const r = run({ events: [deposit, sellEth] });
    expect(r.issues.find((i) => i.kind === 'missing_basis')!.suggestedResolution).toBeUndefined();
  });
});

describe('override actions', () => {
  it('set_cost_basis gives an external deposit its basis and acquisition date', () => {
    const r = run({
      events: [deposit, sellEth],
      overrides: [
        override('dep-1', {
          type: 'set_cost_basis',
          costBasis: '1200',
          acquiredAt: '2023-01-01T00:00:00Z',
        }),
      ],
    });
    expect(r.issues).toEqual([]);
    const d = r.disposals[0]!;
    expect([s(d.costBasis), s(d.gain), d.term]).toEqual(['1200', '1800', 'long']);
  });

  it('classify_withdrawal "spent" makes it a disposal at market value', () => {
    const r = run({
      events: [buyBtc, withdrawal],
      prices: btcPrice,
      overrides: [override('out-1', { type: 'classify_withdrawal', as: 'spent' })],
    });
    expect(r.issues).toEqual([]);
    expect(r.disposals.map((d) => [d.kind, s(d.proceeds), s(d.gain), d.term])).toEqual([
      ['spend', '50000', '10000', 'short'],
    ]);
  });

  it('classify_withdrawal "spent" with stated proceeds uses them', () => {
    const r = run({
      events: [buyBtc, withdrawal],
      overrides: [
        override('out-1', { type: 'classify_withdrawal', as: 'spent', proceeds: '45000' }),
      ],
    });
    expect(r.disposals.map((d) => s(d.gain))).toEqual(['5000']);
  });

  it('classify_withdrawal "spent" with no price raises a missing-price issue', () => {
    const r = run({
      events: [buyBtc, withdrawal],
      overrides: [override('out-1', { type: 'classify_withdrawal', as: 'spent' })],
    });
    expect(r.issues.map((i) => i.kind)).toEqual(['missing_price']);
    expect(s(r.disposals[0]!.proceeds)).toBe('0');
  });

  it('set_unit_price values every amount of that asset in the event (including the fee)', () => {
    const swap = {
      kind: 'trade' as const,
      id: 'swap-1',
      timestamp: '2025-05-01T00:00:00Z',
      accountId: 'b',
      sent: amt('10', 'ABC'),
      received: amt('2', 'DEF'),
      fee: amt('1', 'ABC'),
    };
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [swap],
      overrides: [override('swap-1', { type: 'set_unit_price', asset: 'ABC', unitPrice: '100' })],
    });
    expect(r.issues.filter((i) => i.kind === 'missing_price')).toEqual([]);
    const fee = r.disposals.find((d) => d.kind === 'fee')!;
    expect(s(fee.proceeds)).toBe('100');
    expect(s(r.lots.find((l) => l.asset === 'DEF')!.costBasis)).toBe('1000');
  });
});

describe('override history', () => {
  const basis = (amount: string, createdAt: string): Override =>
    override('dep-1', { type: 'set_cost_basis', costBasis: amount }, createdAt);

  it('latest override wins, regardless of input order', () => {
    const older = basis('1000', '2026-01-01T00:00:00Z');
    const newer = basis('2000', '2026-02-01T00:00:00Z');
    const r = run({ events: [deposit, sellEth], overrides: [newer, older] });
    expect(s(r.disposals[0]!.costBasis)).toBe('2000');
    expect(r.overrides.map((o) => [o.overrideId, o.status])).toEqual([
      [older.id, 'superseded'],
      [newer.id, 'applied'],
    ]);
  });

  it('revoking the latest override falls back to the one before it', () => {
    const older = basis('1000', '2026-01-01T00:00:00Z');
    const newer = basis('2000', '2026-02-01T00:00:00Z');
    const revoke = override(
      'dep-1',
      { type: 'revoke', overrideId: newer.id },
      '2026-03-01T00:00:00Z',
    );
    const r = run({ events: [deposit, sellEth], overrides: [older, newer, revoke] });
    expect(s(r.disposals[0]!.costBasis)).toBe('1000');
    expect(r.overrides.map((o) => o.status)).toEqual(['applied', 'revoked', 'applied']);
  });

  it('an invalid later override does not displace a valid earlier one', () => {
    const good = basis('1000', '2026-01-01T00:00:00Z');
    const bad = basis('-5', '2026-02-01T00:00:00Z');
    const r = run({ events: [deposit, sellEth], overrides: [good, bad] });
    expect(s(r.disposals[0]!.costBasis)).toBe('1000');
    expect(r.overrides.map((o) => [o.status, o.reason])).toEqual([
      ['applied', undefined],
      ['not_applicable', 'invalid_amount'],
    ]);
    expect(r.issues.map((i) => [i.kind, i.params['reason']])).toEqual([
      ['invalid_override', 'invalid_amount'],
    ]);
  });
});

describe('overrides that cannot apply', () => {
  it('an override whose event disappeared becomes an unknown-impact issue', () => {
    const r = run({
      events: [sellEth],
      overrides: [override('gone-1', { type: 'set_cost_basis', costBasis: '1' })],
    });
    const orphan = r.issues.find((i) => i.kind === 'orphaned_override')!;
    expect([orphan.impactKnown, orphan.eventIds]).toEqual([false, ['gone-1']]);
    expect(r.overrides[0]!.status).toBe('event_not_found');
  });

  it.each<[string, OverrideAction, string]>([
    ['dep-1', { type: 'classify_withdrawal', as: 'own_wallet' }, 'event_kind_mismatch'],
    ['out-1', { type: 'set_cost_basis', costBasis: '1' }, 'event_kind_mismatch'],
    ['out-1', { type: 'set_unit_price', asset: 'ETH', unitPrice: '1' }, 'asset_not_in_event'],
    [
      'out-1',
      { type: 'set_unit_price', asset: 'fiat:USD', unitPrice: '1' },
      'report_currency_has_no_price',
    ],
    ['out-1', { type: 'set_unit_price', asset: 'BTC', unitPrice: 'abc' }, 'invalid_amount'],
    ['out-1', { type: 'classify_withdrawal', as: 'own_wallet', proceeds: '5' }, 'invalid_amount'],
    [
      'dep-1',
      { type: 'set_cost_basis', costBasis: '1', acquiredAt: '2025-02-01T00:00:00Z' },
      'acquired_after_receipt',
    ],
    [
      'dep-1',
      { type: 'set_cost_basis', costBasis: '1', acquiredAt: '2025-13-01T00:00:00Z' },
      'invalid_timestamp',
    ],
    ['dep-1', { type: 'revoke', overrideId: 'nope' }, 'target_not_found'],
  ])('%s %j is rejected as %s', (eventId, action, reason) => {
    const r = run({ events: [deposit, withdrawal], overrides: [override(eventId, action)] });
    expect(r.overrides[0]).toMatchObject({ status: 'not_applicable', reason });
  });

  it('is deterministic: same input, same output', () => {
    const input: CalculationInput = {
      rulePack: us,
      taxYear: 2025,
      events: [deposit, sellEth, buyBtc, withdrawal],
      prices: btcPrice,
      overrides: [
        override('dep-1', { type: 'set_cost_basis', costBasis: '1000' }),
        override('out-1', { type: 'classify_withdrawal', as: 'spent' }),
      ],
    };
    expect(JSON.stringify(calculate(input))).toBe(JSON.stringify(calculate(input)));
  });
});
