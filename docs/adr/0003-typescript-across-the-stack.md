# ADR-0003: TypeScript across the stack (engine included)

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
The engine must run:
- on the server (B2C recompute, B2B batch);
- in the browser (instant "what-if" previews);
- on mobile (offline tax position, pre-trade preview).

The team is small and needs one language for most work.

## Decision
- We write the web app, API, workers, importers, **and the tax engine** in **TypeScript** (strict mode).
- Runtime: Node.js LTS on the server.
- The engine is written so its hot paths can later be ported to **Rust compiled to WASM/native** behind the same interface, if benchmarks ([tax-engine-spec §11](../spec/tax-engine-spec.md)) are missed.

## Consequences
- Engine, domain types, and validation (zod schemas) are shared on every surface with no duplication.
- One hiring profile; fast iteration in the early phase.
- Numeric correctness needs discipline. See ADR-0008: no JS `number` for money or quantities.
- JS performance at B2B batch scale is the main risk. Mitigations: per-user parallelism, incremental recompute, and the Rust escape hatch.

## Alternatives considered
- **Rust core from day one:** best performance and correctness tools, but slower iteration, and WASM/RN bindings add build complexity before product-market fit.
- **Python backend:** strong data ecosystem, but the engine could not be shared with web or mobile.
- **Kotlin Multiplatform:** good for mobile sharing, weak for the web/Next.js side.
