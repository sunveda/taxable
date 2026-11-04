# Architecture Diagrams

Diagrams are written in [Mermaid](https://mermaid.js.org/) so they render on GitHub and
are reviewed in PRs like code. They describe the system as of engine 0.1.0 / importers 0.1.0
and the target design from the specs and ADRs.

| Document | What it shows |
|---|---|
| [System context & containers](./system-context.md) | Who uses the system, the deployable pieces (today and target), deployment |
| [Components](./components.md) | Monorepo packages and their dependencies; inside the tax engine, importers and rule packs |
| [Flows](./flows.md) | Import → match → calculate; the engine's year loop; valuation; fix queue; transfer matching; layered ledger; B2C journey; B2B API; Basis Passport; 1099-DA reconciliation |

## Legend

Every diagram uses the same convention for status:

```mermaid
flowchart LR
  built["Built (in the repo, tested)"]:::built
  partial["Partial / demo only"]:::partial
  planned["Planned (spec or ADR only)"]:::planned
  classDef built fill:#d8f5dd,stroke:#2e7d32,color:#1b3d1f
  classDef partial fill:#fff4d6,stroke:#b7791f,color:#4a3510
  classDef planned fill:#eef0f4,stroke:#8a93a3,color:#3b4250,stroke-dasharray: 5 4
```

Keep these diagrams in sync with the code: a PR that adds a package, changes a dependency
direction, or builds a planned component should update the matching diagram.
