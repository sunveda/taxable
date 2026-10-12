import type { AssetAmount, Decimal, IncomeType, LedgerEvent } from '@svdt/domain';
import { isFiatTicker, normalizeTicker } from '../assets';
import type { CsvTable } from '../csv';
import type { CsvImporter, ImportContext, ImportResult, ImportWarning } from '../types';
import { parseAmountOrZero, parseTimestamp, RowIds } from '../values';
import { countLines } from './canonical';

/** Japanese exchanges export local time without an offset; Japan has no DST. */
const JST = '+09:00';

/**
 * Income keywords in 取引種別. Applied only to rows where the user received crypto and gave
 * nothing up; anything else that matches none of them becomes a deposit with unknown basis.
 */
function incomeTypeFromLabel(label: string): IncomeType | null {
  if (/ステーキング|staking/i.test(label)) return 'staking';
  if (/貸暗号資産|貸仮想通貨|貸コイン|レンディング|利息|lending|interest/i.test(label))
    return 'interest';
  if (/エアドロップ|配布|airdrop/i.test(label)) return 'airdrop';
  if (/ハードフォーク|分岐|fork/i.test(label)) return 'hard_fork';
  if (/報酬|キャンペーン|プレゼント|紹介|reward|bonus/i.test(label)) return 'other';
  return null;
}

interface Side {
  asset: string;
  quantity: Decimal;
  /** JPY value of this amount, when the file states it. */
  valueJpy?: Decimal;
}

/**
 * Turns one row's increase/decrease/fee into events. Shared by both Japanese formats:
 * the structure, not the type label, decides what happened.
 */
function rowToEvents(args: {
  id: string;
  timestamp: string;
  accountId: string;
  label: string;
  increase: Side | null;
  decrease: Side | null;
  fee: Side | null;
  /** JPY value of the increase, if the file states it. */
  increaseValueJpy: Decimal | null;
  sourceRef: string;
}): { events: LedgerEvent[]; skipped: boolean; assumption?: string } {
  const { id, timestamp, accountId, label, increase, decrease, fee, increaseValueJpy, sourceRef } =
    args;
  const amt = (s: Side): AssetAmount => ({
    asset: normalizeTicker(s.asset),
    quantity: s.quantity.abs().toFixed(),
  });
  const feeAmt =
    fee && !fee.quantity.isZero()
      ? fee.valueJpy && !isFiatTicker(fee.asset)
        ? { ...amt(fee), value: { amount: fee.valueJpy.toFixed(), currency: 'JPY' } }
        : amt(fee)
      : undefined;
  const valued = (a: AssetAmount): AssetAmount =>
    increaseValueJpy ? { ...a, value: { amount: increaseValueJpy.toFixed(), currency: 'JPY' } } : a;

  if (increase && decrease) {
    return {
      events: [
        {
          kind: 'trade',
          id,
          timestamp,
          accountId,
          sent: amt(decrease),
          received: amt(increase),
          ...(feeAmt ? { fee: feeAmt } : {}),
          sourceRef,
        },
      ],
      skipped: false,
    };
  }
  const events: LedgerEvent[] = [];
  if (increase) {
    if (isFiatTicker(increase.asset)) return { events: feeEvents(), skipped: true };
    const incomeType = incomeTypeFromLabel(label);
    if (incomeType) {
      events.push({
        kind: 'income',
        id,
        timestamp,
        accountId,
        incomeType,
        received: valued(amt(increase)),
        sourceRef,
      });
    } else {
      events.push({
        kind: 'external_deposit',
        id,
        timestamp,
        accountId,
        received: valued(amt(increase)),
        sourceRef,
      });
    }
    return { events: [...events, ...feeEvents()], skipped: false };
  }
  if (decrease) {
    if (isFiatTicker(decrease.asset)) return { events: feeEvents(), skipped: true };
    events.push({
      kind: 'external_withdrawal',
      id,
      timestamp,
      accountId,
      sent: amt(decrease),
      sourceRef,
    });
    return { events: [...events, ...feeEvents()], skipped: false };
  }
  if (feeAmt) return { events: feeEvents(), skipped: false };
  return { events: [], skipped: true };

  function feeEvents(): LedgerEvent[] {
    return feeAmt
      ? [{ kind: 'fee', id: `${id}:fee`, timestamp, accountId, fee: feeAmt, sourceRef }]
      : [];
  }
}

/**
 * 業界標準フォーマット: the industry-standard trade history CSV offered by Coincheck,
 * based on the JCBA reference format. Columns describe each row as an increase, a
 * decrease and a fee, so the importer needs no knowledge of the type labels.
 */
export const jpIndustryStandardCsv: CsvImporter = {
  id: 'jp.industry-standard.csv.v1',
  name: '業界標準フォーマット (Coincheck and others)',
  markets: ['jp'],
  format: {
    status: 'unverified',
    sources: [
      'Coincheck FAQ: 業界標準フォーマットでの取引履歴（CSV）の仕様 (JST timestamps, confirmed trades only)',
      'Column list per third-party guides (e.g. Cryptact, CryptoLinC), 2025–2026',
      'JCBA 暗号資産取引履歴の参考フォーマット (2021-11-12), not yet reviewed directly',
    ],
    notes: 'Coincheck staking rewards are in a separate 暗号資産報酬履歴 file, not this one.',
  },
  requiredColumns: ['取引日時', '取引種別', '増加通貨名', '増加数量', '減少通貨名', '減少数量'],
  parse(table: CsvTable, ctx: ImportContext): ImportResult {
    const events: LedgerEvent[] = [];
    const warnings: ImportWarning[] = [];
    const ids = new RowIds(`jpstd:${ctx.accountId}`);
    let skipped = 0;

    for (const { line, cells } of table.rows) {
      const timestamp = parseTimestamp(cells['取引日時'], JST);
      if (!timestamp) {
        warnings.push({
          line,
          code: 'invalid_timestamp',
          message: `取引日時を読み取れません: "${cells['取引日時'] ?? ''}"`,
        });
        continue;
      }
      const side = (assetCol: string, qtyCol: string): Side | null | 'invalid' => {
        const asset = (cells[assetCol] ?? '').trim();
        const q = parseAmountOrZero(cells[qtyCol]);
        if (q === null) return 'invalid';
        if (!asset || q.isZero()) return null;
        return { asset, quantity: q };
      };
      const increase = side('増加通貨名', '増加数量');
      const decrease = side('減少通貨名', '減少数量');
      const fee = side('手数料通貨', '手数料数量');
      if (increase === 'invalid' || decrease === 'invalid' || fee === 'invalid') {
        warnings.push({
          line,
          code: 'invalid_number',
          message: '数量が数値ではありません (quantity is not a number).',
        });
        continue;
      }
      const r = rowToEvents({
        id: ids.next(cells),
        timestamp,
        accountId: ctx.accountId,
        label: cells['取引種別'] ?? '',
        increase,
        decrease,
        fee,
        increaseValueJpy: null,
        sourceRef: `line ${line}`,
      });
      events.push(...r.events);
      if (r.skipped && r.events.length === 0) skipped++;
    }
    return {
      events,
      warnings,
      stats: {
        rows: table.rows.length,
        imported: table.rows.length - skipped - countLines(warnings),
        skipped,
      },
    };
  },
};

/**
 * bitFlyer 取引履歴 (TradeHistory_*.csv). 13-column version, or 15 columns with
 * 手数料(JPY) and 課税区分:
 *   取引日時, 通貨, 取引種別, 取引価格, 通貨1, 通貨1数量, 手数料, 通貨1の対円レート,
 *   通貨2, 通貨2数量, [手数料(JPY), 課税区分,] 自己・媒介, 注文 ID, 備考
 *
 * Quantities are read as signed (+ received, − given up). A two-sided row whose signs
 * don't oppose is reported, not guessed.
 */
export const bitflyerCsv: CsvImporter = {
  id: 'bitflyer.trade-history.csv.v1',
  name: 'bitFlyer 取引履歴 (CSV)',
  markets: ['jp'],
  format: {
    status: 'unverified',
    sources: [
      'Column lists per CryptoLinC and Cryptact bitFlyer guides (13- and 15-column versions)',
    ],
    notes:
      'Sign convention of 通貨1数量/通貨2数量 and the currency of 手数料 are unconfirmed; needs real exports.',
  },
  requiredColumns: ['取引日時', '取引種別', '通貨1', '通貨1数量', '通貨2', '通貨2数量'],
  parse(table: CsvTable, ctx: ImportContext): ImportResult {
    const events: LedgerEvent[] = [];
    const warnings: ImportWarning[] = [];
    let skipped = 0;
    const ids = new RowIds(`bitflyer:${ctx.accountId}`);

    for (const { line, cells } of table.rows) {
      const timestamp = parseTimestamp(cells['取引日時'], JST);
      if (!timestamp) {
        warnings.push({
          line,
          code: 'invalid_timestamp',
          message: `取引日時を読み取れません: "${cells['取引日時'] ?? ''}"`,
        });
        continue;
      }
      const q1 = parseAmountOrZero(cells['通貨1数量']);
      const q2 = parseAmountOrZero(cells['通貨2数量']);
      const feeQty = parseAmountOrZero(cells['手数料']);
      const feeJpy = parseAmountOrZero(cells['手数料(JPY)']);
      const rate = parseAmountOrZero(cells['通貨1の対円レート']);
      if (!q1 || !q2 || !feeQty || !feeJpy || !rate) {
        warnings.push({
          line,
          code: 'invalid_number',
          message: '数量が数値ではありません (quantity is not a number).',
        });
        continue;
      }
      const c1 = (cells['通貨1'] ?? '').trim();
      const c2 = (cells['通貨2'] ?? '').trim();
      const legs: Side[] = [];
      if (c1 && !q1.isZero()) legs.push({ asset: c1, quantity: q1 });
      if (c2 && !q2.isZero()) legs.push({ asset: c2, quantity: q2 });
      const increase = legs.filter((l) => l.quantity.isPositive());
      const decrease = legs.filter((l) => l.quantity.isNegative());
      if (legs.length === 2 && (increase.length !== 1 || decrease.length !== 1)) {
        warnings.push({
          line,
          code: 'unrecognized_row',
          message:
            '通貨1数量と通貨2数量の符号が対になっていません (both sides have the same sign).',
        });
        continue;
      }

      // Fee: 手数料 is the fee as charged (assumed to be in 通貨1); 手数料(JPY), when present,
      // is its yen value. A crypto fee must stay crypto so the units are deducted. Only when
      // 手数料 is empty is the fee taken as yen.
      let fee: Side | null = null;
      if (!feeQty.isZero() && c1) {
        fee = isFiatTicker(c1)
          ? { asset: c1, quantity: feeQty }
          : { asset: c1, quantity: feeQty, ...(feeJpy.isZero() ? {} : { valueJpy: feeJpy }) };
        warnings.push({ line, code: 'assumption', message: '手数料 assumed to be in 通貨1.' });
      } else if (!feeJpy.isZero()) {
        fee = { asset: 'JPY', quantity: feeJpy };
      }

      const inc = increase[0] ?? null;
      const valueJpy =
        inc && inc.asset === c1 && !rate.isZero() ? inc.quantity.abs().times(rate) : null;
      const r = rowToEvents({
        id: ids.next(cells),
        timestamp,
        accountId: ctx.accountId,
        label: cells['取引種別'] ?? '',
        increase: inc,
        decrease: decrease[0] ?? null,
        fee,
        increaseValueJpy: valueJpy,
        sourceRef: `line ${line}`,
      });
      events.push(...r.events);
      if (r.skipped && r.events.length === 0) skipped++;
    }
    return {
      events,
      warnings,
      stats: {
        rows: table.rows.length,
        imported: table.rows.length - skipped - countLines(warnings),
        skipped,
      },
    };
  },
};
