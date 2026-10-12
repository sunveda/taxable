# Competitive Landscape — Crypto Tax Calculation

_Research date: 2026-10-12. Status: living document._

> **Caveat on sources.** Most published comparisons of crypto tax software are written
> by the vendors themselves (Koinly, CoinLedger, Awaken, KoinX all publish "best tool"
> rankings that rank themselves first). Pricing and feature claims below come from those
> pages and secondary roundups; verify against each vendor's live pricing page before
> using a number in a pitch or a pricing decision. See [sources.md](./sources.md).

## 1. Market segments

The market splits into three groups that rarely overlap:

| Segment | Who pays | Representative players | What they sell |
|---|---|---|---|
| **B2C self-serve** | Individual investors | Koinly, CoinTracker, CoinLedger, ZenLedger, TokenTax, Awaken, Summ, CoinTracking, Blockpit, KoinX | Import → classify → gains report → tax forms / TurboTax export |
| **B2B / enterprise compliance** | Exchanges, brokers, fintechs | Taxbit, CoinTracker (Broker Tax Compliance Suite), Blockpit/CryptoTax API, Moneyviz, Kryptos, Awaken Tax API | Cost basis engines, 1099-DA / DAC8 / CARF filing, embedded "tax centers" |
| **Professional / accountant** | CPAs, tax firms | TokenTax (full service), CoinTracker Full Service, Kryptos accountant tier, CoinTracking multi-client | Multi-client dashboards, white-label PDFs, done-for-you filing |

Notable consolidation and exits:

- **Taxbit** shut down its consumer product on **2023-10-31** to focus on enterprise and public sector.
- **Accointing** was bought by Glassnode, then sold to **Blockpit** in Nov 2023; the platform closed at the end of Jan 2024.
- **CoinTracker** signed **Coinbase** as the anchor customer for its broker compliance suite (1099-DA filing plus an embedded consumer tax center).

**Takeaway:** most consumer tools are moving toward B2B, because the 2025–2027 regulatory changes (1099-DA, DAC8, CARF) turn exchanges into required buyers. Each exit also left users scrambling to move their history somewhere else.

## 2. Player-by-player snapshot

| Product | Focus | Entry price (reported) | Strengths (reported) | Weaknesses (reported) |
|---|---|---|---|---|
| **Koinly** | B2C, global | ~$49 / 100 tx; free tier with tracking but no report download | 100+ countries, broad DeFi coverage, beginner-friendly | Mislabelled transactions, manual cost-basis fixes, weak on-chain fee handling; no built-in India TDS reconciliation; USD-only pricing |
| **CoinTracker** | B2C + B2B (Coinbase) | $59 / 100 tx → $199 / 1k → $599 / 10k → ~$3,499 full service | Coinbase distribution, 500+ integrations, broker suite | DeFi classification issues, editing classifications is hard, price jumps sharply when tx count crosses a tier |
| **CoinLedger** | B2C, US-centric | ~$49 / 100 tx | Reconciliation UX, 1099-DA workflow positioning | US-focused; top-tier pricing is unclear |
| **ZenLedger** | B2C + enterprise | ~$49; free tier reportedly allows a report download | Free report tier, tax-pro network | Few independent reviews |
| **TokenTax** | B2C + full-service | ~$49; DeFi only on $199+ tier; VIP ~$3,499 | Done-for-you service | DeFi paywalled; no free tier |
| **Awaken** | B2C, DeFi/Solana-native | $69–$199 (sources conflict) | Claims 10k+ protocol recognition, per-wallet (Rev. Proc. 2024-28) support | Thin non-US coverage; competitor reports a security incident in Apr 2026 (unverified) |
| **CoinTracking** | B2C + corporate (DE) | Tiered | 400+ integrations, multi-client, white-label | Dated UX (common perception) |
| **Blockpit** (+Accointing, CryptoTax) | DACH, B2B API | €49 / tax year | Deep German/Austrian law, pre-filled forms in ~10 countries, exchange-facing API | Narrower outside DACH |
| **KoinX** | India | ~INR 115 / tax year | Schedule VDA, 1% TDS (194S) reconciliation, Indian exchange integrations, partnership with CoinDCX | India-only |
| **Taxbit** | B2B only | Enterprise | 1099-DA, DAC8/CARF in 65+ jurisdictions, public sector | No consumer product; enterprise sales cycle |

## 3. Pricing model observations

- Almost everyone prices **by transaction count**: 100 → 1k → 3k → 10k → unlimited.
  - This penalizes exactly the users with the hardest problem: DeFi users, bots, and active traders.
  - Spam airdrops and dust also inflate counts, so users end up paying for noise.
- Free tiers usually allow **calculation but not download**: you see your number, but you pay to get the form.
- India-focused KoinX prices per tax year in local currency, an order of magnitude cheaper than the USD tools. Local pricing wins in local markets.

## 4. Feature parity baseline (table stakes)

Any new entrant must match these on day one, or users won't switch:

1. CSV and API import from major exchanges, plus address import for major chains (BTC, EVM chains, Solana).
2. Automatic transfer matching between the user's own wallets and exchanges.
3. Cost basis methods: FIFO, LIFO, HIFO, and specific ID where the jurisdiction allows.
4. Income classification: staking, mining, airdrops, interest.
5. Country tax reports: US Form 8949 + Schedule D, TurboTax/TaxAct export, plus the local forms for each supported country.
6. Portfolio view with unrealized gains.
7. A manual edit/override for every transaction.

**Differentiation has to come from somewhere other than this list.** See [gap-analysis.md](./gap-analysis.md).
