# ADR-0011: API-first, multi-tenant from day one

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
We serve consumers (web, later mobile) and platforms (Tax API, embedded tax center).
Building B2C first as a single-tenant app and bolting on B2B later is how incumbents ended
up with separate products. It is expensive to undo.

## Decision
- **Every feature is exposed through `apps/api` first.** The web app, mobile apps, and partners are all API clients. No private backdoors for our own UI.
- The API is described by **OpenAPI 3.1**, generated from route schemas. `packages/api-client` is generated from it.
- **Multi-tenant model:**
  - `tenant` → `user` → `account` (wallet or exchange account) → events;
  - B2C users live in the built-in `direct` tenant;
  - linking a person across tenants (e.g. Basis Passport) requires explicit, recorded consent.
- **Two API surfaces from one codebase:**
  - **App API:** session auth, used by our clients; may move faster.
  - **Partner API:** API keys/OAuth client credentials, versioned (`/v1`), with a stability guarantee and deprecation policy.
- Tenant isolation is enforced twice: in the data-access layer (mandatory tenant context) and by Postgres RLS (ADR-0010).

## Consequences
- B2B launch is configuration plus partner-API hardening, not a rewrite.
- Mobile gets feature parity automatically.
- Slightly more upfront work per feature: schema, auth scopes, tenant checks.
