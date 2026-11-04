# ADR-0017: Importer architecture — CSV-first, structure-driven, gated by format verification

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
US and Japan users need their exchange history in the engine. Constraints:

- **Exchange formats are under-documented and change over time.** Coinbase's type labels have varied ("Advance"/"Advanced Trade"). bitFlyer has 13- and 15-column versions. Coincheck moved to an "industry standard format" (業界標準フォーマット).
- **A wrong parse is worse than no parse.** It silently produces a wrong tax figure.
- **We don't yet have real exports** to test against. While writing this, several official help pages were also unreachable from the build environment.
- **Japanese exports** are often Shift_JIS, use local time without an offset, and use Japanese labels.
- **Users hold coins on several exchanges.** A withdrawal from one exchange and a deposit into another must become a non-taxable transfer, or the engine reports missing basis and possible disposals.

## Decision
1. **CSV first.**
   - Exchange API sync and on-chain (address) import come later behind the same output type.
   - CSV is what every exchange offers, and needs no stored credentials (ADR-0014).
2. **Importers are pure functions** in `packages/importers`: `parse(table, { accountId }) → { events, warnings, stats }`.
   - No I/O.
   - Decoding bytes (UTF-8 or Shift_JIS via the runtime `TextDecoder`) happens at the edge.
   - The same ESLint guardrails as the engine apply.
3. **Importers emit the engine's typed events directly** (`trade`, `transfer`, `income`, `fee`, `external_deposit`, `external_withdrawal`).
   - For centralized-exchange CSVs the meaning is explicit in the row, so a separate classifier adds nothing yet.
   - The multi-leg + classifier model in tax-engine-spec §2 remains the design for on-chain data.
4. **Structure over labels.**
   - Where a format describes rows as increase/decrease/fee (Japan's 業界標準フォーマット, bitFlyer's signed quantities), the structure decides what happened.
   - Type labels are used only to tell income apart from plain deposits.
   - Rows that don't fit are reported with a line number. They are never guessed or silently dropped.
   - Explicit assumptions are reported as `assumption` warnings.
5. **Format provenance gate.**
   - Every importer declares `format.status` (`verified` | `unverified`) and its `sources`.
   - An importer built from public descriptions and synthetic fixtures is `unverified`. The product must not offer it to users as supported until it's tested against anonymized real exports. Those fixtures then live in the repo.
   - Only the canonical CSV is `verified` today, because we define it.
6. **Format detection** by header: the importer whose required columns all appear in one of the first 15 rows wins, and the most specific match takes priority. This handles preamble lines (e.g. Coinbase's account rows).
7. **Stable event ids**, so re-importing overlapping periods deduplicates:
   - from the source's own transaction id when there is one;
   - otherwise from a content hash of the row plus an occurrence counter.
8. **Timestamps get explicit offsets.**
   - UTC where documented (Coinbase, Kraken).
   - `+09:00` for Japanese exchanges. Japan has no DST, so a fixed offset is exact.
9. **Transfer matching** (`matchTransfers`) runs after all of a user's files are imported:
   - it pairs a withdrawal with a deposit of the same asset into another account, within 72 h, with at most a 2% shortfall;
   - the closest match in time wins;
   - the shortfall becomes the transfer's network fee;
   - deposits with a user-stated basis are left alone.
   - It's deterministic. Unmatched rows stay as external deposits/withdrawals, and the engine's fix queue surfaces them.
10. **The svdt canonical CSV** ([spec](../spec/canonical-csv.md)) is the universal fallback and the export format for data ownership.

## Consequences
- We can ship parsers now without pretending they're proven. The verification gate makes the remaining risk visible in code and in the UI.
- **Next steps:** collect anonymized real exports (Coinbase, Kraken, bitFlyer, Coincheck) for fixtures; then add Gemini, Robinhood, bitbank, GMO Coin, SBI VC Trade.
  - Coincheck staking rewards live in a separate 暗号資産報酬履歴 file, which needs its own importer.
- Transfer matching is heuristic. A confirmation UI (accept or split a match) and user overrides (ADR-0009, override layer) are needed before GA.
- Margin, futures, and Kraken rollover/settlement entries are reported as unsupported.
