import { dec, sum, type LedgerEvent } from '@svdt/domain';
import { jp, us, type CostBasisMethod, type RulePack } from '@svdt/rule-packs';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { calculate } from '../src';

/**
 * Property tests (tax-engine-spec §12): for any history of buys, sells and transfers,
 * units and basis are conserved and the result is deterministic.
 */
const ACCOUNTS = ['a', 'b', 'c'];
const quantity = fc.integer({ min: 1, max: 5000 }).map((n) => (n / 1000).toFixed(3));
const price = fc.integer({ min: 1, max: 100_000 }).map(String);

const step = fc.oneof(
  fc.record({
    kind: fc.constant('buy' as const),
    account: fc.constantFrom(...ACCOUNTS),
    quantity,
    price,
  }),
  fc.record({
    kind: fc.constant('sell' as const),
    account: fc.constantFrom(...ACCOUNTS),
    quantity,
    price,
  }),
  fc.record({
    kind: fc.constant('transfer' as const),
    from: fc.constantFrom(...ACCOUNTS),
    to: fc.constantFrom(...ACCOUNTS),
    quantity,
  }),
);

type Step = typeof step extends fc.Arbitrary<infer T> ? T : never;

function toEvents(steps: Step[], currency: string): LedgerEvent[] {
  const fiat = `fiat:${currency}`;
  return steps.map((st, i) => {
    const timestamp = new Date(Date.UTC(2025, 0, 2) + i * 3_600_000).toISOString();
    const id = `e${String(i).padStart(4, '0')}`;
    switch (st.kind) {
      case 'buy':
        return {
          kind: 'trade',
          id,
          timestamp,
          accountId: st.account,
          sent: { asset: fiat, quantity: st.price },
          received: { asset: 'BTC', quantity: st.quantity },
        };
      case 'sell':
        return {
          kind: 'trade',
          id,
          timestamp,
          accountId: st.account,
          sent: { asset: 'BTC', quantity: st.quantity },
          received: { asset: fiat, quantity: st.price },
        };
      case 'transfer':
        return {
          kind: 'transfer',
          id,
          timestamp,
          fromAccountId: st.from,
          toAccountId: st.to,
          asset: 'BTC',
          quantity: st.quantity,
        };
    }
  });
}

const cases: [RulePack, CostBasisMethod][] = [
  [us, 'FIFO'],
  [us, 'HIFO'],
  [us, 'LIFO'],
  [jp, 'TOTAL_AVERAGE'],
  [jp, 'MOVING_AVERAGE'],
];

describe.each(cases)('properties: %s / %s', (pack, method) => {
  it('conserves units and basis', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 40 }), (steps) => {
        const events = toEvents(steps, pack.reportingCurrency);
        const r = calculate({
          rulePack: pack,
          taxYear: 2025,
          events,
          methods: { default: method },
        });

        const bought = sum(steps.filter((x) => x.kind === 'buy').map((x) => dec(x.quantity)));
        const basisBought = sum(steps.filter((x) => x.kind === 'buy').map((x) => dec(x.price)));
        const sold = sum(r.disposals.map((d) => d.quantity));
        const held = sum(r.holdings.map((h) => h.quantity));
        const shortfall = sum(r.disposals.filter((d) => d.basisShortfall).map((d) => d.quantity));
        const transferShortfall = sum(
          r.lots.filter((l) => l.origin === 'shortfall').map((l) => l.quantity),
        );

        // Units: everything bought (plus units conjured to cover shortfalls) is sold or held.
        expect(
          bought.plus(shortfall).plus(transferShortfall).minus(sold).minus(held).isZero(),
        ).toBe(true);

        // Basis: everything paid is either consumed by disposals or still held.
        const consumed = sum(r.disposals.map((d) => d.costBasis));
        const heldBasis = sum(r.holdings.map((h) => h.costBasis));
        const drift = basisBought.minus(consumed).minus(heldBasis).abs();
        expect(drift.lessThan('1e-30')).toBe(true);

        // Gains add up.
        for (const d of r.disposals) {
          expect(d.gain.equals(d.proceeds.minus(d.sellingCosts).minus(d.costBasis))).toBe(true);
        }
      }),
      { numRuns: 150 },
    );
  });

  it('is deterministic regardless of input order', () => {
    fc.assert(
      fc.property(fc.array(step, { maxLength: 25 }), (steps) => {
        const events = toEvents(steps, pack.reportingCurrency);
        const opts = { rulePack: pack, taxYear: 2025, methods: { default: method } } as const;
        const a = calculate({ ...opts, events });
        const b = calculate({ ...opts, events: [...events].reverse() });
        expect(JSON.stringify(b)).toBe(JSON.stringify(a));
      }),
      { numRuns: 50 },
    );
  });
});
