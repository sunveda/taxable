import {
  dec,
  parseInstant,
  type Decimal,
  type ExternalDepositEvent,
  type ExternalWithdrawalEvent,
  type LedgerEvent,
  type TransferEvent,
} from '@svdt/domain';

export interface TransferMatch {
  withdrawalId: string;
  depositId: string;
  transferId: string;
}

export interface MatchOptions {
  /** How long after the withdrawal the deposit may arrive. Default 72 h. */
  windowHours?: number;
  /**
   * How far the deposit's timestamp may precede the withdrawal's. Exchanges stamp at
   * different moments (sender at completion, receiver at detection). Default 30 min.
   */
  clockSkewMinutes?: number;
  /** Largest share of the withdrawal that may be lost to network fees. Default 2%. */
  maxFeeRatio?: string;
}

interface Timed<E> {
  e: E;
  ms: number;
}

/**
 * Pairs a withdrawal from one of the user's accounts with a deposit into another, and
 * replaces the pair with a single `transfer` (not taxable; basis moves with the coins).
 * The shortfall between sent and received becomes the transfer's network fee.
 *
 * Deterministic and greedy: withdrawals in time order each take the closest eligible
 * deposit (by absolute time gap, then smallest shortfall, then id). Deposits with a
 * user-stated cost basis are left alone.
 *
 * Timestamps are parsed once, and deposits are indexed per asset and sorted by time, so
 * each withdrawal only scans deposits inside its window.
 */
export function matchTransfers(
  events: readonly LedgerEvent[],
  options: MatchOptions = {},
): { events: LedgerEvent[]; matches: TransferMatch[] } {
  const windowMs = (options.windowHours ?? 72) * 3_600_000;
  const skewMs = (options.clockSkewMinutes ?? 30) * 60_000;
  const maxFeeRatio = dec(options.maxFeeRatio ?? '0.02');
  const byTime = <E extends LedgerEvent>(a: Timed<E>, b: Timed<E>): number =>
    a.ms - b.ms || (a.e.id < b.e.id ? -1 : a.e.id > b.e.id ? 1 : 0);

  const withdrawals: Timed<ExternalWithdrawalEvent>[] = [];
  const depositsByAsset = new Map<string, Timed<ExternalDepositEvent>[]>();
  for (const e of events) {
    if (e.kind === 'external_withdrawal') {
      withdrawals.push({ e, ms: parseInstant(e.timestamp) });
    } else if (e.kind === 'external_deposit' && !e.costBasis) {
      const list = depositsByAsset.get(e.received.asset) ?? [];
      list.push({ e, ms: parseInstant(e.timestamp) });
      depositsByAsset.set(e.received.asset, list);
    }
  }
  withdrawals.sort(byTime);
  for (const list of depositsByAsset.values()) list.sort(byTime);

  const used = new Set<string>();
  const replaced = new Map<string, TransferEvent | null>();
  const matches: TransferMatch[] = [];

  for (const { e: w, ms: wMs } of withdrawals) {
    const deposits = depositsByAsset.get(w.sent.asset);
    if (!deposits) continue;
    const wQty = dec(w.sent.quantity);
    let best: { d: ExternalDepositEvent; gap: number; diff: Decimal } | null = null;
    for (let i = firstAtOrAfter(deposits, wMs - skewMs); i < deposits.length; i++) {
      const { e: d, ms: dMs } = deposits[i]!;
      if (dMs > wMs + windowMs) break;
      if (used.has(d.id) || d.accountId === w.accountId) continue;
      const dQty = dec(d.received.quantity);
      if (dQty.greaterThan(wQty) || wQty.minus(dQty).greaterThan(wQty.times(maxFeeRatio))) continue;
      const gap = Math.abs(dMs - wMs);
      const diff = wQty.minus(dQty);
      if (!best || gap < best.gap || (gap === best.gap && diff.lessThan(best.diff))) {
        best = { d, gap, diff };
      }
    }
    if (!best) continue;
    used.add(best.d.id);
    const fee = best.diff;
    const transfer: TransferEvent = {
      kind: 'transfer',
      id: `transfer:${w.id}>${best.d.id}`,
      timestamp: w.timestamp,
      fromAccountId: w.accountId,
      toAccountId: best.d.accountId,
      asset: w.sent.asset,
      quantity: best.d.received.quantity,
      ...(fee.isZero()
        ? {}
        : {
            fee: {
              asset: w.sent.asset,
              quantity: fee.toFixed(),
              ...(w.sent.value
                ? {
                    value: {
                      amount: dec(w.sent.value.amount).times(fee).dividedBy(wQty).toFixed(),
                      currency: w.sent.value.currency,
                    },
                  }
                : {}),
            },
          }),
      sourceRef: `matched ${w.id} + ${best.d.id}`,
    };
    replaced.set(w.id, transfer);
    replaced.set(best.d.id, null);
    matches.push({ withdrawalId: w.id, depositId: best.d.id, transferId: transfer.id });
  }

  const out: LedgerEvent[] = [];
  for (const e of events) {
    if (!replaced.has(e.id)) out.push(e);
    else {
      const t = replaced.get(e.id);
      if (t) out.push(t);
    }
  }
  return { events: out, matches };
}

/** Index of the first deposit with `ms >= target` (list sorted by ms). */
function firstAtOrAfter(list: readonly Timed<ExternalDepositEvent>[], target: number): number {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (list[mid]!.ms < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
