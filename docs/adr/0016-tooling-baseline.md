# ADR-0016: Tooling baseline for the monorepo

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
ADR-0002, ADR-0003 and ADR-0008 left some concrete choices to the first code PR: the
decimal library, the test runner, and how workspace packages are consumed.

## Decision
| Concern | Choice | Notes |
|---|---|---|
| Package manager | **pnpm 10** workspaces | `packageManager` pinned in root `package.json` |
| Task runner | **Turborepo 2** | `build`, `typecheck`, `test` with dependency-aware caching |
| Language | **TypeScript 6**, strict, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` | One shared base in `packages/config` |
| Internal packages | **Source-first**: `exports` point at `src/*.ts`; no build step | Next.js uses `transpilePackages`; Metro (Expo) and Vitest consume TS directly. Add a build step only when a package is published (e.g. a B2B SDK). |
| Decimal | **decimal.js**, 60 significant digits, wrapped in `@svdt/domain` | Pure JS; runs on Hermes. Inputs accept strings, never `number` (ADR-0008). |
| Tests | **Vitest** + **fast-check** for property tests | Golden scenarios per rule pack; conservation and determinism properties |
| Lint | **ESLint 10** flat config + typescript-eslint | Shared packages ban Node built-ins, DOM globals, `Date.now`, `new Date()`, `Math.random`, `parseFloat` (ADR-0005, ADR-0006, ADR-0008) |
| Format | **Prettier** | Checked in CI |
| CI | GitHub Actions: format → lint → typecheck → test → build | `.github/workflows/ci.yml` |
| Node | **22 LTS** (`.nvmrc`) | |

**Time zones.** `@svdt/domain` derives local calendar dates through `Intl.DateTimeFormat`
(with `timeZone`). This keeps the engine free of a tz database dependency. The IANA data
comes from the runtime's ICU build. Hermes supports `Intl.DateTimeFormat` time zones; we
verify this when the mobile app starts (ADR-0005).

## Consequences
- No build artifacts to keep in sync during early development; the edit-test loop is fast.
- Publishing a package later (B2B SDK) needs a build step for that package only.
- Runtimes with outdated ICU data could assign a boundary event to the wrong year. Accepted, and to be monitored: tax-year boundaries are rarely affected by tz database changes.
