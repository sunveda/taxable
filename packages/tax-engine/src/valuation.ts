import {
  dec,
  fiatAsset,
  fiatCurrency,
  parseInstant,
  type AssetAmount,
  type AssetId,
  type CurrencyCode,
  type Decimal,
  type PriceQuote,
  type Timestamp,
} from '@svdt/domain';

/** A quote older than this is not used. */
const MAX_QUOTE_AGE_MS = 24 * 60 * 60 * 1000;

export type ValuationSource =
  | { kind: 'report_currency' }
  | { kind: 'event_value' }
  | { kind: 'price_quote'; source: string; quotedAt: Timestamp }
  | { kind: 'converted_event_value'; source: string; quotedAt: Timestamp };

export interface Valuation {
  value: Decimal;
  via: ValuationSource;
}

interface IndexedQuote {
  ms: number;
  quote: PriceQuote;
}

/** Values amounts in the report currency, deterministically, from event data and quotes. */
export class Valuer {
  private readonly index = new Map<string, IndexedQuote[]>();

  constructor(
    readonly currency: CurrencyCode,
    prices: readonly PriceQuote[],
  ) {
    for (const quote of prices) {
      if (quote.currency !== currency) continue;
      const key = quote.asset;
      const list = this.index.get(key) ?? [];
      list.push({ ms: parseInstant(quote.timestamp), quote });
      this.index.set(key, list);
    }
    for (const list of this.index.values()) {
      list.sort((a, b) => a.ms - b.ms || a.quote.source.localeCompare(b.quote.source));
    }
  }

  /**
   * Priority: the report currency itself → a value the event states in the report
   * currency → a unit price quote → the event's value in another fiat, converted.
   */
  value(amount: AssetAmount, at: Timestamp): Valuation | null {
    const quantity = dec(amount.quantity);
    if (amount.asset === fiatAsset(this.currency)) {
      return { value: quantity, via: { kind: 'report_currency' } };
    }
    if (amount.value && amount.value.currency === this.currency) {
      return { value: dec(amount.value.amount), via: { kind: 'event_value' } };
    }
    const quote = this.quote(amount.asset, at);
    if (quote) {
      return {
        value: quantity.times(dec(quote.unitPrice)),
        via: { kind: 'price_quote', source: quote.source, quotedAt: quote.timestamp },
      };
    }
    const otherFiat = amount.value ? amount.value.currency : fiatCurrency(amount.asset);
    if (otherFiat) {
      const fx = this.quote(fiatAsset(otherFiat), at);
      if (fx) {
        const base = amount.value ? dec(amount.value.amount) : quantity;
        return {
          value: base.times(dec(fx.unitPrice)),
          via: { kind: 'converted_event_value', source: fx.source, quotedAt: fx.timestamp },
        };
      }
    }
    return null;
  }

  /** Latest quote at or before `at`, no older than a day. */
  private quote(asset: AssetId, at: Timestamp): PriceQuote | null {
    const list = this.index.get(asset);
    if (!list) return null;
    const ms = parseInstant(at);
    let found: IndexedQuote | null = null;
    for (const q of list) {
      if (q.ms > ms) break;
      found = q;
    }
    if (!found || ms - found.ms > MAX_QUOTE_AGE_MS) return null;
    return found.quote;
  }
}
