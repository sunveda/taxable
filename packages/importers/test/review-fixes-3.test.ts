import { describe, expect, it } from 'vitest';
import { importCsv } from '../src';
import { isFiatTicker, normalizeTicker } from '../src/assets';

/** Regression tests for the third review of sunveda/taxable#1 (Codex, importer findings). */
const HEADER =
  'timestamp,type,received_asset,received_quantity,cost_basis,cost_basis_currency,acquired_at';

const deposit = (cells: string): ReturnType<typeof importCsv> =>
  importCsv([HEADER, cells].join('\n'), { accountId: 'w' });

describe('canonical deposits', () => {
  it('rejects a negative cost basis', () => {
    const r = deposit('2025-03-01T00:00:00Z,deposit,BTC,1,-500,USD,');
    expect(r.events).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['invalid_number']);
  });

  it('accepts a zero cost basis', () => {
    const r = deposit('2025-03-01T00:00:00Z,deposit,BTC,1,0,USD,');
    expect(r.warnings).toEqual([]);
    expect(r.events).toHaveLength(1);
  });

  it('rejects an acquisition date after the deposit', () => {
    const r = deposit('2025-03-01T00:00:00Z,deposit,BTC,1,100,USD,2025-04-01T00:00:00Z');
    expect(r.events).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['invalid_timestamp']);
  });

  it('accepts an acquisition date at or before the deposit', () => {
    const r = deposit('2025-03-01T00:00:00Z,deposit,BTC,1,100,USD,2025-03-01T00:00:00Z');
    expect(r.warnings).toEqual([]);
    expect(r.events).toHaveLength(1);
  });
});

describe('fiat currencies', () => {
  it('recognises common ISO currencies beyond the original ten', () => {
    for (const code of ['NZD', 'MXN', 'CNY', 'INR', 'BRL', 'ZAR', 'TRY']) {
      expect(normalizeTicker(code)).toBe(`fiat:${code}`);
      expect(isFiatTicker(code)).toBe(true);
    }
  });

  it('keeps codes that are also crypto tickers as crypto unless written as fiat:XXX', () => {
    expect(normalizeTicker('MNT')).toBe('MNT');
    expect(normalizeTicker('SCR')).toBe('SCR');
    expect(normalizeTicker('fiat:MNT')).toBe('fiat:MNT');
    expect(isFiatTicker('fiat:mnt')).toBe(true);
  });

  it('treats a canonical purchase paid in NZD as a purchase, not a swap', () => {
    const csv = [
      'timestamp,type,sent_asset,sent_quantity,received_asset,received_quantity',
      '2025-03-01T00:00:00Z,trade,NZD,1000,BTC,0.01',
    ].join('\n');
    const r = importCsv(csv, { accountId: 'w' });
    expect(r.events).toEqual([
      expect.objectContaining({ kind: 'trade', sent: { asset: 'fiat:NZD', quantity: '1000' } }),
    ]);
  });
});
