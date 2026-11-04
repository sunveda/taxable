import type { Timestamp } from './ledger';

/** A calendar date in a specific time zone. */
export interface LocalDate {
  year: number;
  month: number; // 1-12
  day: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

const OFFSET_SUFFIX = /(Z|[+-]\d{2}:\d{2})$/;

/** Parses an ISO-8601 timestamp that must carry an explicit offset. */
export function parseInstant(ts: Timestamp): number {
  if (!OFFSET_SUFFIX.test(ts)) {
    throw new Error(`Timestamp must include a UTC offset: ${ts}`);
  }
  const ms = Date.parse(ts);
  if (Number.isNaN(ms)) throw new Error(`Invalid timestamp: ${ts}`);
  return ms;
}

/** Calendar date of an instant as observed in `timeZone` (IANA name). */
export function localDate(ts: Timestamp, timeZone: string): LocalDate {
  const parts = formatterFor(timeZone).formatToParts(parseInstant(ts));
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day') };
}

export function compareLocalDates(a: LocalDate, b: LocalDate): number {
  return a.year - b.year || a.month - b.month || a.day - b.day;
}

function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Adds whole years; 29 Feb maps to 28 Feb in non-leap years. */
export function addYears(d: LocalDate, years: number): LocalDate {
  const year = d.year + years;
  const day = d.month === 2 && d.day === 29 && !isLeapYear(year) ? 28 : d.day;
  return { year, month: d.month, day };
}

export function formatLocalDate(d: LocalDate): string {
  const pad = (n: number, w: number): string => String(n).padStart(w, '0');
  return `${pad(d.year, 4)}-${pad(d.month, 2)}-${pad(d.day, 2)}`;
}
