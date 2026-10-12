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

export interface Estimate {
  value: Decimal;
  /** Value per unit; `null` for a zero quantity converted from a stated value. */
  unitPrice: Decimal | null;
  quotedAt: Timestamp;
  /** Distance in time between the quote and the event. */
  ageMs: number;
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

  /** The value if one is available, otherwise the ranking estimate. For issue impact only. */
  valueOrEstimate(amount: AssetAmount, at: Timestamp): Decimal | null {
    return this.value(amount, at)?.value ?? this.estimate(amount, at);
  }

  /**
   * Rough value for ranking issues only, never for reported figures: the nearest quote at
   * any distance in time (earlier wins a tie), or the stated value converted via the
   * nearest FX quote.
   */
  estimate(amount: AssetAmount, at: Timestamp): Decimal | null {
    return this.estimateDetail(amount, at)?.value ?? null;
  }

  /** `estimate` plus the implied unit price and the quote it came from. */
  estimateDetail(amount: AssetAmount, at: Timestamp): Estimate | null {
    const quantity = dec(amount.quantity);
    const near = this.nearest(amount.asset, at);
    if (near) {
      return {
        value: quantity.times(dec(near.unitPrice)),
        unitPrice: dec(near.unitPrice),
        quotedAt: near.timestamp,
        ageMs: Math.abs(parseInstant(near.timestamp) - parseInstant(at)),
      };
    }
    const otherFiat = amount.value ? amount.value.currency : fiatCurrency(amount.asset);
    const fx = otherFiat ? this.nearest(fiatAsset(otherFiat), at) : null;
    if (!fx) return null;
    const value = (amount.value ? dec(amount.value.amount) : quantity).times(dec(fx.unitPrice));
    return {
      value,
      // Rounded: a converted price is a suggestion to show, not an exact figure.
      unitPrice: quantity.isZero() ? null : value.dividedBy(quantity).toSignificantDigits(18),
      quotedAt: fx.timestamp,
      ageMs: Math.abs(parseInstant(fx.timestamp) - parseInstant(at)),
    };
  }

  private nearest(asset: AssetId, at: Timestamp): PriceQuote | null {
    const list = this.index.get(asset);
    if (!list || list.length === 0) return null;
    const ms = parseInstant(at);
    const i = lowerBound(list, ms); // first quote at or after `at`
    const after = list[i];
    const before = i > 0 ? list[i - 1] : undefined;
    if (!before) return after ? after.quote : null;
    if (!after) return before.quote;
    // Earlier wins a tie.
    return ms - before.ms <= after.ms - ms ? before.quote : after.quote;
  }

  /** Latest quote at or before `at`, no older than a day. */
  private quote(asset: AssetId, at: Timestamp): PriceQuote | null {
    const list = this.index.get(asset);
    if (!list || list.length === 0) return null;
    const ms = parseInstant(at);
    const i = upperBound(list, ms) - 1; // last quote at or before `at`
    const found = i >= 0 ? list[i] : undefined;
    if (!found || ms - found.ms > MAX_QUOTE_AGE_MS) return null;
    return found.quote;
  }
}

/** Index of the first quote with `ms >= target` (list sorted by ms). */
function lowerBound(list: readonly IndexedQuote[], target: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid]!.ms < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Index of the first quote with `ms > target` (list sorted by ms). */
function upperBound(list: readonly IndexedQuote[], target: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid]!.ms <= target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
