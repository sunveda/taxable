import type { LedgerEvent } from '@svdt/domain';
import { jp } from '@svdt/rule-packs';
import { calculate } from '@svdt/tax-engine';
import { describe, expect, it } from 'vitest';
import { importCsv, matchTransfers } from '../src';
import { parseTimestamp } from '../src/values';

/** Regression tests for the second code review of sunveda/taxable#1 (importer findings). */
const KRAKEN = 'txid,refid,time,type,subtype,aclass,asset,wallet,amount,fee,balance';

describe('#2 Kraken pending + credited funding rows', () => {
  it('imports a deposit once when both rows are present', () => {
    const csv = [
      KRAKEN,
      ',D1,2025-01-10 10:00:00,deposit,,currency,XETH,spot / main,1.0,0,',
      'LCRED1,D1,2025-01-10 10:05:00,deposit,,currency,XETH,spot / main,1.0,0,1.0',
      ',W1,2025-02-10 10:00:00,withdrawal,,currency,XETH,spot / main,-0.5,0.001,',
      'LCRED2,W1,2025-02-10 10:05:00,withdrawal,,currency,XETH,spot / main,-0.5,0.001,0.499',
    ].join('\n');
    const r = importCsv(csv, { accountId: 'kraken' });
    expect(r.events.map((e) => [e.kind, e.id])).toEqual([
      ['external_deposit', 'kraken:kraken:LCRED1'],
      ['external_withdrawal', 'kraken:kraken:LCRED2'],
      ['fee', 'kraken:kraken:LCRED2:fee'],
    ]);
    expect(r.stats).toEqual({ rows: 4, imported: 2, skipped: 2 });
  });

  it('keeps a row without a credited twin, with a warning', () => {
    const csv = [KRAKEN, ',D2,2025-01-10 10:00:00,deposit,,currency,XETH,spot / main,1.0,0,'].join(
      '\n',
    );
    const r = importCsv(csv, { accountId: 'kraken' });
    expect(r.events.map((e) => e.kind)).toEqual(['external_deposit']);
    expect(r.warnings.map((w) => w.code)).toEqual(['assumption']);
  });
});

describe('#3 Kraken spot ↔ staking moves', () => {
  it('treats the paired withdrawal and staking deposit as internal', () => {
    const csv = [
      KRAKEN,
      'L1,B1,2025-01-01 10:00:00,trade,,currency,ZUSD,spot / main,-80,0,0',
      'L2,B1,2025-01-01 10:00:00,trade,,currency,DOT,spot / main,10,0,10',
      'L3,S1,2025-02-01 10:00:00,withdrawal,,currency,DOT,spot / main,-10,0,0',
      'L4,S2,2025-02-01 10:00:30,deposit,,currency,DOT.S,spot / main,10,0,10',
      'L5,S3,2025-02-01 10:00:30,transfer,spottostaking,currency,DOT,spot / main,-10,0,0',
      'L6,S4,2025-02-01 10:00:30,transfer,stakingfromspot,currency,DOT.S,spot / main,10,0,10',
      'L7,R1,2025-03-01 00:00:00,staking,,currency,DOT.S,spot / main,0.1,0,10.1',
    ].join('\n');
    const r = importCsv(csv, { accountId: 'kraken' });
    expect(r.events.map((e) => e.kind)).toEqual(['trade', 'income']);
    expect(r.warnings).toEqual([]);
  });

  it('leaves an unrelated withdrawal external', () => {
    const csv = [
      KRAKEN,
      'L3,S1,2025-02-01 10:00:00,withdrawal,,currency,DOT,spot / main,-4,0,0',
      'L4,S2,2025-02-01 10:00:30,deposit,,currency,DOT.S,spot / main,10,0,10',
    ].join('\n');
    expect(importCsv(csv, { accountId: 'kraken' }).events.map((e) => e.kind)).toEqual([
      'external_withdrawal',
    ]);
  });
});

describe('#5 transfer matching tolerates clock skew', () => {
  const w: LedgerEvent = {
    kind: 'external_withdrawal',
    id: 'w',
    timestamp: '2025-01-01T12:00:30Z',
    accountId: 'coinbase',
    sent: { asset: 'BTC', quantity: '1' },
  };
  const d = (ts: string): LedgerEvent => ({
    kind: 'external_deposit',
    id: `d-${ts}`,
    timestamp: ts,
    accountId: 'kraken',
    received: { asset: 'BTC', quantity: '0.9999' },
  });

  it('matches a deposit stamped seconds before the withdrawal', () => {
    expect(matchTransfers([w, d('2025-01-01T12:00:05Z')]).matches).toHaveLength(1);
  });

  it('still rejects one stamped hours before', () => {
    expect(matchTransfers([w, d('2025-01-01T10:00:00Z')]).matches).toEqual([]);
  });
});

describe('#7 bitFlyer: the JPY rate values crypto-for-crypto trades', () => {
  it('values the 通貨1 leg so the swap has proceeds without external prices', () => {
    const csv = [
      '取引日時,通貨,取引種別,取引価格,通貨1,通貨1数量,手数料,通貨1の対円レート,通貨2,通貨2数量,自己・媒介,注文 ID,備考',
      '2025/01/10 10:00:00,ETH/JPY,買い,400000,ETH,1,0,400000,JPY,-400000,自己,A1,',
      '2025/03/10 10:00:00,ETH/BTC,売り,0.03,ETH,-1,0,500000,BTC,0.03,媒介,A2,',
    ].join('\n');
    const imported = importCsv(csv, { accountId: 'bitflyer' });
    expect(imported.events[1]).toMatchObject({
      sent: { asset: 'ETH', value: { amount: '500000', currency: 'JPY' } },
    });
    const r = calculate({ rulePack: jp, taxYear: 2025, events: imported.events });
    expect(r.issues).toEqual([]);
    expect(r.disposals.map((x) => [x.kind, x.proceeds.toFixed(), x.gain.toFixed()])).toEqual([
      ['swap', '500000', '100000'],
    ]);
  });
});

describe('#9 transfer matching at volume', () => {
  it('matches thousands of pairs correctly', () => {
    const events: LedgerEvent[] = [];
    for (let i = 0; i < 3000; i++) {
      const t = Date.UTC(2025, 0, 1) + i * 3_600_000;
      events.push({
        kind: 'external_withdrawal',
        id: `w${i}`,
        timestamp: new Date(t).toISOString(),
        accountId: 'a',
        sent: { asset: 'BTC', quantity: '1' },
      });
      events.push({
        kind: 'external_deposit',
        id: `d${i}`,
        timestamp: new Date(t + 600_000).toISOString(),
        accountId: 'b',
        received: { asset: 'BTC', quantity: '0.999' },
      });
    }
    const { matches } = matchTransfers(events);
    expect(matches).toHaveLength(3000);
    expect(matches.every((m) => m.withdrawalId.slice(1) === m.depositId.slice(1))).toBe(true);
  });
});

describe('#10 impossible dates', () => {
  it.each([
    '2025-02-30 10:00:00',
    '2025-04-31 10:00:00',
    '2025-01-01 24:00:00',
    '2025-01-01 10:60:00',
    '2025-02-29 10:00:00',
  ])('rejects %s', (raw) => expect(parseTimestamp(raw, 'Z')).toBeNull());
  it('accepts 29 February in a leap year', () => {
    expect(parseTimestamp('2024-02-29 10:00:00', 'Z')).toBe('2024-02-29T10:00:00Z');
  });
});
