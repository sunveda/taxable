import type { AssetAmount, LedgerEvent } from '@svdt/domain';
import { isFiatTicker, normalizeTicker } from '../assets';
import type { CsvTable } from '../csv';
import type { CsvImporter, ImportContext, ImportResult, ImportWarning } from '../types';
import { parseAmount, parseTimestamp, RowIds } from '../values';
import { countLines } from './canonical';

/**
 * Coinbase (retail) "Transaction history" CSV.
 *
 * Header (current format):
 *   ID, Timestamp, Transaction Type, Asset, Quantity Transacted, Price Currency,
 *   Price at Transaction, Subtotal, Total (inclusive of fees and/or spread),
 *   Fees and/or Spread, Notes
 * preceded by preamble lines (user name, id).
 *
 * Transaction-type labels have changed over time ("Advance"/"Advanced Trade",
 * "Reward"/"Rewards Income"), so we accept known variants and warn on anything else.
 */
const BUY = new Set(['buy', 'advanced trade buy', 'advance trade buy']);
const SELL = new Set(['sell', 'advanced trade sell', 'advance trade sell']);
const STAKING = new Set(['staking income', 'inflation reward']);
const REWARD = new Set(['rewards income', 'reward income']);
const AIRDROP = new Set(['learning reward', 'coinbase earn']);
/** Movements inside Coinbase that don't change what the user holds. */
const INTERNAL = new Set([
  'pro deposit',
  'pro withdrawal',
  'exchange deposit',
  'exchange withdrawal',
  'retail staking transfer',
  'retail unstaking transfer',
  'retail eth2 deprecation',
]);

const CONVERT_NOTE = /Converted\s+([\d.,]+)\s+(\S+)\s+to\s+([\d.,]+)\s+(\S+)/i;

export const coinbaseCsv: CsvImporter = {
  id: 'coinbase.transactions.csv.v2',
  name: 'Coinbase transaction history (CSV)',
  markets: ['us'],
  format: {
    status: 'unverified',
    sources: [
      'Header as reported in https://gitlab.com/c1560/cryptofiscafacile/-/issues/595',
      'Type labels per BittyTax changelog (https://github.com/BittyTax/BittyTax/blob/master/CHANGELOG.md)',
    ],
    notes: 'Needs anonymized real exports before enabling. Convert rows rely on the Notes text.',
  },
  requiredColumns: [
    'Timestamp',
    'Transaction Type',
    'Asset',
    'Quantity Transacted',
    'Price Currency',
  ],
  parse(table: CsvTable, ctx: ImportContext): ImportResult {
    const events: LedgerEvent[] = [];
    const warnings: ImportWarning[] = [];
    let skipped = 0;
    const accountId = ctx.accountId;
    // Rows without an ID get a content hash, which stays stable across overlapping exports
    // (a position-based id would change and duplicate the transaction on re-import).
    const rowIds = new RowIds(`coinbase:${accountId}`);

    table.rows.forEach(({ line, cells }) => {
      const warn = (code: ImportWarning['code'], message: string): void => {
        warnings.push({ line, code, message });
      };
      const timestamp = parseTimestamp(cells['Timestamp'], 'Z');
      if (!timestamp)
        return warn('invalid_timestamp', `Unreadable timestamp "${cells['Timestamp'] ?? ''}".`);
      const type = (cells['Transaction Type'] ?? '').trim();
      const t = type.toLowerCase();
      const assetRaw = cells['Asset'] ?? '';
      const asset = normalizeTicker(assetRaw);
      const qty = parseAmount(cells['Quantity Transacted'])?.abs();
      const priceCurrency = (cells['Price Currency'] ?? '').trim();
      const price = parseAmount(cells['Price at Transaction']);
      const subtotal = parseAmount(cells['Subtotal'])?.abs() ?? null;
      const fees = parseAmount(cells['Fees and/or Spread'])?.abs() ?? null;
      if (!qty) return warn('invalid_number', 'Quantity Transacted is missing or not a number.');
      const id = cells['ID'] ? `coinbase:${accountId}:${cells['ID']}` : rowIds.next(cells);
      const sourceRef = `line ${line}`;

      // Market value of the row in the price currency, when that is fiat.
      const rowValue = subtotal ?? (price ? qty.times(price) : null);
      const valued = (a: AssetAmount): AssetAmount =>
        rowValue && isFiatTicker(priceCurrency)
          ? { ...a, value: { amount: rowValue.toFixed(), currency: priceCurrency.toUpperCase() } }
          : a;
      const feeAmount: AssetAmount | undefined =
        fees && !fees.isZero() && priceCurrency
          ? { asset: normalizeTicker(priceCurrency), quantity: fees.toFixed() }
          : undefined;
      const feePart = feeAmount ? { fee: feeAmount } : {};
      const base = { asset, quantity: qty.toFixed() };

      if (INTERNAL.has(t) || ((t === 'deposit' || t === 'withdrawal') && isFiatTicker(assetRaw))) {
        skipped++;
        return;
      }
      if (BUY.has(t) || SELL.has(t)) {
        if (!rowValue || !priceCurrency)
          return warn('invalid_number', `${type} row has no Subtotal or price.`);
        const counter = { asset: normalizeTicker(priceCurrency), quantity: rowValue.toFixed() };
        events.push(
          BUY.has(t)
            ? {
                kind: 'trade',
                id,
                timestamp,
                accountId,
                sent: counter,
                received: base,
                ...feePart,
                sourceRef,
              }
            : {
                kind: 'trade',
                id,
                timestamp,
                accountId,
                sent: base,
                received: counter,
                ...feePart,
                sourceRef,
              },
        );
        return;
      }
      if (t === 'convert') {
        const m = CONVERT_NOTE.exec(cells['Notes'] ?? '');
        const sentQty = m ? parseAmount(m[1]) : null;
        const recvQty = m ? parseAmount(m[3]) : null;
        if (!m || !sentQty || !recvQty)
          return warn(
            'unrecognized_row',
            'Convert row: could not read "Converted X A to Y B" from Notes.',
          );
        events.push({
          kind: 'trade',
          id,
          timestamp,
          accountId,
          sent: { asset: normalizeTicker(m[2]!), quantity: sentQty.toFixed() },
          received: valued({ asset: normalizeTicker(m[4]!), quantity: recvQty.toFixed() }),
          ...feePart,
          sourceRef,
        });
        return;
      }
      if (t === 'send' || t === 'withdrawal') {
        events.push({
          kind: 'external_withdrawal',
          id,
          timestamp,
          accountId,
          sent: valued(base),
          sourceRef,
        });
        return;
      }
      if (t === 'receive' || t === 'deposit') {
        events.push({
          kind: 'external_deposit',
          id,
          timestamp,
          accountId,
          received: valued(base),
          sourceRef,
        });
        return;
      }
      const incomeType = STAKING.has(t)
        ? 'staking'
        : REWARD.has(t)
          ? 'other'
          : AIRDROP.has(t)
            ? 'airdrop'
            : null;
      if (incomeType) {
        events.push({
          kind: 'income',
          id,
          timestamp,
          accountId,
          incomeType,
          received: valued(base),
          sourceRef,
        });
        return;
      }
      warn('unknown_type', `Unknown Coinbase transaction type "${type}"; row not imported.`);
    });

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
