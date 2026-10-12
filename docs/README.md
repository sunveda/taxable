# svdt-cloud Documentation

Docs come first: research → spec → ADRs → code.

## Research — why
- [Competitive landscape](./research/competitive-landscape.md): who does what, pricing, strengths and weaknesses
- [Regulatory landscape](./research/regulatory-landscape.md): 1099-DA, per-wallet basis, DAC8, CARF, reference jurisdictions
- [Gap analysis](./research/gap-analysis.md): ranked gaps, positioning, strategy, risks
- [Gap review — Oct 2026](./research/gap-review-2026-10.md): market and implementation status per gap, doc/code inconsistencies, next priorities
- [Sources](./research/sources.md)

## Spec — what
- [Product spec](./spec/product-spec.md): personas, journeys, phasing, pricing hypothesis, metrics
- [Tax engine spec](./spec/tax-engine-spec.md): pipeline, event model, lots, fix queue, 1099-DA reconciliation
- [Data ingestion spec](./spec/data-ingestion-spec.md): importers, transfer matching, Japan specifics, MVP sources
- [Canonical CSV](./spec/canonical-csv.md): our documented import/export format
- [B2B platform spec](./spec/b2b-platform-spec.md): Tax API, Embedded Tax Center, broker reporting, Basis Passport
- [Security & privacy spec](./spec/security-privacy-spec.md)

## Architecture — diagrams
- [Overview and legend](./architecture/README.md)
- [System context & containers](./architecture/system-context.md): users and external systems, today vs target containers, deployment
- [Components](./architecture/components.md): package dependencies, engine internals, pools, rule packs, importers
- [Flows](./architecture/flows.md): import → match → calculate, year loop, disposals, valuation, fix queue, transfer matching, and planned flows (ledger, consumer journey, Tax API, Basis Passport, 1099-DA)

## ADRs — how and why this way
- [ADR index](./adr/README.md)
