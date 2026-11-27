import type { Issue } from './types';

/**
 * Fix queue order:
 *   1. issues with a known, non-zero impact, largest first;
 *   2. issues whose impact is unknown (they could be large);
 *   3. issues known to have no impact.
 * Ties break by oldest tax year, then id, so the order is deterministic.
 */
export function sortIssues(issues: readonly Issue[]): Issue[] {
  const weight = (i: Issue) => {
    const a = i.impact.min.abs();
    const b = i.impact.max.abs();
    return a.greaterThan(b) ? a : b;
  };
  const tier = (i: Issue): number => (!i.impactKnown ? 1 : weight(i).isZero() ? 2 : 0);
  return [...issues].sort(
    (x, y) =>
      tier(x) - tier(y) ||
      weight(y).comparedTo(weight(x)) ||
      x.taxYear - y.taxYear ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
}
