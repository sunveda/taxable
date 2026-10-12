# Handoff — svdt-cloud (repo `sunveda/taxable`)

_Written 2026-10-12 for continuing this work in a local Claude Code session._

## Where things are

- **Branch:** `claude/zealous-curie-y3la4c`. Draft PR: https://github.com/sunveda/taxable/pull/1, targeting `main`.
  - `main` holds only an empty initial commit; GitHub's default branch may still be the feature branch.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`), passing on the latest commit before this file.
- **Local checks:**
  ```sh
  corepack enable && pnpm install
  pnpm format:check && pnpm lint && pnpm typecheck && pnpm test && pnpm build
  ```
  Node 22, pnpm 10. All 134 tests passed at handoff.

## What exists

| Area                                                             | Location              | Notes                                                                                   |
| ---------------------------------------------------------------- | --------------------- | --------------------------------------------------------------------------------------- |
| Research, gap analysis, Oct-2026 gap review                      | `docs/research/`      | Gap review lists open gaps and priorities                                               |
| Specs (product, engine, ingestion, B2B, security, canonical CSV) | `docs/spec/`          | Engine spec §13 = implementation status                                                 |
| ADRs 0001–0017                                                   | `docs/adr/`           | US + Japan launch (0013, 0015); importers (0017)                                        |
| Architecture diagrams (Mermaid)                                  | `docs/architecture/`  | Built vs planned colour legend                                                          |
| Domain types, decimals, time zones                               | `packages/domain`     | No JS numbers for amounts                                                               |
| Rule packs `us` (2009–2026), `jp` (2014–2027)                    | `packages/rule-packs` | All rules `draft`, pending tax-professional review                                      |
| Tax engine                                                       | `packages/tax-engine` | Pure, deterministic; lots/averages, fix queue, US/JP summaries                          |
| CSV importers + transfer matching                                | `packages/importers`  | Canonical CSV verified; Coinbase, Kraken, Coincheck (業界標準), bitFlyer **unverified** |
| Web demo                                                         | `apps/web`            | Next.js page running the engine on sample data                                          |
| Mobile                                                           | `apps/mobile`         | Reserved for Expo                                                                       |

## History of this session (high level)

1. Research → docs → ADRs → monorepo → US/JP engine → importers → gap review → diagrams.
2. **Fix-queue ranking fix:** missing prices are estimated for ranking only; `impactKnown`; three-tier ordering.
3. **Code review round 1:** 10 findings fixed in commit `9dbea0c` (fee ordering, pre-pack history years, bitFlyer fees, Coinbase ids, rounding, LotPool performance, …).
4. **Code review round 2:** 10 findings fixed in commit `62e8790`:
   - same-instant ordering;
   - Kraken pending/staking rows;
   - lot rule citations;
   - matcher clock skew and speed;
   - bitFlyer JPY rate;
   - impossible dates;
   - binary-search price lookups.
5. **A third review round was requested, then stopped by the user before it ran.** Not done.

## Open items / next steps (priority order, from `docs/research/gap-review-2026-10.md`)

1. Get anonymized real exports (Coinbase, Kraken, bitFlyer, Coincheck), commit them as fixtures, and mark those importers `verified`.
2. Fix queue: suggested resolutions plus an override layer (ADR-0009).
3. `apps/api` + Postgres persistence (ADR-0010/0011). The web demo currently computes in a Next.js server component.
4. 1099-DA reconciliation (US season starts Jan 2027), including Form 8949 box G–L assignment.
5. Explain API/UI (provenance drill-down, EN/JA).
6. Japan 2028 separate taxation: tag venues (registered JP exchange vs DEX/overseas) in importers now.
7. Ledger export in canonical CSV.
8. Optional: run the third code review (`/code-review` on PR #1) that was cancelled.

## Things to know

- **Network policy:** the cloud environment blocked `faq.coincheck.com`, `support.kraken.com` and `cryptocurrency-association.org`. Exchange format details for those came from secondary sources; recheck them locally.
- **`AGENTS.md`** at the repo root is written by Turborepo when it detects an AI agent. It's committed. Set `"agentGuidance": false` in `turbo.json` to stop it.
- **Commit trailers used so far:** `Co-Authored-By: Claude …` and `Claude-Session: https://claude.ai/code/session_01S3pNbhYD8Adr21afec14ce`.
- **Regression-test convention:** each review fix has a test in `test/review-fixes*.test.ts`, checked to fail against the pre-fix code.
- **Not tax advice:** rule packs are drafts until reviewed by a US tax professional and a 税理士.
