import { Decimal, ZERO, parseInstant, type AssetId } from '@svdt/domain';
import type { CostBasisMethod } from '@svdt/rule-packs';
import type { ConsumedPart, Lot } from './types';

/**
 * Basis state for one pool: a single asset, either in one account (`per_account` scope)
 * or across all of a person's accounts (`per_user` scope).
 */
export interface Pool {
  readonly asset: AssetId;
  readonly method: CostBasisMethod;
  quantity(): Decimal;
  costBasis(): Decimal;
  add(lot: Lot): void;
  /**
   * Removes `quantity` units. Any units the pool can't cover come back as `shortfall`
   * and the caller decides how to treat them (negative balance).
   */
  take(quantity: Decimal): { parts: ConsumedPart[]; shortfall: Decimal };
  /** Discards all state (used when an opening position replaces it). */
  reset(): void;
}

interface OpenLot {
  lot: Lot;
  remaining: Decimal;
  remainingBasis: Decimal;
  /** Cost per unit, fixed at acquisition: partial consumption keeps the ratio. */
  unitCost: Decimal;
  acquiredMs: number;
  seq: number;
}

/**
 * FIFO, LIFO and HIFO: specific lots, consumed in a method-defined order.
 *
 * Lots are kept in consumption order as they're added (binary insertion), so `take()`
 * only walks from the front instead of re-sorting every open lot on every disposal.
 */
export class LotPool implements Pool {
  private lots: OpenLot[] = [];
  private seq = 0;

  constructor(
    readonly asset: AssetId,
    readonly method: 'FIFO' | 'LIFO' | 'HIFO',
  ) {}

  quantity(): Decimal {
    return this.lots.reduce((acc, l) => acc.plus(l.remaining), ZERO);
  }

  costBasis(): Decimal {
    return this.lots.reduce((acc, l) => acc.plus(l.remainingBasis), ZERO);
  }

  add(lot: Lot): void {
    if (lot.quantity.isZero()) return;
    const open: OpenLot = {
      lot,
      remaining: lot.quantity,
      remainingBasis: lot.costBasis,
      unitCost: lot.costBasis.dividedBy(lot.quantity),
      acquiredMs: parseInstant(lot.acquiredAt),
      seq: this.seq++,
    };
    // Upper bound: insert after every lot that is consumed no later than this one.
    let lo = 0;
    let hi = this.lots.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (this.compare(open, this.lots[mid]!) < 0) hi = mid;
      else lo = mid + 1;
    }
    this.lots.splice(lo, 0, open);
  }

  take(quantity: Decimal): { parts: ConsumedPart[]; shortfall: Decimal } {
    const parts: ConsumedPart[] = [];
    let needed = quantity;
    let consumed = 0;
    for (const open of this.lots) {
      if (needed.isZero()) break;
      const used = Decimal.min(needed, open.remaining);
      // Use the exact remaining basis on full consumption so no dust is left behind.
      const basis = used.equals(open.remaining)
        ? open.remainingBasis
        : open.remainingBasis.times(used).dividedBy(open.remaining);
      open.remaining = open.remaining.minus(used);
      open.remainingBasis = open.remainingBasis.minus(basis);
      needed = needed.minus(used);
      if (open.remaining.isZero()) consumed++;
      parts.push({
        lotId: open.lot.id,
        quantity: used,
        costBasis: basis,
        acquiredAt: open.lot.acquiredAt,
      });
    }
    // Only a prefix can be fully consumed, because lots are taken in order.
    if (consumed > 0) this.lots.splice(0, consumed);
    return { parts, shortfall: needed };
  }

  reset(): void {
    this.lots = [];
  }

  /** Negative when `a` is consumed before `b`. Ties fall back to insertion order. */
  private compare(a: OpenLot, b: OpenLot): number {
    const byAcquired = a.acquiredMs - b.acquiredMs || a.seq - b.seq;
    switch (this.method) {
      case 'FIFO':
        return byAcquired;
      case 'LIFO':
        return -byAcquired;
      case 'HIFO':
        return b.unitCost.comparedTo(a.unitCost) || byAcquired;
    }
  }
}

/** 移動平均法: the average unit cost is recomputed on every acquisition. */
export class MovingAveragePool implements Pool {
  readonly method = 'MOVING_AVERAGE';
  private qty: Decimal = ZERO;
  private cost: Decimal = ZERO;

  constructor(readonly asset: AssetId) {}

  quantity(): Decimal {
    return this.qty;
  }

  costBasis(): Decimal {
    return this.cost;
  }

  add(lot: Lot): void {
    this.qty = this.qty.plus(lot.quantity);
    this.cost = this.cost.plus(lot.costBasis);
  }

  take(quantity: Decimal): { parts: ConsumedPart[]; shortfall: Decimal } {
    const used = Decimal.min(quantity, this.qty);
    const shortfall = quantity.minus(used);
    if (used.isZero()) return { parts: [], shortfall };
    const basis = used.equals(this.qty) ? this.cost : this.cost.times(used).dividedBy(this.qty);
    this.qty = this.qty.minus(used);
    this.cost = this.cost.minus(basis);
    return {
      parts: [{ lotId: null, quantity: used, costBasis: basis, acquiredAt: null }],
      shortfall,
    };
  }

  reset(): void {
    this.qty = ZERO;
    this.cost = ZERO;
  }
}

/**
 * 総平均法: one average unit cost per calendar year,
 *   (opening cost + cost of the year's acquisitions) / (opening units + units acquired).
 * Every disposal in the year uses that average, so the engine must announce the year's
 * acquisitions up front via `beginYear`. Closing cost = closing units × average.
 */
export class TotalAveragePool implements Pool {
  readonly method = 'TOTAL_AVERAGE';
  private qty: Decimal = ZERO;
  private cost: Decimal = ZERO;
  private average: Decimal = ZERO;
  private expectedAcquired: Decimal = ZERO;
  private added: Decimal = ZERO;

  constructor(readonly asset: AssetId) {}

  beginYear(acquiredQuantity: Decimal, acquiredCost: Decimal): void {
    const totalQty = this.qty.plus(acquiredQuantity);
    const totalCost = this.cost.plus(acquiredCost);
    this.average = totalQty.isZero() ? ZERO : totalCost.dividedBy(totalQty);
    this.expectedAcquired = acquiredQuantity;
    this.added = ZERO;
  }

  endYear(): void {
    if (!this.added.equals(this.expectedAcquired)) {
      throw new Error(
        `TotalAveragePool(${this.asset}): acquisitions applied (${this.added.toString()}) differ from those announced (${this.expectedAcquired.toString()})`,
      );
    }
    this.cost = this.qty.times(this.average);
  }

  quantity(): Decimal {
    return this.qty;
  }

  /** Mid-year this is provisional; it is exact after `endYear`. */
  costBasis(): Decimal {
    return this.qty.times(this.average);
  }

  add(lot: Lot): void {
    this.qty = this.qty.plus(lot.quantity);
    this.added = this.added.plus(lot.quantity);
  }

  take(quantity: Decimal): { parts: ConsumedPart[]; shortfall: Decimal } {
    const used = Decimal.min(quantity, this.qty);
    const shortfall = quantity.minus(used);
    if (used.isZero()) return { parts: [], shortfall };
    this.qty = this.qty.minus(used);
    return {
      parts: [
        { lotId: null, quantity: used, costBasis: used.times(this.average), acquiredAt: null },
      ],
      shortfall,
    };
  }

  reset(): void {
    this.qty = ZERO;
    this.cost = ZERO;
  }
}

export function createPool(asset: AssetId, method: CostBasisMethod): Pool {
  switch (method) {
    case 'FIFO':
    case 'LIFO':
    case 'HIFO':
      return new LotPool(asset, method);
    case 'MOVING_AVERAGE':
      return new MovingAveragePool(asset);
    case 'TOTAL_AVERAGE':
      return new TotalAveragePool(asset);
  }
}
