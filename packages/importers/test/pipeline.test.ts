import type { LedgerEvent } from '@svdt/domain';
import { jp, us } from '@svdt/rule-packs';
import { calculate } from '@svdt/tax-engine';
import { describe, expect, it } from 'vitest';
import { importCsv, matchTransfers } from '../src';

const withdrawal = (
  id: string,
  account: string,
  ts: string,
  asset: string,
  q: string,
): LedgerEvent => ({
  kind: 'external_withdrawal',
  id,
  timestamp: ts,
  accountId: account,
  sent: { asset, quantity: q },
});
const deposit = (
  id: string,
  account: string,
  ts: string,
  asset: string,
  q: string,
): LedgerEvent => ({
  kind: 'external_deposit',
  id,
  timestamp: ts,
  accountId: account,
  received: { asset, quantity: q },
});

describe('matchTransfers', () => {
  it('pairs a withdrawal with the closest deposit and turns the shortfall into a fee', () => {
    const { events, matches } = matchTransfers([
      withdrawal('w1', 'coinbase', '2025-01-01T10:00:00Z', 'BTC', '1'),
      deposit('d-late', 'kraken', '2025-01-02T10:00:00Z', 'BTC', '0.9995'),
      deposit('d1', 'kraken', '2025-01-01T10:30:00Z', 'BTC', '0.9995'),
    ]);
    expect(matches).toEqual([
      { withdrawalId: 'w1', depositId: 'd1', transferId: 'transfer:w1>d1' },
    ]);
    expect(events.map((e) => e.id)).toEqual(['transfer:w1>d1', 'd-late']);
    expect(events[0]).toMatchObject({
      kind: 'transfer',
      fromAccountId: 'coinbase',
      toAccountId: 'kraken',
      quantity: '0.9995',
      fee: { asset: 'BTC', quantity: '0.0005' },
    });
  });

  it.each([
    ['deposit before withdrawal', deposit('d', 'k', '2025-01-01T09:00:00Z', 'BTC', '1')],
    ['outside the window', deposit('d', 'k', '2025-01-05T11:00:00Z', 'BTC', '1')],
    ['different asset', deposit('d', 'k', '2025-01-01T11:00:00Z', 'ETH', '1')],
    ['more than was sent', deposit('d', 'k', '2025-01-01T11:00:00Z', 'BTC', '1.1')],
    ['fee too large', deposit('d', 'k', '2025-01-01T11:00:00Z', 'BTC', '0.9')],
    ['same account', deposit('d', 'c', '2025-01-01T11:00:00Z', 'BTC', '1')],
  ])('does not match: %s', (_name, d) => {
    const { matches } = matchTransfers([
      withdrawal('w', 'c', '2025-01-01T10:00:00Z', 'BTC', '1'),
      d,
    ]);
    expect(matches).toEqual([]);
  });
});

describe('end to end: import → match → calculate', () => {
  it('US: basis and holding period follow coins from Coinbase to Kraken', () => {
    const coinbase = importCsv(
      [
        'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
        'c1,2024-01-15 17:00:00 UTC,Buy,BTC,1,USD,$40000,$40000,$40010,$10,',
        'c2,2024-06-01 17:00:00 UTC,Send,BTC,1,USD,$68000,$68000,$68000,$0,',
      ].join('\n'),
      { accountId: 'coinbase' },
    );
    const kraken = importCsv(
      [
        'txid,refid,time,type,subtype,aclass,asset,wallet,amount,fee,balance',
        'L1,D1,2024-06-01 17:40:00,deposit,,currency,XXBT,spot / main,0.9999,0,0.9999',
        'L2,T1,2025-03-01 12:00:00,trade,,currency,XXBT,spot / main,-0.9999,0,0',
        'L3,T1,2025-03-01 12:00:00,trade,,currency,ZUSD,spot / main,90000,90,89910',
      ].join('\n'),
      { accountId: 'kraken' },
    );
    const { events, matches } = matchTransfers([...coinbase.events, ...kraken.events]);
    expect(matches).toHaveLength(1);

    const r = calculate({
      rulePack: us,
      taxYear: 2025,
      events,
      prices: [
        {
          asset: 'BTC',
          currency: 'USD',
          timestamp: '2024-06-01T17:00:00Z',
          unitPrice: '68000',
          source: 'test',
        },
      ],
    });
    expect(r.disposals).toHaveLength(1);
    const sale = r.disposals[0]!;
    expect(sale.accountId).toBe('kraken');
    expect(sale.term).toBe('long');
    expect(sale.acquiredAt).toBe('2024-01-15T17:00:00Z');
    // Basis: $40,010 × 0.9999 (0.0001 BTC went to the network fee in 2024).
    expect(sale.costBasis.toFixed()).toBe('40005.999');
    expect(sale.gain.toFixed()).toBe('49904.001');
    expect(r.issues).toEqual([]);
  });

  it('JP: bitFlyer and Coincheck files pool into one total average', () => {
    const bitflyer = importCsv(
      [
        '取引日時,通貨,取引種別,取引価格,通貨1,通貨1数量,手数料,通貨1の対円レート,通貨2,通貨2数量,自己・媒介,注文 ID,備考',
        '2025/02/01 10:00:00,BTC/JPY,買い,10000000,BTC,0.1,0,10000000,JPY,-1000000,自己,A1,',
      ].join('\n'),
      { accountId: 'bitflyer' },
    );
    const coincheck = importCsv(
      [
        '取引日時,取引種別,取引形態,通貨ペア,増加通貨名,増加数量,減少通貨名,減少数量,約定代金,約定価格,手数料通貨,手数料数量,送付元アドレス,送付先アドレス,登録番号,社名,備考',
        '2025/05/01 10:00:00,売却,媒介,btc_jpy,JPY,800000,BTC,0.05,,,,,,,,,',
        '2025/09/01 10:00:00,購入,自己,btc_jpy,BTC,0.1,JPY,1500000,,,,,,,,,',
      ].join('\n'),
      { accountId: 'coincheck' },
    );
    const r = calculate({
      rulePack: jp,
      taxYear: 2025,
      events: [...bitflyer.events, ...coincheck.events],
    });
    // Total average: (1,000,000 + 1,500,000) / 0.2 = 12,500,000 per BTC → basis 625,000.
    expect(r.disposals.map((d) => [d.accountId, d.costBasis.toFixed(), d.gain.toFixed()])).toEqual([
      ['coincheck', '625000', '175000'],
    ]);
  });
});
