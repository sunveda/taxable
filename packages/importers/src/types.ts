import type { AccountId, LedgerEvent } from '@svdt/domain';
import type { CsvTable } from './csv';

export type WarningCode =
  | 'unknown_type'
  | 'unsupported_type'
  | 'invalid_number'
  | 'invalid_timestamp'
  | 'unrecognized_row'
  | 'assumption';

/** A row we couldn't import as-is. Rows are never dropped silently. */
export interface ImportWarning {
  /** 1-based line number in the source file; `null` for file-level warnings. */
  line: number | null;
  code: WarningCode;
  message: string;
}

export interface ImportContext {
  /** The user's name for this account, e.g. `coinbase` or `bitflyer-main`. */
  accountId: AccountId;
}

export interface ImportResult {
  events: LedgerEvent[];
  warnings: ImportWarning[];
  /** Data rows read, rows turned into events, and rows intentionally skipped (e.g. fiat deposits). */
  stats: { rows: number; imported: number; skipped: number };
}

/**
 * How much we trust our knowledge of a file format.
 * `unverified`: built from public descriptions and synthetic fixtures; must be checked
 * against real (anonymized) exports before it is enabled for users.
 */
export interface FormatProvenance {
  status: 'verified' | 'unverified';
  sources: string[];
  notes?: string;
}

export interface CsvImporter {
  id: string;
  name: string;
  /** Markets whose users this importer serves first. */
  markets: readonly ('us' | 'jp')[];
  format: FormatProvenance;
  /** All of these must appear in the header row for the importer to claim a file. */
  requiredColumns: readonly string[];
  parse(table: CsvTable, ctx: ImportContext): ImportResult;
}
