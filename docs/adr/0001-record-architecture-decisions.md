# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
This is a tax product. Decisions about rounding, lot selection, data retention, and
architecture have legal and financial consequences, and they need to be explainable
later to auditors, partners, and new engineers.

## Decision
- We record significant decisions as ADRs in `docs/adr/`, numbered sequentially, using [0000-template.md](./0000-template.md).
- An ADR is never edited after acceptance except to change its status. To change a decision, write a new ADR that supersedes it.
- Specs (`docs/spec/`) describe **what** we build. ADRs describe **why it's built this way**.

## Consequences
- Small overhead per decision.
- Decision history is reviewable in PRs alongside code.
