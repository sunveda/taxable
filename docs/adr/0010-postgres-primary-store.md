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
- **ORM/query layer:** a type-safe query builder (Drizzle or Kysely). The choice is made in the first API PR.
- **Migrations:** versioned, in-repo, run in CI against a disposable database.

## Consequences
- One database to operate and back up. Simple local development (Docker Compose).
- Very large B2B tenants may later need partitioning by tenant and year. The schema is designed with `tenant_id` and `tax_year` as leading keys from the start.
