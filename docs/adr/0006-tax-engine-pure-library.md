# ADR-0006: Tax engine as a pure, deterministic library

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
Incumbents' main complaint is numbers users can't trust or reproduce. B2B partners will
file official forms based on our output and must be able to reproduce a figure months
later. The engine must run identically on server, browser, and mobile.

## Decision
`packages/tax-engine` is a **pure function library**:
- **No I/O.** No network, filesystem, database, clock, or randomness. Prices, the current date, and configuration are inputs.
- **Deterministic.** The same inputs (ledger, overrides, price snapshot, engine version, rule-pack version) produce byte-identical outputs.
- Outputs include **results + provenance + issues** (ADR-0012).
- **Stable ordering.** Every collection is sorted by an explicit key before processing, so equal timestamps tie-break deterministically.
- The engine is **versioned** with semver. Reports record the engine version that produced them, and older versions stay runnable for re-issuing past reports.

## Consequences
- Easy to test: golden files, property tests, fuzzing.
- Runs anywhere (ADR-0003, ADR-0005).
- Caching by content hash is safe.
- The orchestration layer (`apps/worker`) is responsible for gathering inputs: prices, ledger, overrides.
- Reproducing old reports requires storing price snapshots and keeping old engine versions installable.
