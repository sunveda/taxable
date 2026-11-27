import {
  isFiat,
  type AssetAmount,
  type Decimal,
  type LedgerEvent,
  type Timestamp,
} from '@svdt/domain';
import { normalizeTicker } from '../assets';
import type { CsvTable } from '../csv';
import type { CsvImporter, ImportContext, ImportResult, ImportWarning } from '../types';
import { parseAmount, parseAmountOrZero, parseTimestamp } from '../values';

/**
 * Kraken "Ledgers" export (ledgers.csv).
 *
 * Fields: txid, refid, time (UTC), type, subtype, aclass, asset, wallet, amount, fee, balance.
 * One row per balance change; rows of the same trade share a `refid`. `amount` is gross and
 * `fee` is charged in the row's own asset.
 */
const KRAKEN_ASSETS: Record<string, string> = {
  XXBT: 'BTC',
  XBT: 'BTC',
  XETH: 'ETH',
  XXDG: 'DOGE',
  XDG: 'DOGE',
  XLTC: 'LTC',
  XXRP: 'XRP',
  XXLM: 'XLM',
  XETC: 'ETC',
  XZEC: 'ZEC',
  XXMR: 'XMR',
  XREP: 'REP',
  XMLN: 'MLN',
  ZUSD: 'USD',
  ZEUR: 'EUR',
  ZJPY: 'JPY',
  ZGBP: 'GBP',
  ZCAD: 'CAD',
  ZAUD: 'AUD',
  ZCHF: 'CHF',
};

/** Strips staking/earn suffixes (ETH.S, DOT.M, ETH2.S, USD.HOLD, …) and legacy X/Z prefixes. */
export function normalizeKrakenAsset(raw: string): string {
  const base = raw.trim().toUpperCase().split('.')[0] ?? '';
  return normalizeTicker(KRAKEN_ASSETS[base] ?? base);
}

/** Moves between Kraken's own sub-wallets (spot ↔ staking/earn/futures). */
const INTERNAL_SUBTYPES = new Set([
  'spottostaking',
  'stakingfromspot',
  'stakingtospot',
  'spotfromstaking',
  'spottofutures',
  'spotfromfutures',
  'allocation',
  'deallocation',
  'migration',
  'autoallocation',
]);

const UNSUPPORTED_TYPES = new Set(['margin', 'rollover', 'settled', 'adjustment']);

interface Row {
  line: number;
  txid: string;
  /** Asset carried a staking/earn suffix (DOT.S, ETH2.S, USD.HOLD …). */
  staked: boolean;
  refid: string;
  time: Timestamp;
  type: string;
  subtype: string;
  asset: string;
  amount: Decimal;
  fee: Decimal;
}

export const krakenLedgersCsv: CsvImporter = {
  id: 'kraken.ledgers.csv.v1',
  name: 'Kraken ledgers (CSV)',
  markets: ['us'],
  format: {
    status: 'unverified',
    sources: [
      'Kraken API: Request Export Report, ledgers fields (https://docs.kraken.com/api-reference/account-data/request-export-report)',
      'Kraken API: Get Ledgers Info, type values (https://docs.kraken.com/api-reference/account-data/get-ledgers-info)',
      'Kraken support: How to interpret Ledger history fields (360001169383)',
    ],
    notes:
      'Margin, rollover and futures settlement are not supported yet. Needs anonymized real exports before enabling.',
  },
  requiredColumns: ['refid', 'time', 'type', 'asset', 'amount', 'fee'],
  parse(table: CsvTable, ctx: ImportContext): ImportResult {
    const events: LedgerEvent[] = [];
    const warnings: ImportWarning[] = [];
    const accountId = ctx.accountId;
    let skipped = 0;
    let imported = 0;

    // 1. Read rows.
    const rows: Row[] = [];
    for (const { line, cells } of table.rows) {
      const time = parseTimestamp(cells['time'], 'Z');
      const amount = parseAmount(cells['amount']);
      const fee = parseAmountOrZero(cells['fee']);
      if (!time) {
        warnings.push({
          line,
          code: 'invalid_timestamp',
          message: `Unreadable time "${cells['time'] ?? ''}".`,
        });
        continue;
      }
      if (!amount || !fee) {
        warnings.push({ line, code: 'invalid_number', message: 'amount/fee is not a number.' });
        continue;
      }
      rows.push({
        line,
        txid: cells['txid'] ?? '',
        staked: (cells['asset'] ?? '').includes('.'),
        refid: cells['refid'] || cells['txid'] || `line${line}`,
        time,
        type: (cells['type'] ?? '').toLowerCase(),
        subtype: (cells['subtype'] ?? '').toLowerCase(),
        asset: normalizeKrakenAsset(cells['asset'] ?? ''),
        amount,
        fee,
      });
    }

    // 2. Rows that are not real arrivals or departures.
    const internal = findStakingMoves(rows);
    const pendingDuplicates = findPendingDuplicates(rows);

    // 3. Group by refid, keeping file order.
    const groups = new Map<string, Row[]>();
    for (const r of rows) {
      const g = groups.get(r.refid) ?? [];
      g.push(r);
      groups.set(r.refid, g);
    }

    for (const [refid, group] of groups) {
      const first = group[0]!;
      const id = `kraken:${accountId}:${refid}`;
      const sourceRef = `lines ${group.map((g) => g.line).join(',')}`;
      const warnAll = (code: ImportWarning['code'], message: string): void => {
        for (const g of group) warnings.push({ line: g.line, code, message });
      };
      // KFEE are fee credits, not an asset the user can sell; they never affect basis.
      const real = group.filter((g) => g.asset !== 'KFEE');
      const type = first.type;
      if (real.length === 0) {
        skipped += group.length;
        continue;
      }

      if (type === 'trade' || type === 'spend' || type === 'receive') {
        const out = real.filter((g) => g.amount.isNegative());
        const inn = real.filter((g) => g.amount.isPositive());
        if (out.length !== 1 || inn.length !== 1) {
          warnAll(
            'unrecognized_row',
            `Trade ${refid}: expected one outgoing and one incoming row, found ${out.length} and ${inn.length}.`,
          );
          continue;
        }
        const sent = out[0]!;
        const recv = inn[0]!;
        const fees = real.filter((g) => !g.fee.isZero());
        const [primaryFee, ...extraFees] = fees;
        events.push({
          kind: 'trade',
          id,
          timestamp: first.time,
          accountId,
          sent: { asset: sent.asset, quantity: sent.amount.abs().toFixed() },
          received: { asset: recv.asset, quantity: recv.amount.toFixed() },
          ...(primaryFee
            ? { fee: { asset: primaryFee.asset, quantity: primaryFee.fee.toFixed() } }
            : {}),
          sourceRef,
        });
        extraFees.forEach((f, i) =>
          events.push(feeEvent(`${id}:fee${i + 2}`, f, accountId, sourceRef)),
        );
        imported += real.length;
        skipped += group.length - real.length; // KFEE fee-credit rows
        continue;
      }

      for (const r of real) {
        const rowId = `kraken:${accountId}:${r.txid || `${refid}:${r.line}`}`;
        const amount: AssetAmount = { asset: r.asset, quantity: r.amount.abs().toFixed() };
        const fiatRow = isFiat(r.asset);
        if (
          INTERNAL_SUBTYPES.has(r.subtype) ||
          (r.type === 'earn' && r.subtype !== 'reward') ||
          internal.has(r) ||
          pendingDuplicates.has(r)
        ) {
          skipped++;
          continue;
        }
        if ((r.type === 'deposit' || r.type === 'withdrawal') && r.txid === '') {
          warnings.push({
            line: r.line,
            code: 'assumption',
            message: `Kraken ${r.type} has no txid and no credited row; treated as completed.`,
          });
        }
        if (UNSUPPORTED_TYPES.has(r.type)) {
          warnings.push({
            line: r.line,
            code: 'unsupported_type',
            message: `Kraken "${r.type}" entries are not supported yet.`,
          });
          continue;
        }
        switch (r.type) {
          case 'deposit':
            if (fiatRow) skipped++;
            else {
              const net = r.amount.minus(r.fee);
              events.push({
                kind: 'external_deposit',
                id: rowId,
                timestamp: r.time,
                accountId,
                received: { asset: r.asset, quantity: net.toFixed() },
                sourceRef,
              });
              imported++;
            }
            break;
          case 'withdrawal':
            if (fiatRow) skipped++;
            else {
              events.push({
                kind: 'external_withdrawal',
                id: rowId,
                timestamp: r.time,
                accountId,
                sent: amount,
                sourceRef,
              });
              if (!r.fee.isZero()) events.push(feeEvent(`${rowId}:fee`, r, accountId, sourceRef));
              imported++;
            }
            break;
          case 'staking':
          case 'earn':
          case 'dividend':
          case 'credit':
          case 'nft_rebate':
            if (!r.amount.isPositive()) {
              warnings.push({
                line: r.line,
                code: 'unrecognized_row',
                message: `Negative ${r.type} entry is not understood.`,
              });
              break;
            }
            events.push({
              kind: 'income',
              id: rowId,
              timestamp: r.time,
              accountId,
              incomeType: r.type === 'staking' || r.type === 'earn' ? 'staking' : 'other',
              received: { asset: r.asset, quantity: r.amount.minus(r.fee).toFixed() },
              sourceRef,
            });
            imported++;
            break;
          case 'transfer':
            if (r.amount.isPositive() && !fiatRow) {
              // Often an airdrop or fork credit; we can't tell which, so it becomes a deposit
              // with unknown basis and the engine's fix queue asks the user.
              events.push({
                kind: 'external_deposit',
                id: rowId,
                timestamp: r.time,
                accountId,
                received: amount,
                sourceRef,
              });
              warnings.push({
                line: r.line,
                code: 'assumption',
                message:
                  'Kraken "transfer" credit imported as a deposit with unknown basis; it may be an airdrop.',
              });
              imported++;
            } else {
              warnings.push({
                line: r.line,
                code: 'unrecognized_row',
                message: 'Kraken "transfer" debit is not understood.',
              });
            }
            break;
          default:
            warnings.push({
              line: r.line,
              code: 'unknown_type',
              message: `Unknown Kraken ledger type "${r.type}".`,
            });
        }
      }
      skipped += group.length - real.length;
    }

    return { events, warnings, stats: { rows: table.rows.length, imported, skipped } };
  },
};

function feeEvent(id: string, r: Row, accountId: string, sourceRef: string): LedgerEvent {
  return {
    kind: 'fee',
    id,
    timestamp: r.time,
    accountId,
    fee: { asset: r.asset, quantity: r.fee.toFixed() },
    sourceRef,
  };
}

const FUNDING = new Set(['deposit', 'withdrawal']);
const STAKING_WINDOW_MS = 14 * 24 * 3_600_000;

/**
 * Kraken lists a funding movement twice: pending (blank txid) and credited (with txid).
 * The pending row is a duplicate whenever the same refid has a credited row of the same
 * type and asset.
 */
function findPendingDuplicates(rows: readonly Row[]): Set<Row> {
  const credited = new Set(
    rows
      .filter((r) => FUNDING.has(r.type) && r.txid !== '')
      .map((r) => `${r.refid}|${r.type}|${r.asset}`),
  );
  return new Set(
    rows.filter(
      (r) =>
        FUNDING.has(r.type) && r.txid === '' && credited.has(`${r.refid}|${r.type}|${r.asset}`),
    ),
  );
}

/**
 * Moving coins between spot and staking shows up as a withdrawal of one form of the asset
 * and a deposit of the other (DOT → DOT.S, or back). Both stay in the same account, so
 * neither is an arrival or departure. Rows on a staking asset are always internal; the
 * spot-side row is paired with the closest staking row of the same quantity (≤ 2% apart,
 * spot side first when staking, staking side first when unstaking, within 14 days).
 */
function findStakingMoves(rows: readonly Row[]): Set<Row> {
  const internal = new Set<Row>();
  const funding = rows.filter((r) => FUNDING.has(r.type));
  const ms = new Map(funding.map((r) => [r, Date.parse(r.time)]));
  for (const s of funding.filter((r) => r.staked)) {
    internal.add(s);
    const wantType = s.type === 'deposit' ? 'withdrawal' : 'deposit';
    let best: Row | null = null;
    let bestGap = Infinity;
    for (const c of funding) {
      if (c.staked || internal.has(c) || c.type !== wantType || c.asset !== s.asset) continue;
      // Staking: spot withdrawal precedes the staking deposit. Unstaking: the reverse.
      const gap = s.type === 'deposit' ? ms.get(s)! - ms.get(c)! : ms.get(c)! - ms.get(s)!;
      if (gap < 0 || gap > STAKING_WINDOW_MS) continue;
      const a = s.amount.abs();
      const b = c.amount.abs();
      const big = a.greaterThan(b) ? a : b;
      if (big.isZero() || a.minus(b).abs().greaterThan(big.times('0.02'))) continue;
      if (gap < bestGap) {
        best = c;
        bestGap = gap;
      }
    }
    if (best) internal.add(best);
  }
  return internal;
}
