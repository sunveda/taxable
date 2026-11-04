# ADR-0013: Launch jurisdiction — United States first

- **Status:** Accepted (confirmed by project owner, 2026-10-12); amended by [ADR-0015](./0015-japan-second-jurisdiction.md) (Japan launches alongside)
- **Date:** 2026-10-12

## Context
- An MVP can only be deep in one jurisdiction. The engine is designed for many (ADR-0007), but the first rule pack, importers, forms, and pricing must target one market.
- The target market also decides the importer list, payment and currency setup, and legal/entity work.

| Option | For | Against |
|---|---|---|
| **US** | Largest paying market. 1099-DA creates **new, urgent reconciliation pain in 2026–2028** (proceeds from TY2025, basis from TY2026, noncovered transfers). Per-wallet basis rules (2025) break many users' existing setups. Strong B2B demand from brokers. | Most crowded B2C market (Koinly, CoinTracker, CoinLedger, ZenLedger, TokenTax, Awaken). Requires US entity/E&O. |
| **India** | Large user base; complex rules (30%, no loss set-off, TDS reconciliation); local pricing works (KoinX). Exchanges partner (CoinDCX–KoinX). | Lower willingness to pay; KoinX entrenched; regulatory uncertainty. |
| **EU (DE first)** | DAC8 makes every EU exchange a buyer from 2026. Germany's holding-period rule rewards year-round tools. | Fragmented by country; Blockpit strong in DACH. |
| **UK** | Clear HMRC guidance; CARF via HMRC; English-language. | Smaller market; Koinly strong. |

## Decision
- Launch B2C web in the **US** for tax year 2026 filing (season Jan–Apr 2027).
- Lead with **1099-DA reconciliation + explainability**: that's where incumbents' accuracy problems become most visible, because users now have a broker form to compare against.
- Build the **UK, DE, and IN** rule packs in parallel as engine acceptance tests (ADR-0007). Promote one to production in Phase 2 based on B2B partner demand. A DAC8 partner would favour DE; an Indian exchange partner would favour IN.

## Consequences
- The MVP importer list targets US-available exchanges.
- The first production rule packs are `us/2025` and `us/2026` (per-wallet basis, Rev. Proc. 2024-28 safe harbor, 1099-DA reconciliation).
- The first public outputs are Form 8949 and Schedule D, plus TurboTax/TaxAct exports.
- A US entity, E&O insurance, and a US tax-professional reviewer are prerequisites for public launch.
- Adding another market later swaps in a rule pack and importer list; the architecture is unchanged (ADR-0007).
