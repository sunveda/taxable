# Product Spec — svdt-cloud

_Status: Draft v0.1 · Owner: TBD · Last updated: 2026-10-12_

## 1. Summary

svdt-cloud is a crypto tax engine you can check. It computes capital gains and income from
crypto activity. It **explains every number** and **ranks the fixes that change your tax
bill**. The same engine serves:

- **Consumers:** web app now; iOS and Android later.
- **Platforms:** exchanges, brokers, wallets, and fintechs, via API and an embeddable tax center.

Research basis: [gap-analysis.md](../research/gap-analysis.md).

## 2. Goals and non-goals

### Goals
1. A consumer with typical activity (≤ 5 sources, < 2k tx) reaches a **filed-ready report in under 30 minutes** with confidence in the number.
2. Every reported figure links to its **provenance**: the source rows and the rule applied.
3. The fix queue is **ordered by absolute tax impact**, so the top 10 items resolve ≥ 90% of the dollar uncertainty.
4. **One engine, many surfaces:** identical results on web, mobile, and API for the same inputs and rule-pack version.
5. **B2B-ready from day one:** multi-tenant, API-first, white-label-able.

### Non-goals (v1)
- Filing taxes on the user's behalf (we export to filing software or forms).
- Corporate GAAP/IFRS crypto accounting.
- Custody, trading, or any write access to user funds.
- Supporting every exchange and chain. We cover the long tail with generic importers.

## 3. Personas

| Persona | Description | Primary need |
|---|---|---|
| **Casual Cass** (B2C) | 1–3 exchanges, some staking, < 500 tx | "Give me the form, make it right, make it cheap." |
| **DeFi Dev** (B2C) | Multiple wallets and chains, LPs, bridges, airdrops, 5k–50k tx | "Don't count my bridges as sales; let me check the hard ones." |
| **Accountant Ana** (B2B2C) | CPA with 20–200 crypto clients | Client workspaces, review mode, exportable audit trail |
| **Exchange Eric** (B2B) | Tax/compliance lead at a mid-size exchange | 1099-DA / DAC8 / CARF obligations, plus a user tax center to cut support tickets |
| **Platform PM Priya** (B2B) | Product manager at a wallet or fintech | Pre-trade tax preview and a tax-report widget for retention |

## 4. Core user journeys (B2C)

1. **Connect:** add an exchange (read-only API key or OAuth), a wallet address, or a CSV/1099-DA upload.
2. **Auto-process:** normalize → match transfers → classify → compute lots → compute gains/income per rule pack.
3. **Review — "Your tax position":** headline numbers (short- and long-term gains, income, estimated tax), each with a **confidence band**.
4. **Fix queue:** a ranked list of issues ("Missing basis for 1.2 ETH received 2024-03-02 — affects up to $3,410").
   - Each item has a one-tap suggested resolution and an explanation.
5. **Explain:** tap any number to drill down: form line → disposal → consumed lots → acquisition rows → raw import row.
6. **Reconcile 1099-DA (US):** upload or import the broker form; see matched, mismatched, and missing lines; generate 8949 adjustments.
7. **Export:** Form 8949 / Schedule D PDF, TurboTax/TaxAct files, CSV, accountant package, full ledger export (open format).
8. **Year-round** (later on web, core on mobile):
   - holding-period unlock alerts (e.g. DE 1-year rule, US long-term);
   - harvesting opportunities;
   - pre-sale tax preview.

## 5. Feature list and phasing

| Feature | MVP (web) | Phase 2 | Phase 3 |
|---|---|---|---|
| CSV import (generic + top exchanges) | ✅ | | |
| Exchange API import (top 5–8 by target market) | ✅ | expand | |
| Wallet address import: BTC, EVM (ETH + major L2s), Solana | ✅ | more chains | |
| Transfer matching (own wallets) | ✅ | | |
| Classification with confidence scores | ✅ | ML-assisted | |
| Per-wallet lot tracking, FIFO/HIFO/LIFO/spec-ID | ✅ | | |
| Rev. Proc. 2024-28 safe-harbor allocation (US) | ✅ | | |
| Fix queue ranked by tax impact | ✅ | | |
| Explain-this-number provenance drill-down | ✅ | | |
| 1099-DA import and reconciliation | ✅ | | |
| US Form 8949 / Schedule D, TurboTax export | ✅ | | |
| Spam/dust detection (excluded from pricing) | ✅ | | |
| Open ledger export (JSON/CSV + schema) | ✅ | | |
| Additional rule packs: UK, DE, IN | | ✅ | more |
| Accountant workspace | | ✅ | |
| Tax API (B2B) — calc + reports | | ✅ beta | GA |
| Basis Passport (signed basis statement) | | ✅ download | exchange acceptance |
| Pre-trade tax preview (API + widget) | | ✅ | |
| Embedded Tax Center (white-label) | | | ✅ |
| 1099-DA generation for brokers | | | ✅ |
| DAC8 / CARF reporting module | | | ✅ |
| iOS / Android apps | | | ✅ |

The detailed B2B surface is in [b2b-platform-spec.md](./b2b-platform-spec.md).

## 6. Pricing hypothesis (to validate)

The goal is to remove the main pricing complaint: **per-transaction tiers that charge for spam and punish DeFi users.**

- **Free:** full import, calculation, fix queue, and explanations. You see your exact number for free.
- **Paid, per tax year, by complexity class rather than tx count:**
  - _Standard_: CEX-only;
  - _Plus_: on-chain wallets, staking;
  - _Pro_: DeFi/LP/derivatives.
  - Spam and dust never count.
  - Unlocks form downloads, filing-software exports, and the Basis Passport.
- **Local currency pricing** per market (KoinX shows this matters in India).
- **B2B:** per active reporting user per year, with a self-serve tier for small exchanges and published pricing.

## 7. Success metrics

| Metric | Target (first tax season) |
|---|---|
| Time to first trusted report (median, Casual persona) | < 30 min |
| Share of users with zero high-impact open issues at export | > 80% |
| Support tickets per 1,000 paid users | < 25 |
| Report reproducibility (same input + rule version → same output) | 100% (CI-enforced) |
| B2B: design-partner exchanges signed | 2–3 |

## 8. Platforms

- **Web** (Next.js) is first. See [ADR-0004](../adr/0004-nextjs-for-web.md).
- **iOS/Android** later via React Native/Expo, sharing the engine, domain types, and API client. See [ADR-0002](../adr/0002-monorepo-structure.md) and [ADR-0005](../adr/0005-react-native-expo-for-mobile.md).
- Mobile focus differs from web: a year-round tax position, alerts, and quick fixes. Bulk import and review stay on web.

## 9. Open questions

1. ~~Launch jurisdiction~~ — decided: **US** ([ADR-0013](../adr/0013-launch-jurisdiction.md)).
2. Brand and product name. "svdt-cloud" is the project codename; the repo is `taxable`.
3. Tax-professional partner for rule-pack review (required before any public launch).
4. Exchange design partners for B2B beta.
5. Entity and liability structure (E&O insurance, terms of service disclaimers).

## 10. Related specs
- [tax-engine-spec.md](./tax-engine-spec.md)
- [data-ingestion-spec.md](./data-ingestion-spec.md)
- [b2b-platform-spec.md](./b2b-platform-spec.md)
- [security-privacy-spec.md](./security-privacy-spec.md)
