# Gap Review — October 2026

_Reviewed: 2026-10-12, against `main`…`claude/zealous-curie-y3la4c` at f04fea9 (engine 0.1.0, importers 0.1.0)._

This review re-checks the ten gaps in [gap-analysis.md](./gap-analysis.md) two ways:
1. **Market:** is each gap still open, given what competitors have shipped?
2. **Us:** how far do our docs and code close it?

It also lists inconsistencies found between docs and code.

## 1. Market changes since the first analysis

| Change | Effect |
|---|---|
| **1099-DA reconciliation is shipping at incumbents.** CoinTracker reportedly flags mismatches down to the transaction and has a 1099-DA portal. Koinly flags mismatches between forms and records. CoinLedger's status is disputed: "basic, summary-level" vs "coming soon". | G3 is no longer white space. It's **table stakes for US tax season 2027**. We need it to compete, and must win on depth (8949 adjustment codes, per-wallet basis, supplying basis for noncovered lots) rather than presence. |
| **"Audit trail" claims are spreading.** Taxbit (enterprise) is described as lot-level and audit-ready. CoinLedger is described as having a "transaction-level audit trail". | G1 is narrowing in wording. No one we found shows a drill-down from a figure to the **rule and its legal citation**, or an impact-ranked fix queue. G1 stays open, but must be shown, not claimed. |
| **Japanese local competitors are entrenched and cheap.** Cryptact (from ¥6,000/yr, 50 free tx), Gtax (from ¥5,500/yr for 300 tx; 70+ exchanges), CryptoLinC (from ¥3,960/yr). All price by transaction count. | Japan B2C on price alone is unattractive. Our Japan differentiators should be: explainability; **readiness for 2028 separate taxation** (splitting specified vs non-specified crypto assets, 3-year loss carryforward); and B2B with Japanese exchanges. |
| **DAC8/CARF timelines confirmed.** National tax authorities (e.g. Slovenia, Estonia) confirm registration and due diligence from 2026-01-01 and the first reports on 2026 data in 2027. The UK's first CARF window is 1 Jan–31 May 2027. DAC8 requires blocking users who don't self-certify (60 days after a second reminder). | G8 still open: no white-label vendor for mid-size exchanges surfaced in search. The demand date is fixed. |

## 2. Gap-by-gap status

Legend: ✅ done · 🟡 partial · ⏳ not started. "Open" is the market score (1–5) from the original analysis, revised.

| # | Gap | Market still open? | Our status | What exists | What's missing |
|---|---|---|---|---|---|
| G1 | Explainability | **Yes** (4, was 5) | 🟡 | Engine emits provenance: disposal → lot → event, parent/child lots across transfers, `ruleRefs` with legal citations (ADR-0012). Demo page has a "why this basis" column. | `explain` API and DAG view; plain-language explanation templates (i18n, EN/JA); provenance for prices used (the valuation source is computed but not exposed on records). |
| G2 | Fix what matters (impact-ranked) | **Yes** (4) | 🟡 | Fix queue sorted by impact: negative balance, missing basis, unmatched withdrawal, invalid method, opening-position problems. Missing prices are estimated for ranking, and unknown impacts are never buried (D1 fixed). Suggested resolutions and an override layer (D2 fixed, engine 0.2.0). | Persisting overrides (needs `apps/api`); more suggestion types; impact estimates for opening-position mismatches. |
| G3 | 1099-DA reconciliation | **Narrowing** (2, was 4) | ⏳ | Spec (tax-engine-spec §9); Form 8949 lines exist. | 1099-DA import (CSV/PDF); line matching; G–L box and adjustment codes; basis supply for noncovered lots. **Deadline: US filing season Jan–Apr 2027.** |
| G4 | Basis Passport | **Yes** (5) | ⏳ | Lots with full provenance (the data the passport would sign). | Signed statement format, signing keys, verification API, legal review. |
| G5 | Fair pricing (not per tx) | **Yes** (4); Japan locals also price per tx | ⏳ | Hypothesis in product spec. | Spam/dust detection (pricing depends on excluding it); billing; Japan-specific pricing given ¥4–6k local price points. |
| G6 | Pre-trade tax preview | **Yes** (4) | 🟡 | The pure engine can compute "what if I sell X now" by appending a hypothetical event. | API endpoint, performance (incremental recompute), embeddable widget. |
| G7 | Data ownership | **Yes** (5) | 🟡 | Canonical CSV spec + **import** (verified). | Ledger **export** in the canonical format (spec says it's the export format; not implemented). |
| G8 | Mid-market exchange compliance | **Yes** (3) | ⏳ | B2B spec; multi-tenant ADR. | `apps/api`, tenancy, DAC8/CARF data collection and XML, 1099-DA generation. |
| G9 | Deep locality | **Yes** (3) | 🟡 | US + Japan rule packs with citations (draft); JST/US time zones; Japanese importers. | Professional review of both packs; **Japan 2028 separate taxation** (needs venue tagging: registered JP exchange vs DEX/overseas); UK/DE/IN acceptance packs. |
| G10 | Mobile-first | **Yes** (4) | ⏳ | `apps/mobile` reserved; shared packages lint-guarded for Hermes. | Everything else; Hermes check for `Intl` time zones and Shift_JIS (ADR-0016, ADR-0017). |

## 3. Inconsistencies between docs and code

| # | Finding | Where | Suggested fix |
|---|---|---|---|
| D1 | ~~`missing_price` impact hard-coded to 0, contradicting "fix queue ordered by impact"~~ **Fixed 2026-10-12:** impact is estimated from the nearest quote (ranking only); with no quote, `impactKnown: false`, ranked between known non-zero and known-zero issues | `packages/tax-engine/src/effects.ts`, `issues.ts` | Regression tests in `packages/tax-engine/test/fix-queue.test.ts` |
| D2 | ~~`Issue.suggestedResolution` is in the spec but not the type~~ **Fixed 2026-10-12:** suggested resolutions for missing prices and unmatched withdrawals, plus the override layer (engine 0.2.0) | tax-engine-spec §8, §8.1 | Tests in `packages/tax-engine/test/overrides.test.ts` |
| D3 | The web demo computes inside a Next.js server component, but ADR-0011 says the web app is an API client | `apps/web/app/page.tsx` vs ADR-0011 | **In progress 2026-10-12:** `apps/api` + `packages/db` exist (imports, events, overrides, calculations, deletion; RLS). The web app (overview, import, transactions, fix queue with one-tap fixes, explainable report; JA/EN) is an API client; without `SVDT_API_URL` it uses an in-memory placeholder backend. Session auth is next. |
| D4 | Competitive landscape lacks Japanese competitors | `competitive-landscape.md` | Added in this review (§2 of that doc). |
| D5 | Gap analysis still scores G3 as wide open | `gap-analysis.md` | Revised there, with a pointer to this review. |
| D6 | Product spec MVP lists exchange API import, wallet address import, spam detection, open ledger export, 1099-DA reconciliation, all ⏳ | product-spec §5 | Not wrong (it's the MVP plan), but the implementation status lives only in tax-engine-spec §13 and data-ingestion-spec §7. Use one status table. |
| D7 | All rule packs `draft`; four of five importers `unverified` | rule-packs, importers | Blocked on people and data: tax-professional review and real exports. |
| D8 | Valuation provenance is computed (`Valuation.via`) but dropped before output | `valuation.ts` → `effects.ts` | Carry the valuation source onto disposals and income for G1. |

## 4. Recommended order (next 3 months)

US tax season starts in January 2027. Japan's filing season is mid-February to mid-March 2027.

1. **Unblock data:** get anonymized real exports (Coinbase, Kraken, bitFlyer, Coincheck) and mark the importers verified. Without this, nothing reaches users.
2. ~~**Fix queue quality (G2, D1, D2):** missing-price impact, suggested resolutions, override layer.~~ Done in the engine 2026-10-12; overrides still need storage (item 3).
3. **`apps/api` + persistence (D3, ADR-0009/0010/0011):** first slice done 2026-10-12 (partner API with keys, Postgres + RLS). Next: session auth for our own apps, object storage for raw files, hosted database.
4. **1099-DA reconciliation (G3)**, built deep: line-level matching, 8949 boxes and codes, basis supply. It's parity, but parity we must have by January.
5. **Explain API + UI (G1, D8):** the drill-down that shows rules and citations, in English and Japanese.
6. **Japan 2028 design (G9):** venue tagging in importers now, so 2026–2027 data is already split when the separate-taxation pack lands.
7. **Ledger export (G7):** small, and builds trust.

## Sources
- [Coin Bureau: Best crypto tax software 2026](https://coinbureau.com/services/crypto-tax-software)
- [Coin Bureau: CoinTracking vs Koinly vs CoinLedger 2026](https://coinbureau.com/analysis/cointracking-vs-koinly-vs-coinledger)
- [Quartz: Best crypto tax software 2026](https://qz.com/best-crypto-tax-software-compared)
- [BeInCrypto: 8 best crypto tax software 2026](https://beincrypto.com/learn/crypto-tax-software/)
- [Coselite: CPA review 2026](https://coselite.com/blog/best-crypto-tax-software-2026)
- [Webopedia: Koinly review 2026 (1099-DA)](https://www.webopedia.com/crypto/tools/koinly-review/)
- [Gitnux: Best crypto taxes software 2026](https://gitnux.org/best/crypto-taxes-software/) _(listicle)_
- [税理士ドットコム: 仮想通貨の税金計算ツール](https://www.zeiri4.com/c_1076/c_1081/h_466/)
- [Gtax](https://crypto-city.net/) _(vendor)_
- [CryptoLinC](https://cryptolinc.com/) _(vendor)_
- [ASPIC: 仮想通貨の税金計算ツール4選](https://www.aspicjapan.org/asu/article/23559)
- [Slovenia FURS: DAC8/CARF](https://www.fu.gov.si/en/supervision/areas_of_work/international_exchange/automatic_exchange_of_information_reported_by_crypto_asset_service_providers_dac8_and_carf?type=%5C)
- [Estonia EMTA: DAC8/CARF](https://emta.ee/en/business-client/taxes-and-payment/tax-returns-exchange-information/tax-information-exchange/crypto-asset-tax-reporting-dac8carf)
- [FinTelegram: DAC8/CARF 2026](https://fintelegram.com/dac8-carf-2026-crypto-tax-transparency-switch-is-on/)
