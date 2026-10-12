import DecimalJs from 'decimal.js';

/**
 * Arbitrary-precision decimal used for every quantity and amount (ADR-0008).
 *
 * Precision is 60 significant digits. The engine never rounds on purpose; the only
 * implicit rounding is in division (average cost, proportional allocation), which at
 * 60 digits is far below any reporting precision.
 */
export const Decimal = DecimalJs.clone({
  precision: 60,
  rounding: DecimalJs.ROUND_HALF_EVEN,
  toExpNeg: -60,
  toExpPos: 60,
});
export type Decimal = InstanceType<typeof Decimal>;

/** Accepts strings or Decimals only: JS numbers are banned for amounts (ADR-0008). */
export function dec(value: string | Decimal): Decimal {
  return new Decimal(value);
}

export const ZERO: Decimal = dec('0');

export function sum(values: readonly Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

export function max(a: Decimal, b: Decimal): Decimal {
  return a.greaterThanOrEqualTo(b) ? a : b;
}

export function min(a: Decimal, b: Decimal): Decimal {
  return a.lessThanOrEqualTo(b) ? a : b;
}

export type RoundingMode = 'HALF_UP' | 'HALF_EVEN' | 'DOWN' | 'UP';

const ROUNDING: Record<RoundingMode, DecimalJs.Rounding> = {
  HALF_UP: DecimalJs.ROUND_HALF_UP,
  HALF_EVEN: DecimalJs.ROUND_HALF_EVEN,
  DOWN: DecimalJs.ROUND_DOWN,
  UP: DecimalJs.ROUND_UP,
};

/** Rounding happens only at the reporting boundary (ADR-0008). */
export function roundTo(value: Decimal, decimalPlaces: number, mode: RoundingMode): Decimal {
  return value.toDecimalPlaces(decimalPlaces, ROUNDING[mode]);
}

/**
 * Splits `total` across `weights` proportionally so the parts sum to `total` exactly.
 * The last part absorbs any division remainder.
 */
export function allocateProportionally(total: Decimal, weights: readonly Decimal[]): Decimal[] {
  const weightSum = sum(weights);
  if (weights.length === 0) return [];
  if (weightSum.isZero()) {
    return weights.map((_, i) => (i === weights.length - 1 ? total : ZERO));
  }
  const parts: Decimal[] = [];
  let allocated = ZERO;
  weights.forEach((w, i) => {
    if (i === weights.length - 1) {
      parts.push(total.minus(allocated));
    } else {
      const part = total.times(w).dividedBy(weightSum);
      parts.push(part);
      allocated = allocated.plus(part);
    }
  });
  return parts;
}
