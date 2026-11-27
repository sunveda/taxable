import { describe, expect, it } from 'vitest';
import { importCsv } from '../src';

/** Regression tests for the code review of sunveda/taxable#1 (importer findings). */

describe('#3 bitFlyer: a crypto fee stays crypto', () => {
  it('deducts the BTC fee and uses 手数料(JPY) only as its value', () => {
    const csv = [
      '取引日時,通貨,取引種別,取引価格,通貨1,通貨1数量,手数料,通貨1の対円レート,通貨2,通貨2数量,手数料(JPY),課税区分,自己・媒介,注文 ID,備考',
      '2025/01/10 10:00:00,BTC/JPY,買い,15000000,BTC,0.01,0.00001,15000000,JPY,-150000,150,,媒介,JOR1,',
    ].join('\n');
    const r = importCsv(csv, { accountId: 'bitflyer' });
    expect(r.events[0]).toMatchObject({
      kind: 'trade',
      fee: { asset: 'BTC', quantity: '0.00001', value: { amount: '150', currency: 'JPY' } },
    });
    expect(r.warnings.map((w) => w.code)).toEqual(['assumption']);
  });
});

describe('#4 Coinbase: rows without an ID dedupe across exports', () => {
  const header =
    'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes';
  const row = ',2025-03-01 17:00:00 UTC,Buy,BTC,0.1,USD,$60000,$6000,$6010,$10,';
  const earlier = ',2025-02-01 17:00:00 UTC,Buy,ETH,1,USD,$3000,$3000,$3005,$5,';

  it('gives the same id whatever the row position', () => {
    const a = importCsv([header, row].join('\n'), { accountId: 'cb' }).events[0]!.id;
    const b = importCsv([header, earlier, row].join('\n'), { accountId: 'cb' }).events[1]!.id;
    expect(b).toBe(a);
    expect(a.startsWith('coinbase:cb:')).toBe(true);
  });
});

describe('#7 canonical CSV: unreadable optional columns are errors', () => {
  const header =
    'timestamp,type,received_asset,received_quantity,cost_basis,cost_basis_currency,acquired_at,value,value_currency';
  it.each([
    [
      'acquired_at',
      '2025-03-01T00:00:00Z,deposit,BTC,1,1000,USD,2020/13/01,,',
      'invalid_timestamp',
    ],
    ['cost_basis', '2025-03-01T00:00:00Z,deposit,BTC,1,lots,USD,,,', 'invalid_number'],
    [
      'cost_basis without currency',
      '2025-03-01T00:00:00Z,deposit,BTC,1,1000,,,,',
      'invalid_number',
    ],
    ['value without currency', '2025-03-01T00:00:00Z,deposit,BTC,1,,,,500,', 'invalid_number'],
  ])('rejects a bad %s with a warning instead of ignoring it', (_name, row, code) => {
    const r = importCsv([header, row].join('\n'), { accountId: 'w' });
    expect(r.events).toEqual([]);
    expect(r.warnings.map((w) => [w.line, w.code])).toEqual([[2, code]]);
  });
});

describe('#9 Kraken: KFEE rows in a trade count as skipped', () => {
  it('reports imported and skipped rows consistently', () => {
    const csv = [
      'txid,refid,time,type,subtype,aclass,asset,wallet,amount,fee,balance',
      'L1,T1,2025-01-15 17:00:00,trade,,currency,ZUSD,spot / main,-4200,0,5800',
      'L2,T1,2025-01-15 17:00:00,trade,,currency,XXBT,spot / main,0.1,0,0.1',
      'L3,T1,2025-01-15 17:00:00,trade,,currency,KFEE,spot / main,0,12,988',
    ].join('\n');
    const r = importCsv(csv, { accountId: 'kraken' });
    expect(r.events.map((e) => e.kind)).toEqual(['trade']);
    expect(r.stats).toEqual({ rows: 3, imported: 2, skipped: 1 });
  });
});
