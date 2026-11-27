/** RFC 4180 CSV parsing, plus header-row discovery for files with preamble lines. */

export interface CsvRow {
  /** 1-based line number where the record starts. */
  line: number;
  cells: Record<string, string>;
}

export interface CsvTable {
  header: string[];
  /** 1-based line number of the header row. */
  headerLine: number;
  rows: CsvRow[];
}

interface RawRecord {
  line: number;
  fields: string[];
}

export function parseCsvRecords(text: string): RawRecord[] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const records: RawRecord[] = [];
  let fields: string[] = [];
  let field = '';
  let inQuotes = false;
  let line = 1;
  let recordLine = 1;

  const endField = (): void => {
    fields.push(field);
    field = '';
  };
  const endRecord = (): void => {
    endField();
    if (!(fields.length === 1 && fields[0] === '')) records.push({ line: recordLine, fields });
    fields = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line++;
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === ',') {
      endField();
    } else if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      endRecord();
      line++;
      recordLine = line;
    } else {
      field += ch;
    }
  }
  if (field !== '' || fields.length > 0) endRecord();
  return records;
}

/** Header cells are compared after trimming and collapsing whitespace. */
export function normalizeHeader(cell: string): string {
  return cell.trim().replace(/\s+/g, ' ');
}

/**
 * Finds the first row (within the first `scanRows`) containing every required column and
 * uses it as the header. Rows before it (e.g. Coinbase's account preamble) are ignored.
 */
export function toTable(
  records: RawRecord[],
  requiredColumns: readonly string[],
  scanRows = 15,
): CsvTable | null {
  for (let r = 0; r < Math.min(scanRows, records.length); r++) {
    const rec = records[r]!;
    const header = rec.fields.map(normalizeHeader);
    if (!requiredColumns.every((c) => header.includes(c))) continue;
    const rows = records.slice(r + 1).map((rr) => {
      const cells: Record<string, string> = {};
      header.forEach((h, i) => {
        if (h !== '' && !(h in cells)) cells[h] = (rr.fields[i] ?? '').trim();
      });
      return { line: rr.line, cells };
    });
    return { header, headerLine: rec.line, rows };
  }
  return null;
}
