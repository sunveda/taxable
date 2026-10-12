# Gap Analysis — Where We Can Win

_Research date: 2026-10-12. Builds on [competitive-landscape.md](./competitive-landscape.md)
and [regulatory-landscape.md](./regulatory-landscape.md)._

## The core problem nobody has solved

Every B2C tool produces **a number the user can't verify**. Reviews of every major
product repeat the same complaints:

- mislabelled transactions;
- missing cost basis that has to be fixed by hand;
- internal transfers or bridges counted as sales, which inflates gains;
- the same staking reward classified differently across tools;
- hundreds of warnings with no indication of which ones matter.

Users either pay a CPA to redo the work or file a number they don't trust.
At the same time, **exchanges are being forced to report** (1099-DA, DAC8, CARF) and to
give their users something better than a confusing form.

## Gaps, ranked by opportunity

Scoring: **Pain** = how much users/buyers suffer today; **Open** = how poorly incumbents
address it; **Fit** = how naturally it fits a single engine serving both B2C and B2B.
Scale 1–5.

| # | Gap | Pain | Open | Fit | Notes |
|---|---|---|---|---|---|
| G1 | **Explainability**: "why is my gain $X?" | 5 | 5 | 5 | No incumbent shows a lot-level provenance graph from raw import → lot → disposal → form line. |
| G2 | **Fix-what-matters**: issues ranked by tax impact | 5 | 4 | 5 | Tools list warnings flatly. Few rank by dollar impact or offer a confident default. |
| G3 | **1099-DA reconciliation** | 5 (US, 2026–2028) | 4 | 5 | Brand new pain. Noncovered transfers mean blank or wrong basis on broker forms. Users need line-by-line matching and 8949 adjustment codes. |
| G4 | **Basis portability between platforms** ("Basis Passport") | 4 | 5 | 5 | Exchanges can't see the basis of transferred-in assets. A user-consented, signed basis statement lets the receiving exchange report basis voluntarily. Nobody offers this as a network. |
| G5 | **Fair pricing**: not per-transaction | 4 | 4 | 3 | Tx-count tiers punish DeFi users and charge for spam. Price per tax year by complexity class, with spam and dust excluded. |
| G6 | **Year-round, pre-trade tax impact** | 3 | 4 | 5 | Tools are used once a year. "If I sell now, what do I owe?" belongs inside the exchange's sell flow, which is a B2B embed opportunity. |
| G7 | **Data ownership and continuity** | 3 | 5 | 4 | The Taxbit and Accointing shutdowns stranded users. Offer an open, documented export of the full normalized ledger plus lots. |
| G8 | **Mid-market exchange compliance** | 4 | 3 | 4 | Taxbit and CoinTracker serve Tier-1 exchanges with enterprise sales. Regional and mid-size exchanges need self-serve API onboarding, transparent pricing, and DAC8/CARF + 1099-DA in one box. |
| G9 | **Deep locality without a single-country product** | 4 | 3 | 4 | Global tools are broad but shallow; deep tools are single-country (KoinX, Blockpit). Versioned, test-backed rule packs can give both. |
| G10 | **Mobile-first simplicity** | 3 | 4 | 3 | Mobile apps today are portfolio trackers. A "your tax position today" app with push alerts (harvesting window, holding-period unlock, missing basis) is open. |

## Positioning statement

> **The crypto tax engine you can actually check.**
> Every number is traceable back to the transaction that caused it. You fix only what
> changes your tax bill. The same engine runs inside your exchange, so your basis
> follows you wherever your crypto goes.

## Strategy: one engine, two front doors

```
                 ┌───────────────────────────────────────────┐
                 │  Deterministic, explainable TAX ENGINE     │
                 │  (lots per wallet, rule packs, provenance) │
                 └───────────────┬───────────────┬───────────┘
                                 │               │
             B2C front door      │               │     B2B front door
   ┌─────────────────────────────▼──┐        ┌───▼─────────────────────────────┐
   │ Web app (now), iOS/Android     │        │ Tax API, Embedded Tax Center,    │
   │ (later): import, fix queue,    │◄──────►│ pre-trade preview, 1099-DA,      │
   │ explain, file                  │ Basis  │ DAC8/CARF reporting              │
   └────────────────────────────────┘Passport└──────────────────────────────────┘
```

- **B2C builds data and trust.** Users with complete history are the source of portable basis.
- **B2B builds distribution and revenue.** Every exchange integration is a channel to its users, and it consumes basis that users bring with them.
- **The Basis Passport (G4) connects the two.** It's the network effect incumbents lack: CoinTracker has the Coinbase embed but no cross-exchange basis network, and Taxbit has no consumer side at all.

## What we deliberately won't compete on (initially)

- **The longest integration list.** We cover the top exchanges and chains by user count, plus a robust generic CSV and EVM parser. We grow from there by measured demand.
- **Done-for-you CPA services.** We partner rather than build; an accountant view comes later.
- **Corporate crypto accounting / subledger (GAAP, IFRS).** That's a different buyer.

## Risks

| Risk | Mitigation |
|---|---|
| Tax-rule errors cause user harm or liability | Rule packs cite their legal source, are reviewed by a tax professional, carry golden-file tests, and are versioned so reports are reproducible ([ADR-0007](../adr/0007-jurisdiction-rule-packs.md)) |
| Basis Passport accepted by no exchange | Ship it as a downloadable signed statement first; it's useful to CPAs on its own. Treat exchange acceptance as upside. |
| Incumbents copy explainability | Provenance is architectural ([ADR-0012](../adr/0012-explainability-and-provenance.md)) and hard to retrofit onto engines that mutate state in place |
| Security incident (API keys, PII) | Read-only access only, envelope encryption, no custody, SOC 2 path ([ADR-0014](../adr/0014-read-only-access-no-custody.md)) |
| Regulatory timelines move (they have before) | Rule packs are data; filing modules are separate products |
