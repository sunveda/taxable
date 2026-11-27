import type { LedgerEvent } from '@svdt/domain';
import { jp, us } from '@svdt/rule-packs';
import { describe, expect, it } from 'vitest';
import { calculate } from '../src';
import { amt } from './helpers';

/** Regression tests for the Codex review of sunveda/taxable#1 at c5c931a (engine findings). */
const depositWithBasis = (acquiredAt?: string, currency = 'USD'): LedgerEvent => ({
  kind: 'external_deposit',
  id: 'in-1',
  timestamp: '2025-01-10T15:00:00Z',
  accountId: 'a',
  received: amt('1', 'BTC'),
  costBasis: { amount: '20000', currency },
  ...(acquiredAt ? { acquiredAt } : {}),
});

describe('external deposits with a basis but no acquisition date', () => {
  it('US: raises missing_acquisition_date, since the holding period counts from arrival', () => {
    const r = calculate({ rulePack: us, taxYear: 2025, events: [depositWithBasis()] });
    const issue = r.issues.find((i) => i.kind === 'missing_acquisition_date');
    expect(issue).toMatchObject({
      eventIds: ['in-1'],
      asset: 'BTC',
      impactKnown: false,
      params: {
        asset: 'BTC',
        quantity: '1',
        costBasis: '20000',
        receivedAt: '2025-01-10T15:00:00Z',
      },
    });
  });

  it('US: dating the purchase at the arrival instant resolves it', () => {
    // What the web fix form sends when the user picks the arrival day itself.
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [depositWithBasis()],
      overrides: [
        {
          id: 'o-1',
          eventId: 'in-1',
          createdAt: '2026-01-01T00:00:00Z',
          author: 'user',
          action: {
            type: 'set_cost_basis',
            costBasis: '20000',
            acquiredAt: '2025-01-10T15:00:00Z',
          },
        },
      ],
    });
    expect(r.overrides.map((o) => o.status)).toEqual(['applied']);
    expect(r.issues.map((i) => i.kind)).toEqual([]);
  });

  it('US: no issue once the acquisition date is known', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [depositWithBasis('2022-06-01T15:00:00Z')],
    });
    expect(r.issues.map((i) => i.kind)).not.toContain('missing_acquisition_date');
  });

  it('Japan: no issue, since there is no holding-period rule', () => {
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [depositWithBasis(undefined, 'JPY')],
    });
    expect(r.issues.map((i) => i.kind)).not.toContain('missing_acquisition_date');
  });
});

describe('opening balances for missing history', () => {
  it('US: an opening balance is not reconciled against the (absent) history', () => {
    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events: [],
      openingPositions: [
        {
          asOf: '2025-01-01T05:00:00Z',
          accountId: 'a',
          asset: 'BTC',
          reason: 'opening_balance',
          lots: [{ quantity: '2', costBasis: '50000', acquiredAt: '2023-01-05T15:00:00Z' }],
        },
      ],
    });
    expect(r.issues.map((i) => i.kind)).not.toContain('opening_position_mismatch');
    expect(r.holdings.map((h) => [h.asset, h.quantity.toString()])).toEqual([['BTC', '2']]);
  });
});
