import { dec, roundTo } from '@svdt/domain';

/** Formatting of exact decimal strings. Never goes through JS numbers (ADR-0008). */

function group(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Money in the report currency: yen truncated to whole yen, dollars to cents. */
export function money(value: string, currency: string, opts: { sign?: boolean } = {}): string {
  const places = currency === 'JPY' ? 0 : 2;
  const d = roundTo(dec(value), places, currency === 'JPY' ? 'DOWN' : 'HALF_EVEN');
  const fixed = d.abs().toFixed(places);
  const [int = '0', frac] = fixed.split('.');
  const symbol = currency === 'JPY' ? '¥' : currency === 'USD' ? '$' : `${currency} `;
  const sign = d.isNegative() && !d.isZero() ? '−' : opts.sign && !d.isZero() ? '+' : '';
  return `${sign}${symbol}${group(int)}${frac ? `.${frac}` : ''}`;
}

/** A crypto quantity, trimmed of trailing zeros. */
export function qty(value: string): string {
  const d = dec(value);
  const [int = '0', frac] = d.abs().toFixed().split('.');
  return `${d.isNegative() ? '−' : ''}${group(int)}${frac ? `.${frac}` : ''}`;
}

export function asset(id: string): string {
  return id.startsWith('fiat:') ? id.slice(5) : id;
}

export function date(iso: string, lang: 'ja' | 'en', timeZone: string): string {
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone,
  }).format(new Date(iso));
}

export function dateTime(iso: string, lang: 'ja' | 'en', timeZone: string): string {
  return new Intl.DateTimeFormat(lang === 'ja' ? 'ja-JP' : 'en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone,
  }).format(new Date(iso));
}

/** The larger of |min| and |max|: how much an issue could move the result. */
export function swing(impact: { min: string; max: string }): string {
  const a = dec(impact.min).abs();
  const b = dec(impact.max).abs();
  return (a.greaterThan(b) ? a : b).toFixed();
}

export function sumDecimals(values: readonly string[]): string {
  return values.reduce((acc, v) => acc.plus(dec(v)), dec('0')).toFixed();
}

export function isZero(value: string): boolean {
  return dec(value).isZero();
}
