import { fiatAsset, type AssetId } from '@svdt/domain';

/**
 * Fiat currencies recognised by bare ISO code in exchange exports.
 *
 * Deliberately not the full ISO 4217 list: several codes are also crypto tickers (MNT is
 * Mantle and the Mongolian tögrög, SCR is Scroll and the Seychelles rupee; also BOB, SOS,
 * ALL), and treating a coin as cash would silently drop its disposals. Any other currency
 * can be written unambiguously as `fiat:XXX` (see docs/spec/canonical-csv.md).
 */
const FIAT = new Set([
  // Exchange-native and G10
  'USD',
  'JPY',
  'EUR',
  'GBP',
  'CAD',
  'AUD',
  'NZD',
  'CHF',
  'SEK',
  'NOK',
  'DKK',
  // Asia-Pacific
  'SGD',
  'HKD',
  'KRW',
  'CNY',
  'TWD',
  'INR',
  'IDR',
  'THB',
  'MYR',
  'PHP',
  'VND',
  // Americas
  'MXN',
  'BRL',
  'ARS',
  'CLP',
  'COP',
  'PEN',
  // Europe, Middle East, Africa
  'PLN',
  'CZK',
  'HUF',
  'RON',
  'TRY',
  'UAH',
  'ILS',
  'AED',
  'SAR',
  'ZAR',
  'NGN',
  'KES',
]);

/** Explicit fiat notation for codes outside `FIAT`, e.g. `fiat:MNT`. */
const EXPLICIT_FIAT = /^FIAT:([A-Z]{3})$/;

/** Exchange-specific ticker aliases → canonical tickers. */
const ALIASES: Record<string, string> = {
  XBT: 'BTC',
  XDG: 'DOGE',
  ETH2: 'ETH',
};

/**
 * Maps a ticker as written in an export to a canonical `AssetId`.
 * Fiat → `fiat:XXX`; crypto → upper-case ticker. Chain-qualified ids come from on-chain
 * importers, not CSVs (data-ingestion-spec §5).
 */
export function normalizeTicker(raw: string): AssetId {
  const t = raw.trim().toUpperCase();
  const explicit = EXPLICIT_FIAT.exec(t)?.[1];
  if (explicit) return fiatAsset(explicit);
  if (FIAT.has(t)) return fiatAsset(t);
  return ALIASES[t] ?? t;
}

export function isFiatTicker(raw: string): boolean {
  const t = raw.trim().toUpperCase();
  return FIAT.has(t) || EXPLICIT_FIAT.test(t);
}
