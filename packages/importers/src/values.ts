import { dec, type Decimal, type Timestamp } from '@svdt/domain';

/** Parsing helpers shared by format modules. All pure; failures return `null`. */

const FULL_WIDTH = /[０-９．，－＋]/g;

function toHalfWidth(s: string): string {
  return s.replace(FULL_WIDTH, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
}

/**
 * Parses a decimal cell: tolerates thousands separators, currency symbols ($, ¥, ￥),
 * surrounding spaces, full-width digits and a trailing currency code (`12.5 USD`).
 */
export function parseAmount(raw: string | undefined): Decimal | null {
  if (raw === undefined) return null;
  let s = toHalfWidth(raw).trim();
  if (s === '') return null;
  s = s.replace(/\s+[A-Za-z]{3,5}$/, '');
  s = s.replace(/[$¥￥€£,\s]/g, '');
  if (/^\(.*\)$/.test(s)) s = `-${s.slice(1, -1)}`;
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null;
  return dec(s.replace(/^\+/, ''));
}

/** Like `parseAmount`, but an empty cell is zero. */
export function parseAmountOrZero(raw: string | undefined): Decimal | null {
  if (raw === undefined || raw.trim() === '') return dec('0');
  return parseAmount(raw);
}

const DATE_TIME =
  /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})[ T](\d{1,2}):(\d{2})(?::(\d{2})(\.\d+)?)?\s*(Z|UTC|[+-]\d{2}:?\d{2})?$/i;

/**
 * Parses common exchange timestamp shapes into ISO-8601 with an explicit offset.
 * `defaultOffset` applies when the cell has none (e.g. `+09:00` for Japanese exchanges,
 * `Z` for exchanges that document UTC).
 */
export function parseTimestamp(
  raw: string | undefined,
  defaultOffset: 'Z' | `${'+' | '-'}${string}`,
): Timestamp | null {
  if (!raw) return null;
  const m = DATE_TIME.exec(toHalfWidth(raw).trim());
  if (!m) return null;
  const [, y, mo, d, h, mi, sec = '00', frac = '', zone] = m;
  // Date.parse rolls impossible dates over (2025-02-30 → 2 March), so check the calendar.
  const [yn, mon, dn, hn, mn, sn] = [y, mo, d, h, mi, sec].map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const daysInMonth = new Date(Date.UTC(yn, mon, 0)).getUTCDate();
  if (mon < 1 || mon > 12 || dn < 1 || dn > daysInMonth || hn > 23 || mn > 59 || sn > 59) {
    return null;
  }
  const pad = (v: string | undefined): string => (v ?? '').padStart(2, '0');
  let offset: string = defaultOffset;
  if (zone) {
    const z = zone.toUpperCase();
    offset =
      z === 'Z' || z === 'UTC' ? 'Z' : z.includes(':') ? z : `${z.slice(0, 3)}:${z.slice(3)}`;
  }
  const ms = frac ? frac.slice(0, 4).padEnd(4, '0') : '';
  const iso = `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${mi}:${pad(sec)}${ms}${offset}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

/** Small, stable 53-bit string hash (cyrb53) for deriving event ids from row content. */
export function hashString(s: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/**
 * Stable ids for files without a transaction id column: a hash of the row's content,
 * plus an occurrence counter so identical rows stay distinct but re-imports dedupe.
 */
export class RowIds {
  private readonly seen = new Map<string, number>();

  constructor(private readonly prefix: string) {}

  next(cells: Record<string, string>): string {
    const content = Object.keys(cells)
      .sort()
      .map((k) => `${k}=${cells[k]}`)
      .join('\u0001');
    const h = hashString(content);
    const n = (this.seen.get(h) ?? 0) + 1;
    this.seen.set(h, n);
    return `${this.prefix}:${h}${n > 1 ? `:${n}` : ''}`;
  }
}
