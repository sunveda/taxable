# ADR-0015: Japan as the second launch jurisdiction, alongside the US

- **Status:** Accepted (confirmed by project owner, 2026-10-12)
- **Date:** 2026-10-12
- **Amends:** [ADR-0013](./0013-launch-jurisdiction.md), which planned UK/DE/IN only as engine acceptance tests

## Context
The project owner asked for the US and Japan tax engines to be built first. Japan is a
large retail crypto market with structurally different rules. That makes it a strong
second test of the rule-pack design (ADR-0007):

- **Pooled basis across all accounts** (per person, per crypto type), the opposite of the US per-wallet rule.
- **Average-cost methods only:** total average (総平均法, the default with no election) or moving average (移動平均法, by election). No lots, no holding period.
- **Comprehensive taxation:** gains and crypto income are miscellaneous income (雑所得), taxed at progressive rates. A net loss can't offset other income and can't be carried forward.
- **Japan Standard Time** decides the tax year.
- **A regime change is coming.** Separate taxation at 20.315% with a 3-year loss carryforward is expected from **2028-01-01**. It applies to specified crypto assets handled by registered firms, while DEX and overseas activity stays under comprehensive taxation. The start date depends on when the amended Financial Instruments and Exchange Act takes effect, set by cabinet order.

## Decision
- We ship a **`jp` rule pack** covering tax years 2014–2027, alongside `us`.
- Its rules:
  - **Basis scope:** `per_user`.
  - **Methods:** `TOTAL_AVERAGE` (default) and `MOVING_AVERAGE`, elected per asset.
  - **Crypto-for-crypto swaps** are disposals at the value received.
  - **Staking, mining and interest** are income at market value.
  - **Hard-fork coins** are not income and get a zero basis.
  - **Fees paid in crypto** are a disposal plus a necessary expense.
  - **Report figures** are whole yen, truncated.
- Every rule is `draft` until a 税理士 reviews it with the golden tests.
- **Tax years 2028+ throw `UnsupportedTaxYearError`** until the separate-taxation pack exists. That pack will need:
  - an account-level attribute saying whether the venue is a registered Japanese exchange;
  - split buckets for specified vs other crypto assets;
  - loss carryforward across years.
- The engine gained the mechanisms Japan needs, all of them jurisdiction-neutral:
  - pooled (`per_user`) scope;
  - average-cost pools;
  - year-ahead acquisition totals for 総平均法;
  - a non-overridable reporting time zone.

## Consequences
- The engine now proves out two structurally opposite basis models, which strengthens ADR-0007.
- Product and go-to-market:
  - Japanese UI (i18n);
  - importers for Japanese exchanges (bitFlyer, Coincheck, bitbank, GMO Coin, SBI VC Trade);
  - output for 確定申告 (the NTA's 暗号資産の計算書 format).
  - These are follow-up work.
- The UK, DE and IN rule packs stay planned as further acceptance tests.
- A 2028 deadline is now on the roadmap: the separate-taxation pack must ship before the 2028 tax year closes, and ideally during 2028 so users can see in-year estimates.
