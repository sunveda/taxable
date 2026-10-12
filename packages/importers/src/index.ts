import { parseCsvRecords, toTable } from './csv';
import { canonicalCsv } from './formats/canonical';
import { coinbaseCsv } from './formats/coinbase';
import { bitflyerCsv, jpIndustryStandardCsv } from './formats/japan';
import { krakenLedgersCsv } from './formats/kraken';
import type { CsvImporter, ImportContext, ImportResult } from './types';

export * from './types';
export { decodeText } from './text';
export { matchTransfers, type MatchOptions, type TransferMatch } from './match-transfers';
export { parseCsvRecords, toTable, type CsvTable } from './csv';

/** Registered importers. Detection prefers the importer whose required columns match most. */
export const csvImporters: readonly CsvImporter[] = [
  canonicalCsv,
  coinbaseCsv,
  krakenLedgersCsv,
  jpIndustryStandardCsv,
  bitflyerCsv,
];

export class UnknownFormatError extends Error {
  constructor() {
    super(
      'Unrecognized CSV format. Convert it to the svdt canonical CSV (docs/spec/canonical-csv.md).',
    );
    this.name = 'UnknownFormatError';
  }
}

export interface DetectedImport extends ImportResult {
  importer: Pick<CsvImporter, 'id' | 'name' | 'format'>;
}

/**
 * Detects the format of a CSV export and imports it.
 * Pass `importerId` to skip detection.
 */
export function importCsv(
  text: string,
  ctx: ImportContext & { importerId?: string },
): DetectedImport {
  const records = parseCsvRecords(text);
  const candidates = ctx.importerId
    ? csvImporters.filter((i) => i.id === ctx.importerId)
    : csvImporters;
  let chosen: { importer: CsvImporter; table: NonNullable<ReturnType<typeof toTable>> } | null =
    null;
  for (const importer of candidates) {
    const table = toTable(records, importer.requiredColumns);
    if (!table) continue;
    if (!chosen || importer.requiredColumns.length > chosen.importer.requiredColumns.length)
      chosen = { importer, table };
  }
  if (!chosen) throw new UnknownFormatError();
  const { importer, table } = chosen;
  return {
    importer: { id: importer.id, name: importer.name, format: importer.format },
    ...importer.parse(table, ctx),
  };
}
