# Regulatory Landscape (2025–2029)

_Research date: 2026-10-12. Not tax or legal advice. Before shipping any rule into the
engine, check it against the primary text (IRS regs and instructions, EUR-Lex, HMRC
manuals, Indian Income-tax Act). Secondary sources disagree on several details; those
details are flagged below._

Over the next few years crypto tax shifts **from self-reporting to third-party reporting**,
the way stock brokerage reporting works today. That shift creates new mandatory buyers
(exchanges) and a new kind of consumer pain: reconciling what the exchange reported with
what the user actually did.

## United States

### Form 1099-DA (IRC §6045 broker reporting)
- Custodial brokers (centralized exchanges, hosted wallets) report **gross proceeds** for dispositions starting with **2025** transactions.
- **Cost basis** reporting is required only for **covered** assets: acquired on or after **2026-01-01** and held continuously at the same broker. The first basis-bearing forms arrive early 2027.
- Assets **transferred in** from another wallet or exchange are **noncovered**. The broker reports proceeds only, and basis reporting is voluntary (Coinbase guidance confirms this treatment).
- The **DeFi broker rule** (non-custodial) was **repealed by Congress in April 2025**.
- **Consequence:** for years, users will receive 1099-DAs whose proceeds don't line up with their own records, often with a blank basis. They will still need software to supply basis and reconcile against Form 8949.
- Form 8949 has separate checkboxes for digital-asset transactions reported on 1099-DA (boxes G–L in the 2025 revision). **Verify against the current IRS instructions before implementing.**

### Wallet-by-wallet basis (Treas. Reg. §1.1012-1(j), Rev. Proc. 2024-28)
- From **2025-01-01**, the "universal" method (one global pool across all wallets) is no longer allowed. Basis is tracked **per wallet/account**.
- Rev. Proc. 2024-28 provides a **safe harbor** for allocating unused basis held on 2025-01-01 across wallets.
  - The allocation is **irrevocable**.
  - Reported conditions: same remaining units per wallet, same asset type.
  - It can't be used for assets acquired or transferred on or after 2025-01-01.
- The default method is FIFO **within each wallet**. Specific identification requires adequate identification (and, at a broker, standing orders).
- **Consequence:** the engine must model lots **per wallet**, not per user, and must support a one-time, auditable safe-harbor allocation.

## European Union — DAC8

- Directive (EU) 2023/2226. Applies from **2026-01-01** to crypto-asset service providers (RCASPs), including non-EU platforms serving EU residents.
- Providers must:
  - collect each customer's TIN and tax-residence self-certification (with account blocking reportedly after 60 days of non-compliance);
  - report each customer's identity, residence, and aggregated transactions.
- First filing for 2026 data reportedly due **2027-09-30**. Sources disagree on a grace period to 2026-07-01.
- Covers only transactions from 2026 onward, but collective information requests can reach further back.

## OECD — CARF (Crypto-Asset Reporting Framework)

- The global analogue of DAC8. Sources count **46–75 committed jurisdictions** (the counts conflict); first exchanges in 2027.
- **UK** implements CARF itself (reporting to HMRC), outside DAC8.
- **US** reportedly targets 2029 for CARF exchange.
- **Consequence:** every mid-size exchange serving international users needs CARF/DAC8 data collection and XML reporting. Many will **buy rather than build**.

## Reference jurisdictions for the rule-pack design

These are chosen to stress-test the engine architecture
([ADR-0007](../adr/0007-jurisdiction-rule-packs.md)) because their rules differ structurally:

| Jurisdiction | Structural rule that stresses the engine |
|---|---|
| **US** | Per-wallet lots, short vs long term (>1 year), FIFO/HIFO/spec-ID, 1099-DA reconciliation, wash sale **not** applied to crypto (as of research date; repeatedly proposed) |
| **UK** | Share pooling: same-day rule, 30-day "bed & breakfast" rule, then the Section 104 pool. No per-lot choice. |
| **Germany** | Private disposals are tax-free after a **1-year holding period** (§23 EStG); €1,000 annual exemption limit (Freigrenze); staking does not extend the period to 10 years (BMF guidance). Lot age matters more than gain size. |
| **India** | Flat **30%** + 4% cess on VDA gains (§115BBH); **no loss set-off** and no deductions beyond acquisition cost; **1% TDS** (§194S) on transfers above INR 10,000 that must be credited/reconciled; Schedule VDA in the ITR. |

If one engine can express all four through data-driven rule packs, adding jurisdictions
becomes content work rather than engineering work.
