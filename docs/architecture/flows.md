# Flows

See the [legend](./README.md#legend). Sections 1–6 describe code that exists today;
sections 7–11 describe planned flows from the specs and ADRs.

1. [Import → match → calculate](#1-import--match--calculate-built)
2. [The engine's year loop](#2-the-engines-year-loop-built)
3. [A disposal, step by step](#3-a-disposal-step-by-step-built)
4. [Valuation](#4-valuation-built)
5. [Fix-queue ordering](#5-fix-queue-ordering-built)
6. [Transfer matching](#6-transfer-matching-built)
7. [Layered ledger and recompute](#7-layered-ledger-and-recompute-planned)
8. [Consumer journey](#8-consumer-journey-planned)
9. [Partner Tax API and pre-trade preview](#9-partner-tax-api-and-pre-trade-preview-planned)
10. [Basis Passport](#10-basis-passport-planned)
11. [1099-DA reconciliation](#11-1099-da-reconciliation-planned)

---

## 1. Import → match → calculate (built)

How a user's exchange files become a tax result today (exercised end to end in
`packages/importers/test/pipeline.test.ts`).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant D as importers.decodeText
  participant I as importers.importCsv
  participant M as importers.matchTransfers
  participant E as tax-engine.calculate
  participant R as rule pack (us / jp)

  loop each uploaded file (one account per file)
    U->>D: bytes
    D-->>I: text (UTF-8 or Shift_JIS)
    I->>I: detect format by header columns
    I->>I: parse rows → typed LedgerEvents (stable ids)
    I-->>U: warnings with line numbers, stats
  end
  U->>M: all events from all accounts
  M->>M: pair withdrawal + deposit → transfer (shortfall = network fee)
  M-->>E: events + matches
  E->>R: yearRules(year) for each year in history
  E->>E: effects → pools → disposals / income / expenses
  E-->>U: summary, disposals with lot provenance, fix queue
```

## 2. The engine's year loop (built)

`calculate()` processes the whole history up to the requested tax year, one calendar year
at a time in the rule pack's time zone. Total average (総平均法) needs each year's
acquisitions before any of that year's disposals, which is why effects are computed first.

```mermaid
flowchart TD
  start(["calculate(input)"]) --> tz["Resolve time zone<br/>(user's for US, Asia/Tokyo for JP)"]
  tz --> items["For every event and opening position up to the tax year:<br/>compute effects (pure, no pool state)"]
  items --> sort["Sort by time → opening positions first → id<br/>(deterministic)"]
  sort --> yloop{"Next year ≤ tax year?"}
  yloop -- yes --> pre["Sum the year's acquisitions per total-average pool<br/>→ pool.beginYear()"]
  pre --> apply["Apply each item's effects in order<br/>acquire · dispose · move · remove · reset ·<br/>income · expense · issue"]
  apply --> end_year["pool.endYear() for total-average pools<br/>(closing cost = units × year average)"]
  end_year --> yloop
  yloop -- no --> out["Holdings · sortIssues() · summarize()"]
  out --> result(["CalculationResult<br/>(only the tax year's records are reported)"])
```

## 3. A disposal, step by step (built)

What happens when an effect disposes of units, e.g. selling 1.5 ETH.

```mermaid
flowchart TD
  d(["dispose effect<br/>account · asset · quantity · proceeds · sellingCosts"]) --> key{"Basis scope"}
  key -- per_account --> pa["pool = account + asset"]
  key -- per_user --> pu["pool = asset"]
  pa --> take["pool.take(quantity)"]
  pu --> take
  take --> parts["consumed parts<br/>(lots in FIFO/LIFO/HIFO order,<br/>or one part at the average cost)"]
  take --> short{"shortfall > 0?"}
  short -- yes --> zero["extra part with basis 0<br/>+ negative_balance issue"]
  short -- no --> split
  zero --> split["Split proceeds and selling costs across parts<br/>in proportion to quantity (exact sum)"]
  parts --> split
  split --> term{"Rule pack has a holding period?"}
  term -- "US" --> hp["long if disposal date ><br/>acquisition date + 1 year (local dates)"]
  term -- "JP" --> none["no term"]
  hp --> line["One Disposal line per part<br/>with lotId, ruleRefs, gain"]
  none --> line
```

## 4. Valuation (built)

`Valuer.value()` decides the figures. `Valuer.estimate()` exists only to rank issues and
never feeds a reported figure.

```mermaid
flowchart TD
  a(["Amount to value at time t"]) --> f{"Is it the report currency<br/>(e.g. fiat:USD in a US report)?"}
  f -- yes --> v1["value = quantity"]
  f -- no --> ev{"Event states a value<br/>in the report currency?"}
  ev -- yes --> v2["value = stated value"]
  ev -- no --> q{"Price quote at or before t,<br/>at most 24 h old?"}
  q -- yes --> v3["value = quantity × quote"]
  q -- no --> fx{"Stated in another fiat,<br/>with an FX quote ≤ 24 h old?"}
  fx -- yes --> v4["value = converted amount"]
  fx -- no --> miss["value = 0 in all figures<br/>+ missing_price issue"]
  miss --> est{"Any quote at any time?<br/>(estimate)"}
  est -- yes --> known["impact from the estimate<br/>impactKnown = true"]
  est -- no --> unknown["impactKnown = false"]
```

## 5. Fix-queue ordering (built)

```mermaid
flowchart LR
  all(["All issues"]) --> t{"Tier"}
  t -- "known, non-zero impact" --> t1["1 · largest |impact| first"]
  t -- "impact unknown" --> t2["2 · could be large, never buried"]
  t -- "known zero impact" --> t3["3 · informational"]
  t1 --> tie["Ties: oldest tax year, then id"]
  t2 --> tie
  t3 --> tie
```

| Issue | Impact |
|---|---|
| `negative_balance` (sale) | −(proceeds of uncovered units); if proceeds were unpriced, the nearest-price estimate; else unknown |
| `negative_balance` (transfer) | market value, or nearest-price estimate, else unknown |
| `negative_balance` (send to unknown wallet) | unknown |
| `missing_basis` | −(market value on arrival, or nearest-price estimate), else unknown |
| `missing_price` | nearest-price estimate, else unknown |
| `unmatched_withdrawal` | + gain if it were a sale (market value or estimate), else unknown |
| `opening_position_mismatch` | unknown |
| `unsupported_history_year` | unknown (old activity processed with the earliest supported rules) |
| `method_not_allowed`, `opening_position_order`, `basis_currency_mismatch` | 0 (informational) |

## 6. Transfer matching (built)

For each withdrawal (in time order), choose the best deposit:

```mermaid
flowchart TD
  w(["Withdrawal from account A"]) --> c["Candidate deposits"]
  c --> f1{"Different account?"}
  f1 -- no --> skip["skip"]
  f1 -- yes --> f2{"Same asset?"}
  f2 -- no --> skip
  f2 -- yes --> f3{"Arrives 0–72 h after?"}
  f3 -- no --> skip
  f3 -- yes --> f4{"Received ≤ sent and<br/>shortfall ≤ 2 %?"}
  f4 -- no --> skip
  f4 -- yes --> f5{"User stated a cost basis?"}
  f5 -- yes --> skip
  f5 -- no --> pick["Keep the closest in time<br/>(then the smallest shortfall)"]
  pick --> t(["transfer: A → B<br/>fee = shortfall"])
  skip --> none(["No match: stays external,<br/>appears in the fix queue"])
```

## 7. Layered ledger and recompute (planned)

From [ADR-0009](../adr/0009-layered-ledger.md). Derived results are never authoritative;
they're recomputed from the layers above them.

```mermaid
flowchart TB
  raw[("1 · Raw layer<br/>immutable, content-addressed<br/>files and API pages")]:::planned
  norm[("2 · Normalized layer<br/>LedgerEvents + importer version")]:::partial
  over[("3 · Override layer<br/>append-only user decisions:<br/>classification, matches, basis, safe harbor")]:::planned
  der[("4 · Derived layer<br/>lots, disposals, issues, reports<br/>cached by input hash")]:::partial

  raw -- "importer (re-runnable)" --> norm
  norm --> calc["tax-engine.calculate<br/>+ price snapshot + versions"]:::built
  over --> calc
  calc --> der
  der -- "fix queue" --> user(["User / accountant"])
  user -- "resolve an issue" --> over

  classDef built fill:#d8f5dd,stroke:#2e7d32,color:#1b3d1f
  classDef partial fill:#fff4d6,stroke:#b7791f,color:#4a3510
  classDef planned fill:#eef0f4,stroke:#8a93a3,color:#3b4250,stroke-dasharray: 5 4
```

## 8. Consumer journey (planned)

From [product spec §4](../spec/product-spec.md).

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant W as Web / mobile app
  participant A as apps/api
  participant Q as Worker
  participant E as tax-engine

  U->>W: connect exchange (read-only key) or upload CSV
  W->>A: POST /sources
  A->>Q: enqueue import
  Q->>Q: store raw, normalize, match transfers
  Q->>E: calculate(taxYear)
  E-->>Q: result + issues
  Q-->>A: store derived results
  W->>A: GET /tax-position
  A-->>W: headline numbers + confidence + fix queue
  U->>W: open top issue, accept suggested fix
  W->>A: POST /overrides
  A->>Q: recompute (incremental)
  U->>W: tap a figure → "why?"
  W->>A: GET /explain?path=…
  A-->>W: provenance: form line → disposal → lots → events → raw rows + rule citations
  U->>W: export (8949 / TurboTax / 確定申告 figures / canonical CSV)
```

## 9. Partner Tax API and pre-trade preview (planned)

From the [B2B spec](../spec/b2b-platform-spec.md).

```mermaid
sequenceDiagram
  autonumber
  participant X as Exchange backend
  participant P as Partner API /v1
  participant Q as Worker
  participant E as tax-engine
  actor C as Exchange customer

  X->>P: POST /users/{id}/events:batchImport (idempotency key)
  P->>Q: enqueue
  Q->>E: calculate
  P-->>X: webhook: calculation ready
  X->>P: GET /calculations/{id}
  P-->>X: buckets, disposals, issues

  C->>X: opens "sell 0.5 BTC"
  X->>P: POST /users/{id}/preview-disposal {asset, qty}
  P->>E: calculate with a hypothetical disposal appended
  E-->>P: estimated gain, term, lots used
  P-->>X: "≈ $4,210 long-term gain"
  X-->>C: shows tax impact before confirming
```

## 10. Basis Passport (planned)

From [gap analysis G4](../research/gap-analysis.md) and the [B2B spec §2.4](../spec/b2b-platform-spec.md).
It needs legal review before Phase 3.

```mermaid
sequenceDiagram
  autonumber
  actor U as User
  participant S as svdt-cloud (user's account)
  participant B as Receiving exchange (partner)

  U->>S: "I'm moving 0.8 BTC to Exchange B"
  S->>S: select lots being moved (per-wallet rules)
  S->>U: show lots, basis, acquisition dates → ask consent
  U->>S: consent
  S->>S: sign statement {asset, qty, lots, basis, method,<br/>engine + rule-pack version, provenance hash}
  S-->>U: Basis Passport (download / link)
  U->>B: deposit 0.8 BTC + share passport
  B->>S: verify signature (API)
  S-->>B: valid ✓
  B->>B: show basis in its tax center<br/>(and, where its counsel allows, report it voluntarily)
```

## 11. 1099-DA reconciliation (planned)

From [tax-engine spec §9](../spec/tax-engine-spec.md). Market status: incumbents now ship
this, so depth is the differentiator ([gap review](../research/gap-review-2026-10.md)).

```mermaid
flowchart TD
  form[/"Broker 1099-DA<br/>(CSV / PDF / broker API)"/]:::planned --> parse["Parse into reported-figures layer<br/>(not ledger events)"]:::planned
  engine[/"Engine disposals<br/>(per-wallet basis)"/]:::built --> match
  parse --> match{"Match by broker account,<br/>asset, date, proceeds tolerance"}:::planned
  match -- "agrees" --> ok["matched"]
  match -- "proceeds differ" --> pm["proceeds_mismatch"]
  match -- "basis blank (noncovered)" --> nb["basis_missing_noncovered<br/>→ supply basis from engine"]
  match -- "basis differs" --> bm["basis_mismatch"]
  match -- "only on form" --> nie["not_in_engine → issue"]
  match -- "only in engine" --> nof["not_on_form"]
  ok --> f8949["Form 8949 rows:<br/>digital-asset box + adjustment code/amount"]:::planned
  pm --> f8949
  nb --> f8949
  bm --> f8949
  nof --> f8949

  classDef built fill:#d8f5dd,stroke:#2e7d32,color:#1b3d1f
  classDef planned fill:#eef0f4,stroke:#8a93a3,color:#3b4250,stroke-dasharray: 5 4
```
