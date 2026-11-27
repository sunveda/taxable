import { describe, expect, it } from 'vitest';
import { importCsv } from '../src';

/** Regression tests for the Codex review of sunveda/taxable#1 at c5c931a (importer findings). */
const canonical = (header: string, row: string): ReturnType<typeof importCsv> =>
  importCsv([header, row].join('\n'), { accountId: 'w' });

const TRADE =
  'timestamp,type,sent_asset,sent_quantity,received_asset,received_quantity,fee_asset,fee_quantity,value,value_currency';

describe('canonical quantities and values', () => {
  it('rejects a negative quantity instead of flipping its sign', () => {
    const r = canonical(
      'timestamp,type,received_asset,received_quantity',
      '2025-03-01T00:00:00Z,deposit,BTC,-1',
    );
    expect(r.events).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['invalid_number']);
  });

  it('rejects a zero trade leg', () => {
    const r = canonical(TRADE, '2025-03-01T00:00:00Z,trade,USD,0,BTC,1,,,,');
    expect(r.events).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['invalid_number']);
  });

  it('treats a zero fee as no fee', () => {
    const r = canonical(TRADE, '2025-03-01T00:00:00Z,trade,USD,100,BTC,0.001,USD,0,,');
    expect(r.warnings).toEqual([]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).not.toHaveProperty('fee');
  });

  it('rejects a negative market value', () => {
    const r = canonical(TRADE, '2025-03-01T00:00:00Z,trade,USD,100,BTC,0.001,,,-100,USD');
    expect(r.events).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual(['invalid_number']);
  });
});

describe('Kraken trades with a fee on both legs', () => {
  const csv = [
    '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"',
    '"L1","T1","2024-01-15 17:00:00","trade","","currency","ZUSD","spot / main",-4200.0000,10.0000,5790.0000',
    '"L2","T1","2024-01-15 17:00:00","trade","","currency","XXBT","spot / main",0.1000000000,0.0002000000,0.0998000000',
  ].join('\n');

  it('keeps both fees as costs of the trade, not as a standalone fee', () => {
    const r = importCsv(csv, { accountId: 'kraken' });
    expect(r.events.map((e) => e.kind)).toEqual(['trade']);
    expect(r.events[0]).toMatchObject({
      sent: { asset: 'fiat:USD', quantity: '4200' },
      // The BTC fee is netted into what was received.
      received: { asset: 'BTC', quantity: '0.0998' },
      fee: { asset: 'fiat:USD', quantity: '10' },
    });
  });
});
