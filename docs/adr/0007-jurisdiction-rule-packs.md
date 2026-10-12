# ADR-0007: Jurisdiction logic as versioned rule packs

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
Global tools are broad but shallow; local tools are deep but single-country
([gap-analysis G9](../research/gap-analysis.md)). Tax rules change yearly and differ
structurally between countries:
- US: per-wallet lots;
- UK: share pooling with same-day and 30-day rules;
- DE: holding-period exemption;
- IN: flat rate with no loss set-off, plus TDS.

Hard-coding countries into the engine turns each new country into an engineering project
and raises the risk of regressions in other countries.

## Decision
- The engine core implements **mechanisms**: lot selection methods, pooling, holding-period computation, bucketing, thresholds, and loss rules. Each **jurisdiction is a rule pack** in `packages/rule-packs/<country>/<taxYear>`.
- A rule pack declares:
  - allowed and default cost-basis methods, and whether basis is per wallet or pooled;
  - the treatment of each classification (e.g. is `wrap` a disposal? is `income_staking` taxed at receipt?);
  - holding-period thresholds and the buckets they map to;
  - annual exemptions, allowances, flat rates, and loss set-off rules;
  - form/report mappings (e.g. US 8949 boxes, IN Schedule VDA).
- Every rule entry carries a `source` citation (statute, regulation, official guidance) and an `effectiveFrom` / `effectiveTo` date.
- Each pack ships with **golden scenario tests** reviewed by a qualified tax professional for that jurisdiction. A pack can't be marked `stable` without that review.
- Packs are versioned independently of the engine, and reports record the pack version.
- Where a mechanism can't be expressed as data, a pack may include a narrowly scoped **extension hook** (TypeScript). It goes through the same review.

## Consequences
- New jurisdictions are mostly data plus tests, so they can be outsourced to country experts.
- Citations make "explain this number" go all the way to the law.
- Designing the mechanism set is upfront work. The four reference jurisdictions (US, UK, DE, IN) are the acceptance test for the design, even if only one launches first.
