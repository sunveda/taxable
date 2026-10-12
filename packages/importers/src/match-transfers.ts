import {
  dec,
  parseInstant,
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
  /** Largest share of the withdrawal that may be lost to network fees. Default 2%. */
  maxFeeRatio?: string;
}

/**
 * Pairs a withdrawal from one of the user's accounts with a deposit into another, and
 * replaces the pair with a single `transfer` (not taxable; basis moves with the coins).
 * The shortfall between sent and received becomes the transfer's network fee.
 *
 * Deterministic and greedy: withdrawals in time order each take the closest eligible
 * deposit. Deposits with a user-stated cost basis are left alone.
 */
export function matchTransfers(
  events: readonly LedgerEvent[],
  options: MatchOptions = {},
): { events: LedgerEvent[]; matches: TransferMatch[] } {
  const windowMs = (options.windowHours ?? 72) * 3_600_000;
  const maxFeeRatio = dec(options.maxFeeRatio ?? '0.02');
  const byTime = (a: LedgerEvent, b: LedgerEvent): number =>
    parseInstant(a.timestamp) - parseInstant(b.timestamp) ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  const withdrawals = events
    .filter((e): e is ExternalWithdrawalEvent => e.kind === 'external_withdrawal')
    .sort(byTime);
  const deposits = events
    .filter((e): e is ExternalDepositEvent => e.kind === 'external_deposit' && !e.costBasis)
    .sort(byTime);
  const used = new Set<string>();
  const replaced = new Map<string, TransferEvent | null>();
  const matches: TransferMatch[] = [];

  for (const w of withdrawals) {
    const wMs = parseInstant(w.timestamp);
    const wQty = dec(w.sent.quantity);
    let best: { d: ExternalDepositEvent; gap: number; diff: string } | null = null;
    for (const d of deposits) {
      if (used.has(d.id) || d.accountId === w.accountId || d.received.asset !== w.sent.asset)
        continue;
      const gap = parseInstant(d.timestamp) - wMs;
      if (gap < 0 || gap > windowMs) continue;
      const dQty = dec(d.received.quantity);
      if (dQty.greaterThan(wQty) || wQty.minus(dQty).greaterThan(wQty.times(maxFeeRatio))) continue;
      const diff = wQty.minus(dQty).toFixed();
      if (!best || gap < best.gap || (gap === best.gap && dec(diff).lessThan(best.diff)))
        best = { d, gap, diff };
    }
    if (!best) continue;
    used.add(best.d.id);
    const fee = dec(best.diff);
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
