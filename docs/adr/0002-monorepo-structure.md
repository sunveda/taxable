# ADR-0002: Monorepo with room for web, iOS, and Android

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
We are building the web app first, but the iOS and Android apps must follow without a
rewrite. The tax engine must produce identical results on every surface (web, mobile,
B2B API). Separate repositories would drift: two copies of domain types, two engine
versions.

## Decision
We use a single **pnpm workspaces + Turborepo** monorepo:

```
apps/
  web/            # Next.js consumer web app (MVP)
  api/            # Public + internal HTTP API (B2C backend and B2B Tax API)
  worker/         # Import/sync/calculation jobs
  mobile/         # (later) Expo / React Native app → iOS + Android
  docs-site/      # (optional, later) public API docs
packages/
  tax-engine/     # Pure, deterministic engine (ADR-0006)
  rule-packs/     # Jurisdiction rule data + tests (ADR-0007)
  domain/         # Shared types: LedgerEvent, Lot, Money, Issue ...
  importers/      # Exchange/CSV/chain normalizers
  api-client/     # Typed client generated from OpenAPI, used by web + mobile + partners
  ui/             # Shared design tokens + cross-platform primitives
  config/         # Shared tsconfig, eslint, prettier
docs/
  research/ spec/ adr/
```

- Placeholder folders are created only when the first code lands. Until then this ADR is the plan.
- `apps/mobile` is reserved now so nothing claims the name.
- **Dependency rule:** `apps/*` may depend on `packages/*`; `packages/*` never depend on `apps/*`. `tax-engine` depends only on `domain` and `rule-packs`, never on I/O, the DOM, or React Native APIs.

## Consequences
- One PR can change the engine and every consumer together, with CI running everything affected.
- Mobile reuses the engine, domain, API client, and design tokens on day one.
- The engine has to stay platform-neutral (no Node-only APIs), which a lint rule enforces.
- Monorepo tooling needs care: build caching, and Expo's Metro bundler needs workspace configuration.

## Alternatives considered
- **Polyrepo** (web, mobile, engine separate): version drift and painful cross-repo changes.
- **Nx:** capable, but heavier. Turborepo is enough for our size; revisit if needed.
- **Native Swift/Kotlin apps in the same repo:** see ADR-0005.
