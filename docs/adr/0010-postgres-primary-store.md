# ADR-0010: PostgreSQL as the primary store; object storage for raw blobs

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
We need relational integrity (tenants, users, accounts, events, overrides), exact
decimals, row-level tenant isolation, and a job queue, with minimal moving parts at the
start.

## Decision
- **PostgreSQL** is the system of record: `NUMERIC` for amounts, **row-level security** for tenant isolation, JSONB for source-specific payload extras.
- **S3-compatible object storage** holds raw import blobs (ADR-0009) and generated report files.
- The **job queue** starts as a Postgres-backed queue (e.g. pg-boss or graphile-worker). It moves to a dedicated broker only when measured load requires it.
- **ORM/query layer:** a type-safe query builder (Drizzle or Kysely). The choice is made in the first API PR. _Chosen 2026-10-12: Drizzle (see Implementation notes)._
- **Migrations:** versioned, in-repo, run in CI against a disposable database.

## Consequences
- One database to operate and back up. Simple local development (Docker Compose).
- Very large B2B tenants may later need partitioning by tenant and year. The schema is designed with `tenant_id` and `tax_year` as leading keys from the start.

## Implementation notes (2026-10-12, first API PR)
- **Query layer: Drizzle.** It has first-class drivers for both node-postgres and PGlite. Migrations are hand-written SQL in `packages/db/migrations/` because roles, RLS policies and `SECURITY DEFINER` functions are clearer as SQL. `packages/db/src/schema.ts` is a typed mirror, and the tests exercise every table.
- **Isolation:** each request runs in a transaction that sets `svdt.tenant_id` and switches to the least-privilege `svdt_app` role, so RLS applies to every query. Raw files and overrides are append-only for that role. API-key lookup and user deletion go through narrow `SECURITY DEFINER` functions.
- **Local and CI:** [PGlite](https://pglite.dev) (Postgres compiled to WebAssembly) replaces Docker Compose. Tests run against real Postgres semantics, RLS included, with nothing to install.
- **Hosting:** any Postgres 15+ via `DATABASE_URL`. On Vercel, Neon from the Vercel Marketplace fits (Vercel's own Postgres product moved to Neon).
- **Raw blobs** are in a `raw_blobs` table for now. They move to object storage (e.g. Vercel Blob or S3) behind the same content hash.
- **Amounts:** events keep their decimal strings inside a JSONB payload (exact, per ADR-0008) rather than in per-kind `NUMERIC` columns. `NUMERIC` is for scalar amount columns when they appear.
