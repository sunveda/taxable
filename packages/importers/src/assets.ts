import { fiatAsset, type AssetId } from '@svdt/domain';

/** Fiat currencies we recognise in exchange exports. */
const FIAT = new Set(['USD', 'JPY', 'EUR', 'GBP', 'CAD', 'AUD', 'CHF', 'SGD', 'HKD', 'KRW']);

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
  if (FIAT.has(t)) return fiatAsset(t);
  return ALIASES[t] ?? t;
}

export function isFiatTicker(raw: string): boolean {
  return FIAT.has(raw.trim().toUpperCase());
}
