# Components

See the [legend](./README.md#legend). Related: [ADR-0002](../adr/0002-monorepo-structure.md),
[ADR-0006](../adr/0006-tax-engine-pure-library.md), [ADR-0007](../adr/0007-jurisdiction-rule-packs.md),
[ADR-0017](../adr/0017-importer-architecture.md).

## 1. Monorepo packages

Arrows point from a package to what it depends on. The rule from ADR-0002 holds: apps
depend on packages, never the reverse. The four shared packages are lint-guarded to stay
platform-neutral and deterministic (no Node/DOM APIs, no clock, no randomness).

```mermaid
flowchart TB
  subgraph apps["apps/"]
    web["@svdt/web<br/>Next.js"]:::partial
    mobile["apps/mobile<br/>(reserved)"]:::planned
    api["apps/api"]:::planned
    worker["apps/worker"]:::planned
  end
  subgraph pkgs["packages/ (shared, platform-neutral)"]
    engine["@svdt/tax-engine"]:::built
    importers["@svdt/importers"]:::built
    packs["@svdt/rule-packs"]:::built
    domain["@svdt/domain"]:::built
  end
  config["@svdt/config<br/>tsconfig base"]:::built
  ext_dec[/"decimal.js"/]

  web --> engine
  web --> packs
  web --> domain
  mobile -.-> engine
  api -.-> engine
  worker -.-> engine
  worker -.-> importers
  engine --> packs
  engine --> domain
  packs --> domain
  importers --> domain
  domain --> ext_dec
  importers -. "tests only" .-> engine
  pkgs -. "dev" .-> config

  classDef built fill:#d8f5dd,stroke:#2e7d32,color:#1b3d1f
  classDef partial fill:#fff4d6,stroke:#b7791f,color:#4a3510
  classDef planned fill:#eef0f4,stroke:#8a93a3,color:#3b4250,stroke-dasharray: 5 4
```

| Package | Responsibility | Key exports |
|---|---|---|
| `@svdt/domain` | Ledger event types, decimal arithmetic, time zones | `LedgerEvent`, `Decimal`, `dec`, `allocateProportionally`, `localDate`, `parseInstant` |
| `@svdt/rule-packs` | Jurisdiction rules as cited data | `us`, `jp`, `RulePack`, `YearRules`, `UnsupportedTaxYearError` |
| `@svdt/tax-engine` | Pure, deterministic calculation | `calculate`, `CalculationResult`, `Disposal`, `Lot`, `Issue` |
| `@svdt/importers` | CSV parsing, format detection, transfer matching | `importCsv`, `matchTransfers`, `decodeText`, `csvImporters` |

## 2. Inside the tax engine

`calculate()` is the only entry point. Everything below it is pure.

```mermaid
flowchart LR
  input[/"CalculationInput<br/>events · prices · openingPositions<br/>methods · timeZone · rulePack · taxYear"/]
  calc["engine.ts<br/>calculate()"]:::built
  eff["effects.ts<br/>event → effects<br/>(acquire · dispose · move · remove ·<br/>income · expense · reset · issue)"]:::built
  val["valuation.ts<br/>Valuer: value() for figures,<br/>estimate() for ranking only"]:::built
  pools["pools.ts<br/>LotPool (FIFO/LIFO/HIFO)<br/>MovingAveragePool<br/>TotalAveragePool"]:::built
  issues["issues.ts<br/>fix-queue ordering"]:::built
  summary["summary.ts<br/>US: short/long, income, 8949<br/>JP: 雑所得"]:::built
  packs["rule-packs<br/>yearRules(year)"]:::built
  output[/"CalculationResult<br/>disposals · income · expenses · lots ·<br/>holdings · issues · summary · versions"/]

  input --> calc
  calc --> eff
  eff --> val
  eff --> packs
  calc --> pools
  calc --> issues
  calc --> summary
  calc --> output

  classDef built fill:#d8f5dd,stroke:#2e7d32,color:#1b3d1f
```

### Pool model

Basis scope decides the pool key; the cost-basis method decides the pool type.

```mermaid
classDiagram
  class Pool {
    <<interface>>
    +asset
    +method
    +quantity() Decimal
    +costBasis() Decimal
    +add(lot)
    +take(quantity) parts, shortfall
    +reset()
  }
  class LotPool {
    FIFO / LIFO / HIFO
    specific lots, consumed in method order
  }
  class MovingAveragePool {
    移動平均法
    average updated on each acquisition
  }
  class TotalAveragePool {
    総平均法
    +beginYear(acquiredQty, acquiredCost)
    +endYear()
    one average per calendar year
  }
  Pool <|.. LotPool
  Pool <|.. MovingAveragePool
  Pool <|.. TotalAveragePool

  class Lot {
    id
    accountId
    asset
    quantity
    costBasis
    acquiredAt
    origin
    eventId
    parentLotId
  }
  LotPool o-- Lot
```

| Basis scope | Pool key | Used by |
|---|---|---|
| `per_account` | account + asset | US (Treas. Reg. §1.1012-1(j)) |
| `per_user` | asset | Japan (pooled across all exchanges) |

## 3. Rule packs

Rule packs are data; the engine implements the mechanisms (ADR-0007).

```mermaid
classDiagram
  class RulePack {
    id: us | jp
    version
    status: draft | reviewed | stable
    reportingCurrency
    defaultTimeZone
    timeZoneFromUser
    summaryModel
    reportRounding
    supportedYears
    rules: RuleCitation[]
    yearRules(taxYear) YearRules
  }
  class YearRules {
    basisScope
    costBasis: allowed, default
    holdingPeriod
    income: per IncomeType
    swap
    cryptoFee: isDisposal, isDeductibleExpense
    tradeFee
  }
  class RuleCitation {
    id
    summary
    source
    reviewStatus: draft | reviewed
  }
  RulePack --> YearRules : yearRules()
  RulePack o-- RuleCitation
  YearRules ..> RuleCitation : every rule refers to one
```

## 4. Importers

```mermaid
flowchart LR
  bytes[/"Uploaded file (bytes)"/]
  decode["text.ts<br/>decodeText<br/>UTF-8 → Shift_JIS fallback"]:::built
  csv["csv.ts<br/>RFC 4180 records<br/>header-row discovery"]:::built
  detect["index.ts<br/>importCsv: detect by<br/>required columns"]:::built
  subgraph formats["formats/"]
    canon["canonical<br/>(verified)"]:::built
    cb["coinbase<br/>(unverified)"]:::partial
    kr["kraken<br/>(unverified)"]:::partial
    jpstd["業界標準フォーマット<br/>(unverified)"]:::partial
    bf["bitFlyer<br/>(unverified)"]:::partial
  end
  values["values.ts / assets.ts<br/>amounts · timestamps · tickers · row ids"]:::built
  match["match-transfers.ts<br/>matchTransfers"]:::built
  out[/"LedgerEvent[] + warnings + stats"/]

  bytes --> decode --> csv --> detect --> formats
  formats --> values
  formats --> out
  out -- "all of a user's files" --> match

  classDef built fill:#d8f5dd,stroke:#2e7d32,color:#1b3d1f
  classDef partial fill:#fff4d6,stroke:#b7791f,color:#4a3510
```

"Unverified" importers are built from public descriptions and synthetic fixtures. They
need anonymized real exports before they're offered to users ([ADR-0017](../adr/0017-importer-architecture.md)).
