# Tax Engine Spec

_Status: Draft v0.2 · Last updated: 2026-10-12 · Implementation: `packages/tax-engine` v0.2.0 (see §13)_

The tax engine is the product. It is a **pure, deterministic library**
([ADR-0006](../adr/0006-tax-engine-pure-library.md)). It turns a normalized ledger plus a
jurisdiction rule pack ([ADR-0007](../adr/0007-jurisdiction-rule-packs.md)) into tax
results, with full provenance ([ADR-0012](../adr/0012-explainability-and-provenance.md)).

## 1. Pipeline

```
Raw imports ──► Normalize ──► Match transfers ──► Classify ──► Lot engine ──► Tax calc ──► Reports
 (immutable)    (canonical     (own-wallet         (taxable     (per wallet,   (rule pack)  (forms,
                 events)        moves, bridges)     meaning)     per method)                 exports)
      ▲                                                 │
      └──────────── user overrides (versioned, auditable) ◄──────── Fix queue
```

- Each stage is a pure function: `(inputs, config, ruleVersion) → outputs + provenance + issues`.
- Stages can be recomputed independently, and results are cached by content hash.

## 2. Canonical event model

Every source (exchange API, CSV, chain indexer, 1099-DA) is normalized into **ledger
events**.

**Two layers.**
- **Importer output (target design, below).** Importers emit raw multi-leg events with classification hints. The classifier (§3) resolves each one into one of the typed events the engine consumes.
- **Engine input (implemented in v0.1, `packages/domain/src/ledger.ts`).** A discriminated union with these kinds:
  - `trade`: buy, sell or swap, with an optional fee;
  - `transfer`: between your own accounts, with an optional network fee;
  - `income`: staking, mining, airdrop, interest, hard fork, other;
  - `fee`;
  - `external_deposit`: optional user-supplied basis and acquisition date;
  - `external_withdrawal`.

  Amounts are decimal strings. Timestamps must carry a UTC offset.

Importer output (target design):

```ts
type LedgerEvent = {
  id: EventId;                 // stable, derived from source + source row id
  accountId: AccountId;        // wallet or exchange account (the US "wallet" for per-wallet basis)
  timestamp: Instant;          // UTC, source precision preserved
  legs: Leg[];                 // one or more balance changes (multi-leg for swaps, LP, fees)
  sourceRef: SourceRef;        // pointer to raw row(s); never lost
  hints: ClassificationHint[]; // from importer: e.g. "staking_reward", "bridge_out"
};

type Leg = {
  asset: AssetId;              // canonical asset (chain + contract or exchange symbol mapping)
  quantity: Decimal;           // signed; + in, - out. Decimal, never float (ADR-0008)
  role: "principal" | "fee" | "rebate";
  fiatValue?: Money;           // if provided by source; otherwise priced later
};
```

## 3. Classification

Each event gets a **taxable meaning** from a closed set:

`acquire_purchase`, `dispose_sale`, `swap`, `transfer_self`, `transfer_in_external`,
`transfer_out_external`, `income_staking`, `income_mining`, `income_airdrop`,
`income_interest`, `income_other`, `gift_in`, `gift_out`, `fee_only`, `lp_deposit`,
`lp_withdraw`, `bridge_out`, `bridge_in`, `wrap`, `unwrap`, `margin_pnl`, `spam`,
`lost_stolen`, `unknown`.

- Every classification carries a **confidence** (0–1) and the **reason** (importer hint,
  heuristic id, user override).
- **How the rule pack uses classifications:** some are tax-neutral in some jurisdictions and
  taxable in others (e.g. `wrap`, `lp_deposit`). The classifier states *what happened*; the
  rule pack decides *what it means for tax*.
- **Unknowns are never silently dropped.** They become fix-queue issues.

## 4. Transfer matching

- Matches `out` on account A with `in` on account B for the same asset within a configurable
  window and quantity tolerance (fees).
- Bridges match across assets via a bridge registry (e.g. ETH on L1 ↔ ETH on Arbitrum).
- Matched pairs carry their lots across accounts. US per-wallet basis moves with the lot.
- Unmatched outgoing transfers create an issue. The **default** suggestion is "transfer to
  external wallet you own (not imported)", because that is not a disposal. The issue's impact
  is the gain that would arise if it were a disposal.

## 5. Lot engine

- A **lot** = (account, asset, quantity, acquisition time, cost basis in reporting currency, provenance).
- Lots are tracked **per account** (required for the US from 2025). A jurisdiction may declare a
  `pooling` policy that aggregates lots (UK s.104, or pre-2025 US universal for historical
  years).
- Lot-selection methods are pluggable: `FIFO`, `LIFO`, `HIFO`, `SPEC_ID`, `UK_SHARE_POOLING`,
  `AVERAGE_COST`.
  - The rule pack declares which methods are allowed and which is the default.
- **Disposal output:**

  ```ts
  type Disposal = {
    eventId; accountId; asset; quantity; proceeds: Money; costBasis: Money;
    acquiredAt; disposedAt; holdingPeriod: "short" | "long" | RulePackDefined;
    lotsConsumed: { lotId; quantity; basis }[];
    ruleRefs: RuleRef[];      // which rule-pack rules produced this
  };
  ```

- **US safe harbor (Rev. Proc. 2024-28):**
  - a one-time allocation step at 2025-01-01;
  - stored as an immutable, user-signed allocation record;
  - recomputation never changes it.

## 6. Pricing (fiat valuation)

- A price oracle interface with sources ranked by priority:
  1. the source's own fiat value;
  2. exchange trade price at the timestamp;
  3. aggregator daily/minute candles.
- Every price used is recorded (source, timestamp, value) in provenance.
- Missing prices raise an issue whose impact is estimated from neighbouring prices.

## 7. Tax calculation

- The rule pack maps disposals and income events to **tax buckets**, for example:
  - US: short-term/long-term, ordinary income;
  - DE: taxable vs exempt by holding period, Freigrenze;
  - IN: VDA gains at flat rate, no loss set-off.
- **Estimated tax** is shown as a range only, and only when the user provides bracket inputs.
  The primary output is **gains and income per bucket**.

### 7.1 Report rounding
Engine figures are exact (ADR-0008). Summaries also carry figures rounded per the rule pack:
- **US:** each Form 8949 line is rounded, and `form8949Totals` (carried to Schedule D) is the sum of the rounded lines, so it always matches them. `shortTerm`/`longTerm` stay unrounded.
- **Japan:** `reported` gives 収入金額, 必要経費 and 雑所得 in whole yen (truncated). Each component is rounded first, and the income is derived from the rounded components.

### 7.2 History before a rule pack's first year
Activity older than a pack's first supported year (e.g. a 2013 purchase under the `jp` pack, which starts at 2014) is processed with the earliest supported rules. An `unsupported_history_year` issue with unknown impact flags it, because the basis it carries forward needs checking. A **tax year** outside the pack's range is still refused.

## 8. Fix queue (issue model)

```ts
type Issue = {
  id; kind: IssueKind;            // missing_basis, unmatched_transfer, unknown_classification, missing_price, negative_balance, 1099da_mismatch, ...
  eventIds: EventId[];
  impact: { min: Money; max: Money };  // change in taxable amount across plausible resolutions
  impactKnown: boolean;                // false when there is nothing to estimate from
  suggestedResolution?: { override; confidence: number; message; params }; // ready-to-apply override
  explanation: string;                 // plain language, i18n key + params
};
```

- The queue has three tiers:
  1. known, non-zero impact, sorted by `max(|impact.min|, |impact.max|)`;
  2. **unknown impact** (could be large, so never buried);
  3. known zero impact (informational).

  Ties break by tax year, then id.
- **Trade fees paid in crypto** are applied after the trade's acquisition, so a fee charged in the asset just received comes out of those units.
- **Missing prices** are valued at 0 in every reported figure. For ranking only, impact is estimated from the nearest quote at any distance in time, or from the stated value via the nearest FX quote:
  - unpriced proceeds or taxable income: `{0, estimate}`;
  - unpriced purchase in another fiat (missing basis lowers later gains): `{−estimate, 0}`;
  - fees and non-taxable receipts: `{−estimate, +estimate}`.

  With no quote at all, the impact is unknown.
- **Suggested resolutions** are offered only where there is a defensible default. Each is a ready-to-apply override (§8.1), so accepting it is one tap:
  - `missing_price` → `set_unit_price` at the nearest quote. Confidence by the quote's distance in time: ≤ 1 day 0.8, ≤ 7 days 0.6, ≤ 30 days 0.4, else 0.2. None when there is no quote.
  - `unmatched_withdrawal` → `classify_withdrawal: own_wallet` (§4's default), confidence 0.5.
  - None for `missing_basis`, `negative_balance` and the rest: only the user knows what they paid or what history is missing, and a guess could understate tax.
- Dust-level issues are auto-resolved with the default resolution and logged. _(Not built yet.)_

### 8.1 Overrides (ADR-0009)

`CalculationInput.overrides` is the override layer: `{ id, eventId, createdAt, author, note?, action }`, append-only. Amounts are in the report currency.

| Action | Applies to | Effect |
|---|---|---|
| `set_unit_price { asset, unitPrice }` | any event holding that asset | Values every amount of that asset in the event (incl. fees). Resolves `missing_price`. |
| `set_cost_basis { costBasis, acquiredAt? }` | `external_deposit` | Sets basis and, optionally, the original acquisition date (holding period). Resolves `missing_basis`. |
| `classify_withdrawal { as: own_wallet }` | `external_withdrawal` | Confirms a move to the user's own wallet: not taxable; clears `unmatched_withdrawal`. |
| `classify_withdrawal { as: spent, proceeds? }` | `external_withdrawal` | A disposal (`kind: 'spend'`) at `proceeds` or market value; `missing_price` if neither. |
| `revoke { overrideId }` | same event as the target | Withdraws an earlier override. |

- **Latest active override wins** per target (event + action type, + asset for prices), ordered by `createdAt`; when timestamps tie, by position in the input list (the API passes insertion order). Earlier ones are `superseded`.
- An override that doesn't fit its event (wrong kind, negative amount, acquisition after receipt, …) is ignored, never takes the slot from a valid earlier one, and raises `invalid_override` (zero impact; the original issue still shows its own).
- An override whose event is gone (e.g. after re-import) raises `orphaned_override` with unknown impact; it is never silently dropped.
- `CalculationResult.overrides` reports every override's status: `applied`, `superseded`, `revoked`, `event_not_found` or `not_applicable` (with `reason`).
- **Negative balance** issues (sold more than acquired) are a major source of errors in
  incumbents. Their impact assumes zero basis until resolved.

## 9. 1099-DA reconciliation (US)

- Import the broker's 1099-DA (CSV/PDF parse or broker API) as a separate **reported-figures** layer.
- Match each 1099-DA line to engine disposals by broker account, asset, date, and proceeds tolerance.
- Classify each line as one of:
  - `matched`;
  - `proceeds_mismatch`;
  - `basis_missing_noncovered`;
  - `basis_mismatch`;
  - `not_in_engine`;
  - `not_on_form`.
- Output: Form 8949 rows in the correct digital-asset box, with adjustment codes and amounts.
  Exact box/code mapping is pending verification against IRS instructions.

## 10. Determinism and reproducibility

- **Same-instant ordering.** Events at the same timestamp are applied as: opening positions, then events that acquire units, then everything else, then by id. Exports often share a second between a buy and a sell and list rows newest-first, so file order and ids can't decide it.
- **Lots carry their rule citations** (`Lot.ruleRefs`, e.g. trade-fee capitalisation, income basis, Rev. Proc. 2024-28 safe harbor). Child lots created by transfers inherit them, and disposals include the consumed lot's citations.

- A report is identified by `hash(normalized ledger, overrides, engine version, rule-pack version, price snapshot)`.
- Re-running with the same hash must produce byte-identical output. A CI golden-file suite enforces this.
- Rule-pack and engine upgrades never silently change a filed report. Old versions remain runnable, and users see a diff before accepting a recompute.

## 11. Performance targets

| Workload | Target |
|---|---|
| 2k events, full recompute | < 1 s on server, < 3 s on a mid-range phone |
| 100k events, full recompute | < 30 s on server (incremental recompute < 2 s) |
| B2B batch: 1M users × avg 200 events | horizontally parallel per user; overnight batch window |

If TypeScript can't meet these at scale, hot paths may move to Rust/WASM behind the same
interface. See [ADR-0003](../adr/0003-typescript-across-the-stack.md).

## 12. Testing

- **Golden scenarios per rule pack:** hand-computed by a tax professional, citing the legal source.
- **Property tests:**
  - quantity conservation (lots in = lots out + remaining);
  - basis conservation across transfers;
  - determinism.
- **Fuzzing of importers** with malformed CSVs.

## 13. Implementation status (v0.2.0)

| Area | Status |
|---|---|
| Typed event model, decimal arithmetic, local-date tax years | ✅ `packages/domain` |
| Rule packs `us` (2009–2026) and `jp` (2014–2027), with citations | ✅ `packages/rule-packs` (all rules `draft`) |
| Lot methods FIFO / LIFO / HIFO, per-account scope | ✅ |
| Average methods: moving average and total average (year-ahead average), per-user scope | ✅ |
| Transfers move lots (with parent→child provenance) under per-account scope; no-op under pooled scope | ✅ |
| Trade fees (basis / selling costs), crypto fees as disposals, deductible-expense flag | ✅ |
| Income at fair-market value or zero basis per rule pack | ✅ |
| Valuation: report-currency side → event value → price quote (≤ 24 h old) → FX-converted value | ✅ |
| Opening positions, incl. US Rev. Proc. 2024-28 safe-harbor allocation with mismatch check | ✅ |
| Fix queue: missing price/basis, negative balance, unmatched withdrawal, invalid method, opening-position problems; ordered by impact | ✅ |
| Suggested resolutions (missing price, unmatched withdrawal) and override layer: price, basis, withdrawal classification, revoke; latest wins; orphaned/invalid overrides become issues | ✅ (overrides are engine input; storing them needs `apps/api`) |
| US summary (short/long buckets, ordinary income, Form 8949 lines) | ✅ (checkbox G–L assignment awaits 1099-DA reconciliation) |
| JP summary (雑所得: disposals + income − expenses; loss not offsettable) | ✅ |
| Golden scenarios + property tests (conservation, determinism) | ✅ `packages/tax-engine/test` |
| Transfer matching | ✅ `packages/importers` (`matchTransfers`, ADR-0017) |
| CSV importers: canonical, Coinbase, Kraken, Coincheck (業界標準), bitFlyer | ✅ `packages/importers` (all but canonical `unverified`) |
| Classifier and protocol registry (on-chain) | ⏳ |
| 1099-DA reconciliation | ⏳ |
| Specific identification (user-chosen lots) | ⏳ |
| Japan separate taxation (2028+) | ⏳ (pack refuses those years) |
| Recompute caching, report hashing | ⏳ |

