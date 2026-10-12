import type { AssetAmount, IncomeType, LedgerEvent } from '@svdt/domain';
import { normalizeTicker } from '../assets';
import type { CsvTable } from '../csv';
import type { CsvImporter, ImportContext, ImportResult, ImportWarning } from '../types';
import { parseAmount, parseTimestamp, RowIds } from '../values';

/**
 * svdt canonical CSV: our own documented format (docs/spec/canonical-csv.md). Users and
 * partners can convert any export into it, so it's the fallback for every exchange.
 */
const INCOME_TYPES: readonly IncomeType[] = [
  'staking',
  'mining',
  'airdrop',
  'interest',
  'hard_fork',
  'other',
];

export const canonicalCsv: CsvImporter = {
  id: 'svdt.canonical.v1',
  name: 'svdt canonical CSV (v1)',
  markets: ['us', 'jp'],
  format: { status: 'verified', sources: ['docs/spec/canonical-csv.md'] },
  requiredColumns: ['timestamp', 'type'],
  parse(table: CsvTable, ctx: ImportContext): ImportResult {
    const events: LedgerEvent[] = [];
    const warnings: ImportWarning[] = [];
    const ids = new RowIds(`canonical:${ctx.accountId}`);
    let skipped = 0;

    for (const { line, cells } of table.rows) {
      const warn = (code: ImportWarning['code'], message: string): void => {
        warnings.push({ line, code, message });
      };
      const timestamp = parseTimestamp(cells['timestamp'], 'Z');
      if (!timestamp) {
        warn('invalid_timestamp', `Unreadable timestamp "${cells['timestamp'] ?? ''}".`);
        continue;
      }
      const id = cells['id'] ? `canonical:${ctx.accountId}:${cells['id']}` : ids.next(cells);
      const accountId = cells['account'] || ctx.accountId;
      const amount = (assetCol: string, qtyCol: string): AssetAmount | null | undefined => {
        const asset = cells[assetCol];
        const qtyRaw = cells[qtyCol];
        if (!asset && !qtyRaw) return undefined;
        const q = parseAmount(qtyRaw);
        if (!asset || !q) {
          warn('invalid_number', `Column ${assetCol}/${qtyCol} must hold an asset and a number.`);
          return null;
        }
        return { asset: normalizeTicker(asset), quantity: q.abs().toFixed() };
      };
      const withValue = (a: AssetAmount): AssetAmount => {
        const v = parseAmount(cells['value']);
        const cur = cells['value_currency'];
        return v && cur ? { ...a, value: { amount: v.toFixed(), currency: cur.toUpperCase() } } : a;
      };
      const sent = amount('sent_asset', 'sent_quantity');
      const received = amount('received_asset', 'received_quantity');
      const fee = amount('fee_asset', 'fee_quantity');
      if (sent === null || received === null || fee === null) continue;
      const feePart = fee ? { fee } : {};
      const sourceRef = `line ${line}`;

      switch ((cells['type'] ?? '').toLowerCase()) {
        case 'trade':
          if (!sent || !received) {
            warn('unrecognized_row', 'A trade needs both sent_* and received_* columns.');
            continue;
          }
          events.push({
            kind: 'trade',
            id,
            timestamp,
            accountId,
            sent,
            received: withValue(received),
            ...feePart,
            sourceRef,
          });
          break;
        case 'transfer': {
          const to = cells['to_account'];
          if (!sent || !to) {
            warn('unrecognized_row', 'A transfer needs sent_* and to_account.');
            continue;
          }
          events.push({
            kind: 'transfer',
            id,
            timestamp,
            fromAccountId: accountId,
            toAccountId: to,
            asset: sent.asset,
            quantity: sent.quantity,
            ...feePart,
            sourceRef,
          });
          break;
        }
        case 'income': {
          const incomeType = (cells['income_type'] || 'other').toLowerCase() as IncomeType;
          if (!received || !INCOME_TYPES.includes(incomeType)) {
            warn(
              'unrecognized_row',
              `Income needs received_* and income_type in ${INCOME_TYPES.join(', ')}.`,
            );
            continue;
          }
          events.push({
            kind: 'income',
            id,
            timestamp,
            accountId,
            incomeType,
            received: withValue(received),
            sourceRef,
          });
          break;
        }
        case 'fee':
          if (!fee) {
            warn('unrecognized_row', 'A fee row needs fee_asset and fee_quantity.');
            continue;
          }
          events.push({ kind: 'fee', id, timestamp, accountId, fee: withValue(fee), sourceRef });
          break;
        case 'deposit': {
          if (!received) {
            warn('unrecognized_row', 'A deposit needs received_*.');
            continue;
          }
          const basis = parseAmount(cells['cost_basis']);
          const basisCurrency = cells['cost_basis_currency'];
          const acquiredAt = parseTimestamp(cells['acquired_at'], 'Z');
          events.push({
            kind: 'external_deposit',
            id,
            timestamp,
            accountId,
            received: withValue(received),
            ...(basis && basisCurrency
              ? { costBasis: { amount: basis.toFixed(), currency: basisCurrency.toUpperCase() } }
              : {}),
            ...(acquiredAt ? { acquiredAt } : {}),
            sourceRef,
          });
          break;
        }
        case 'withdrawal':
          if (!sent) {
            warn('unrecognized_row', 'A withdrawal needs sent_*.');
            continue;
          }
          events.push({
            kind: 'external_withdrawal',
            id,
            timestamp,
            accountId,
            sent: withValue(sent),
            sourceRef,
          });
          if (fee)
            events.push({ kind: 'fee', id: `${id}:fee`, timestamp, accountId, fee, sourceRef });
          break;
        case 'ignore':
          skipped++;
          break;
        default:
          warn('unknown_type', `Unknown type "${cells['type'] ?? ''}".`);
      }
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

/** Number of distinct lines that produced a warning (each such row was not imported). */
export function countLines(warnings: readonly ImportWarning[]): number {
  return new Set(
    warnings.filter((w) => w.line !== null && w.code !== 'assumption').map((w) => w.line),
  ).size;
}
