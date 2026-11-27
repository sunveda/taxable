# ADR-0012: Explainability — every number has provenance

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
Explainability is our primary differentiator ([gap-analysis G1, G2](../research/gap-analysis.md)).
Retrofitting it onto an engine that mutates state is very hard, which is why incumbents
don't offer it. It has to be in the engine's data model from the first commit.

## Decision
- Every derived value the engine emits (disposal, lot, bucket total, form line, issue) carries a **provenance record**:
  - input ids (events, lots, prices, overrides);
  - rule references (rule-pack id, version, rule id, legal citation);
  - the mechanism applied (e.g. `FIFO` consumed lots L1, L2).
- Provenance forms a **DAG** from form line → disposal → lots → acquisition events → raw source rows. The API exposes it via `explain` endpoints. The UI renders it as a drill-down, and as plain-language sentences through i18n templates.
- **Issue impact** is computed by re-running affected disposals under each plausible resolution. That range drives fix-queue ordering.
- Provenance is part of the deterministic output (ADR-0006) and is covered by golden tests.

## Consequences
- Users, accountants, and partners can verify any figure, which builds trust and reduces support load.
- Higher memory and storage use. Provenance is stored compactly (ids, not copies), and full DAG materialization happens on demand.
- Engine contributors must thread provenance through every new mechanism. Code review checks for it.
