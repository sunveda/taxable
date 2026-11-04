# ADR-0009: Layered ledger — raw (immutable) → normalized → derived

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
Parsers improve and protocols get decoded better over time. Users override
classifications. Incumbents that mutate imported data in place lose the ability to
explain or fix past results.

## Decision
We keep four layers:

1. **Raw layer:** immutable, content-addressed blobs of every file or API page imported, with source metadata.
2. **Normalized layer:** canonical `LedgerEvent`s produced by importers. Regenerable from raw with a newer importer version; each event records the importer version.
3. **Override layer:** user/accountant decisions (classification, transfer match, basis entry, safe-harbor allocation). Append-only with author and timestamp; the latest active override wins; history is kept.
4. **Derived layer:** lots, disposals, buckets, issues, reports. **Always recomputable** from layers 1–3 plus the price snapshot and versions (ADR-0006). Cached, never authoritative.

Overrides key on stable event ids, so they survive re-normalization. If an override's
target disappears after a parser change, the override becomes an issue; it is not silently dropped.

## Consequences
- Full audit trail and provenance (ADR-0012).
- Parsers can be fixed and data re-normalized safely.
- More storage. Raw blobs go to object storage; normalized and derived data live in Postgres.
- Deleting a user's account must purge all four layers (security spec).
