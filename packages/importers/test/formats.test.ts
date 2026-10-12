import { describe, expect, it } from 'vitest';
import { importCsv } from '../src';

/**
 * SYNTHETIC fixtures: hand-written from the documented headers (see each importer's
 * `format.sources`), not real exports. Replace/extend with anonymized real exports before
 * marking an importer `verified`.
 */
const kinds = (r: ReturnType<typeof importCsv>) => r.events.map((e) => e.kind);

describe('canonical CSV', () => {
  const csv = [
    'timestamp,type,account,sent_asset,sent_quantity,received_asset,received_quantity,fee_asset,fee_quantity,value,value_currency,to_account,income_type,cost_basis,cost_basis_currency,acquired_at,id',
    '2025-01-02T10:00:00Z,trade,,USD,1000,BTC,0.01,USD,5,,,,,,,,t1',
    '2025-01-03T10:00:00Z,transfer,,BTC,0.005,,,BTC,0.0001,,,ledger,,,,,t2',
    '2025-01-04T10:00:00Z,income,,,,ETH,0.1,,,300,USD,,staking,,,,t3',
    '2025-01-05T10:00:00Z,deposit,,,,SOL,10,,,,,,,1200,USD,2023-05-01T00:00:00Z,t4',
    '2025-01-06T10:00:00Z,withdrawal,,SOL,2,,,SOL,0.001,,,,,,,,t5',
    '2025-01-07T10:00:00Z,ignore,,,,,,,,,,,,,,,t6',
    '2025-01-08T10:00:00Z,teleport,,,,,,,,,,,,,,,t7',
  ].join('\n');

  it('imports every event type and reports unknown rows', () => {
    const r = importCsv(csv, { accountId: 'wallet' });
    expect(r.importer.id).toBe('svdt.canonical.v1');
    expect(kinds(r)).toEqual([
      'trade',
      'transfer',
      'income',
      'external_deposit',
      'external_withdrawal',
      'fee',
    ]);
    expect(r.events[0]).toMatchObject({
      id: 'canonical:wallet:t1',
      sent: { asset: 'fiat:USD', quantity: '1000' },
      fee: { asset: 'fiat:USD', quantity: '5' },
    });
    expect(r.events[1]).toMatchObject({
      fromAccountId: 'wallet',
      toAccountId: 'ledger',
      quantity: '0.005',
    });
    expect(r.events[2]).toMatchObject({
      incomeType: 'staking',
      received: { value: { amount: '300', currency: 'USD' } },
    });
    expect(r.events[3]).toMatchObject({
      costBasis: { amount: '1200', currency: 'USD' },
      acquiredAt: '2023-05-01T00:00:00Z',
    });
    expect(r.warnings).toEqual([
      { line: 8, code: 'unknown_type', message: 'Unknown type "teleport".' },
    ]);
    expect(r.stats).toEqual({ rows: 7, imported: 5, skipped: 1 });
  });
});

describe('Coinbase', () => {
  const csv = [
    'Transactions',
    'User,Jane Doe,00000000-0000-0000-0000-000000000000',
    'ID,Timestamp,Transaction Type,Asset,Quantity Transacted,Price Currency,Price at Transaction,Subtotal,Total (inclusive of fees and/or spread),Fees and/or Spread,Notes',
    'a1,2024-01-15 17:00:00 UTC,Buy,BTC,0.1,USD,$42000.00,$4200.00,$4224.99,$24.99,Bought 0.1 BTC for $4224.99 USD',
    'a2,2024-02-01 17:00:00 UTC,Advanced Trade Sell,BTC,0.02,USD,$43000.00,$860.00,$855.70,$4.30,',
    'a3,2024-03-01 17:00:00 UTC,Convert,ETH,0.5,USD,$3000.00,$1500.00,$1500.00,$0.00,Converted 0.5 ETH to 1495.5 USDC',
    'a4,2024-04-01 17:00:00 UTC,Send,BTC,-0.05,USD,$65000.00,-$3250.00,-$3250.00,$0.00,To 0xabc',
    'a5,2024-04-02 17:00:00 UTC,Receive,SOL,10,USD,$180.00,$1800.00,$1800.00,$0.00,From external',
    'a6,2024-05-01 17:00:00 UTC,Staking Income,ETH,0.001,USD,$3100.00,$3.10,$3.10,$0.00,',
    'a7,2024-05-02 17:00:00 UTC,Learning Reward,XLM,20,USD,$0.10,$2.00,$2.00,$0.00,',
    'a8,2024-05-03 17:00:00 UTC,Deposit,USD,1000,USD,$1.00,$1000.00,$1000.00,$0.00,',
    'a9,2024-05-04 17:00:00 UTC,Pro Withdrawal,BTC,0.01,USD,$60000,$600,$600,$0.00,',
    'a10,2024-05-05 17:00:00 UTC,Mystery Bonus,BTC,0.01,USD,$60000,$600,$600,$0.00,',
  ].join('\n');

  it('skips the preamble and maps each transaction type', () => {
    const r = importCsv(csv, { accountId: 'coinbase' });
    expect(r.importer.id).toBe('coinbase.transactions.csv.v2');
    expect(r.importer.format.status).toBe('unverified');
    expect(kinds(r)).toEqual([
      'trade',
      'trade',
      'trade',
      'external_withdrawal',
      'external_deposit',
      'income',
      'income',
    ]);
    expect(r.events[0]).toMatchObject({
      id: 'coinbase:coinbase:a1',
      timestamp: '2024-01-15T17:00:00Z',
      sent: { asset: 'fiat:USD', quantity: '4200' },
      received: { asset: 'BTC', quantity: '0.1' },
      fee: { asset: 'fiat:USD', quantity: '24.99' },
    });
    expect(r.events[1]).toMatchObject({
      sent: { asset: 'BTC', quantity: '0.02' },
      received: { asset: 'fiat:USD', quantity: '860' },
    });
    expect(r.events[2]).toMatchObject({
      sent: { asset: 'ETH', quantity: '0.5' },
      received: { asset: 'USDC', quantity: '1495.5', value: { amount: '1500', currency: 'USD' } },
    });
    expect(r.events[3]).toMatchObject({
      sent: { asset: 'BTC', quantity: '0.05', value: { amount: '3250', currency: 'USD' } },
    });
    expect(r.events[5]).toMatchObject({
      incomeType: 'staking',
      received: { asset: 'ETH', value: { amount: '3.1' } },
    });
    expect(r.events[6]).toMatchObject({ incomeType: 'airdrop' });
    expect(r.warnings.map((w) => [w.line, w.code])).toEqual([[13, 'unknown_type']]);
    expect(r.stats).toEqual({ rows: 10, imported: 7, skipped: 2 });
  });
});

describe('Kraken ledgers', () => {
  const csv = [
    '"txid","refid","time","type","subtype","aclass","asset","wallet","amount","fee","balance"',
    '"L1","T1","2024-01-15 17:00:00","trade","","currency","ZUSD","spot / main",-4200.0000,10.0000,5790.0000',
    '"L2","T1","2024-01-15 17:00:00","trade","","currency","XXBT","spot / main",0.1000000000,0.0000000000,0.1000000000',
    '"L3","D1","2024-01-10 12:00:00","deposit","","currency","ZUSD","spot / main",10000.0000,0.0000,10000.0000',
    '"L4","D2","2024-02-01 12:00:00","deposit","","currency","XETH","spot / main",1.0000000000,0.0000000000,1.0000000000',
    '"L5","W1","2024-03-01 12:00:00","withdrawal","","currency","XXBT","spot / main",-0.0500000000,0.0002000000,0.0498000000',
    '"L6","S1","2024-03-05 00:00:00","earn","allocation","currency","ETH","earn / bonded",-0.5,0,0.5',
    '"L7","S2","2024-04-01 00:00:00","staking","","currency","ETH2.S","spot / main",0.0010000000,0.0000000000,0.5010000000',
    '"L8","K1","2024-04-02 00:00:00","trade","","currency","KFEE","spot / main",0.00,12.00,988.00',
    '"L9","M1","2024-04-03 00:00:00","margin","","currency","ZUSD","spot / main",-5.0000,0.0000,5785.0000',
  ].join('\n');

  it('groups trade rows by refid and maps ledger types', () => {
    const r = importCsv(csv, { accountId: 'kraken' });
    expect(r.importer.id).toBe('kraken.ledgers.csv.v1');
    expect(kinds(r)).toEqual(['trade', 'external_deposit', 'external_withdrawal', 'fee', 'income']);
    expect(r.events[0]).toMatchObject({
      id: 'kraken:kraken:T1',
      timestamp: '2024-01-15T17:00:00Z',
      sent: { asset: 'fiat:USD', quantity: '4200' },
      received: { asset: 'BTC', quantity: '0.1' },
      fee: { asset: 'fiat:USD', quantity: '10' },
    });
    expect(r.events[1]).toMatchObject({ received: { asset: 'ETH', quantity: '1' } });
    expect(r.events[2]).toMatchObject({ sent: { asset: 'BTC', quantity: '0.05' } });
    expect(r.events[3]).toMatchObject({ kind: 'fee', fee: { asset: 'BTC', quantity: '0.0002' } });
    expect(r.events[4]).toMatchObject({
      incomeType: 'staking',
      received: { asset: 'ETH', quantity: '0.001' },
    });
    // KFEE-only groups (fee credits) are skipped, not reported.
    expect(r.warnings.map((w) => [w.line, w.code])).toEqual([[10, 'unsupported_type']]);
    expect(r.stats).toEqual({ rows: 9, imported: 5, skipped: 3 });
  });
});

describe('Japan: 業界標準フォーマット', () => {
  const csv = [
    '取引日時,取引種別,取引形態,通貨ペア,増加通貨名,増加数量,減少通貨名,減少数量,約定代金,約定価格,手数料通貨,手数料数量,送付元アドレス,送付先アドレス,登録番号,社名,備考',
    '2025/01/05 10:00:00,購入,自己,btc_jpy,BTC,0.01,JPY,150000,150000,15000000,,,,,,,',
    '2025/01/04 09:00:00,入金,,,JPY,200000,,,,,,,,,,,',
    '2025/02/01 12:00:00,売却,媒介,btc_jpy,JPY,80000,BTC,0.005,80000,16000000,JPY,120,,,,,',
    '2025/03/01 12:00:00,送金,,,,,BTC,0.002,,,BTC,0.0005,,bc1qxyz,,,',
    '2025/03/10 12:00:00,ステーキング報酬,,,ETH,0.01,,,,,,,,,,,',
    '2025/03/11 12:00:00,受取,,,XRP,100,,,,,,,rXYZ,,,,',
    '2025/03/12 12:00:00,購入,自己,btc_jpy,BTC,abc,JPY,1,,,,,,,,,',
  ].join('\n');

  it('derives events from increase/decrease columns, in JST', () => {
    const r = importCsv(csv, { accountId: 'coincheck' });
    expect(r.importer.id).toBe('jp.industry-standard.csv.v1');
    expect(kinds(r)).toEqual([
      'trade',
      'trade',
      'external_withdrawal',
      'fee',
      'income',
      'external_deposit',
    ]);
    expect(r.events[0]).toMatchObject({
      timestamp: '2025-01-05T10:00:00+09:00',
      sent: { asset: 'fiat:JPY', quantity: '150000' },
      received: { asset: 'BTC', quantity: '0.01' },
    });
    expect(r.events[1]).toMatchObject({
      sent: { asset: 'BTC', quantity: '0.005' },
      fee: { asset: 'fiat:JPY', quantity: '120' },
    });
    expect(r.events[3]).toMatchObject({ fee: { asset: 'BTC', quantity: '0.0005' } });
    expect(r.events[4]).toMatchObject({ incomeType: 'staking', received: { asset: 'ETH' } });
    expect(r.warnings.map((w) => [w.line, w.code])).toEqual([[8, 'invalid_number']]);
    expect(r.stats.skipped).toBe(1);
  });

  it('gives the same ids on re-import, so duplicates collapse', () => {
    const a = importCsv(csv, { accountId: 'coincheck' }).events.map((e) => e.id);
    const b = importCsv(csv, { accountId: 'coincheck' }).events.map((e) => e.id);
    expect(b).toEqual(a);
    expect(new Set(a).size).toBe(a.length);
  });
});

describe('Japan: bitFlyer', () => {
  const header15 =
    '取引日時,通貨,取引種別,取引価格,通貨1,通貨1数量,手数料,通貨1の対円レート,通貨2,通貨2数量,手数料(JPY),課税区分,自己・媒介,注文 ID,備考';
  const csv = [
    header15,
    '2025/01/10 10:00:00,BTC/JPY,買い,15000000,BTC,0.01,0,15000000,JPY,-150000,15,,自己,JOR1,',
    '2025/02/10 10:00:00,BTC/JPY,売り,16000000,BTC,-0.004,0,16000000,JPY,64000,0,,媒介,JOR2,',
    '2025/03/10 10:00:00,BTC,外部送付,,BTC,-0.003,0,17000000,,,,,,,',
    '2025/03/11 10:00:00,ETH,受取,,ETH,0.2,0,500000,,,,,,,',
    '2025/03/12 10:00:00,BTC/JPY,買い,15000000,BTC,0.01,0,15000000,JPY,150000,0,,自己,JOR3,',
  ].join('\n');

  it('uses signed quantities and reports rows whose signs do not oppose', () => {
    const r = importCsv(csv, { accountId: 'bitflyer' });
    expect(r.importer.id).toBe('bitflyer.trade-history.csv.v1');
    expect(kinds(r)).toEqual(['trade', 'trade', 'external_withdrawal', 'external_deposit']);
    expect(r.events[0]).toMatchObject({
      timestamp: '2025-01-10T10:00:00+09:00',
      sent: { asset: 'fiat:JPY', quantity: '150000' },
      received: { asset: 'BTC', quantity: '0.01' },
      fee: { asset: 'fiat:JPY', quantity: '15' },
    });
    expect(r.events[3]).toMatchObject({
      received: { asset: 'ETH', quantity: '0.2', value: { amount: '100000', currency: 'JPY' } },
    });
    expect(r.warnings.map((w) => [w.line, w.code])).toEqual([[6, 'unrecognized_row']]);
  });

  it('also reads the 13-column version', () => {
    const csv13 = [
      '取引日時,通貨,取引種別,取引価格,通貨1,通貨1数量,手数料,通貨1の対円レート,通貨2,通貨2数量,自己・媒介,注文 ID,備考',
      '2025/01/10 10:00:00,BTC/JPY,買い,15000000,BTC,0.01,0.00001,15000000,JPY,-150000,自己,JOR1,',
    ].join('\n');
    const r = importCsv(csv13, { accountId: 'bitflyer' });
    expect(r.events[0]).toMatchObject({ fee: { asset: 'BTC', quantity: '0.00001' } });
    expect(r.warnings.map((w) => w.code)).toEqual(['assumption']);
  });
});
