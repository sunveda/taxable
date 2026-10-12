import type { Issue } from './types';

/** Fix queue order: largest absolute impact first, then oldest year, then id. */
export function sortIssues(issues: readonly Issue[]): Issue[] {
  const weight = (i: Issue) => {
    const a = i.impact.min.abs();
    const b = i.impact.max.abs();
    return a.greaterThan(b) ? a : b;
  };
  return [...issues].sort(
    (x, y) =>
      weight(y).comparedTo(weight(x)) ||
      x.taxYear - y.taxYear ||
      (x.id < y.id ? -1 : x.id > y.id ? 1 : 0),
  );
}
