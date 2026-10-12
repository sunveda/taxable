# Data Ingestion Spec

_Status: Draft v0.2 · Last updated: 2026-10-12 · Architecture: [ADR-0017](../adr/0017-importer-architecture.md)_

## 1. Principles

1. **Raw is immutable.**
   - Every imported file or API response page is stored as-is, content-addressed (hash).
   - Normalization can be re-run when a parser improves. See [ADR-0009](../adr/0009-layered-ledger.md).
2. **Read-only only.** We never request trade or withdraw permissions. See [ADR-0014](../adr/0014-read-only-access-no-custody.md).
3. **Idempotent.** Re-importing the same data never duplicates events. Event ids are derived from the source and the source's own row/tx id.
4. **Every parser is tested** against real (anonymized) fixtures, with snapshot tests of normalized output.

## 2. Source types

| Type | Mechanism | Notes |
|---|---|---|
| Exchange API | Read-only API key or OAuth | Incremental sync with cursors; rate-limit aware; nightly refresh |
| Exchange CSV | Upload | Auto-detect exchange and format version by header fingerprint |
| Generic CSV | Upload of the [svdt canonical CSV](./canonical-csv.md) (later: column-mapping UI) | Fallback for the long tail; saved mappings are reusable |
| Wallet address | Chain indexer (provider abstraction) | BTC (xpub/address), EVM chains, Solana in MVP |
| Broker tax forms | 1099-DA CSV/PDF | Stored as the **reported-figures** layer, not as ledger events |
| B2B push | Tax API batch import | Partner-provided events in the canonical schema |

## 3. Importer interface

Implemented for CSV in `packages/importers` (v0.1):

```ts
interface CsvImporter {
  id: string;                       // "coinbase.transactions.csv.v2"
  markets: ('us' | 'jp')[];
  format: { status: 'verified' | 'unverified'; sources: string[]; notes?: string };
  requiredColumns: string[];        // header fingerprint used for detection
  parse(table: CsvTable, ctx: { accountId }): { events: LedgerEvent[]; warnings: ImportWarning[]; stats };
}

importCsv(text, { accountId, importerId? })   // detect + parse
decodeText(bytes)                             // UTF-8, falling back to Shift_JIS
matchTransfers(events, { windowHours?, maxFeeRatio? })
```

- One module per source. Parsing is pure; network fetch (API sync, indexers) will be a separate layer so it can be mocked.
- API and on-chain importers will emit the same `LedgerEvent`s.
- **Warnings** carry a line number and a code: `unknown_type`, `unsupported_type`, `invalid_number`, `invalid_timestamp`, `unrecognized_row`, `assumption`. A row is never dropped without one, except intentional skips (fiat deposits, internal moves), which are counted in `stats.skipped`.

### 3.1 Format verification policy
- `unverified` importers are built from public descriptions and synthetic fixtures. They must not be offered to users as "supported" until tested against anonymized real exports, which are then committed as fixtures.
- `verified` importers carry real-export fixtures. Any format change found in the wild becomes a new importer version (e.g. `…csv.v3`); old versions stay so older files still import.

### 3.2 Transfer matching
- Runs after all of a user's sources are imported.
- A withdrawal from account A matches a deposit into account B when all of these hold:
  - same asset;
  - the deposit's timestamp is between 30 min before and 72 h after the withdrawal's (exchanges stamp at different moments, so a deposit can appear slightly "early");
  - the deposit is ≤ the withdrawal, with a shortfall of at most 2% (the network fee).
- Withdrawals are processed in time order, and each takes the deposit closest in time (absolute gap, then smallest shortfall).
- Timestamps are parsed once; deposits are indexed per asset and sorted, so each withdrawal only scans its own window.
- The pair becomes one `transfer`, with the shortfall as its fee.
- Deposits with a user-stated basis are never matched.
- Unmatched rows stay external and appear in the engine's fix queue.

## 4. On-chain decoding

- Use an indexer provider abstraction (e.g. a commercial indexer for EVM and Solana) behind an interface. This avoids lock-in and lets providers be swapped per chain.
- Decode known protocols (DEX swaps, LP, staking, bridges) via a **protocol registry**:
  - versioned data that maps contract addresses and event signatures to classification hints;
  - unknown contract interactions fall back to a generic decoding of balance deltas, with `unknown` classification and an issue.
- **Spam detection:**
  - a token allow/deny list;
  - heuristics: unsolicited transfer, no liquidity, airdrop to many addresses;
  - spam is auto-classified `spam`, excluded from reports and pricing, and visible and reversible.

## 5. Asset identity

- Canonical `AssetId`:
  - on-chain assets: `chain:contract`;
  - exchange-native listings: `exchange:symbol`, mapped to a canonical asset where known.
- An asset map service resolves symbols such as `ETH`, `WETH`, and `ETH.ARB` to the
  canonical asset, keeping the relationships needed for wrap/bridge rules.

## 6. Sync scheduling
- B2C: on connect, then daily; manual refresh available.
- B2B: partner push, or scheduled pull per partner contract.
- Jobs run on a Postgres-backed queue initially. See [ADR-0010](../adr/0010-postgres-primary-store.md).

## 7. MVP source list

Launch markets: US and Japan ([ADR-0013](../adr/0013-launch-jurisdiction.md), [ADR-0015](../adr/0015-japan-second-jurisdiction.md)).

| Source | Market | Mechanism | Status |
|---|---|---|---|
| svdt canonical CSV | all | CSV | ✅ verified (our own format) |
| Coinbase | US | CSV (transaction history) | 🟡 implemented, unverified |
| Kraken | US | CSV (ledgers) | 🟡 implemented, unverified |
| Coincheck (業界標準フォーマット) | JP | CSV | 🟡 implemented, unverified |
| bitFlyer | JP | CSV (取引履歴) | 🟡 implemented, unverified |
| Coincheck 暗号資産報酬履歴 (staking) | JP | CSV | ⏳ format needed |
| Gemini, Robinhood Crypto, Crypto.com, Binance.US | US | CSV, then API | ⏳ |
| bitbank, GMO Coin, SBI VC Trade, bitTrade | JP | CSV (several may offer 業界標準フォーマット) | ⏳ |
| Exchange API sync (Coinbase, Kraken, bitFlyer) | US/JP | Read-only API keys (ADR-0014) | ⏳ |
| BTC, EVM (Ethereum, Base, Arbitrum, Optimism, Polygon), Solana | all | Address import via indexer | ⏳ |

## 7a. Kraken ledger specifics
- **Pending + credited rows.** Kraken lists a funding movement twice: pending (blank `txid`) and credited (with `txid`). A blank-`txid` deposit or withdrawal is skipped when the same `refid` has a credited row of the same type and asset. Without a credited twin it is imported, with an `assumption` warning.
- **Spot ↔ staking.** Rows on staking assets (`DOT.S`, `ETH2.S`, …) are internal. The spot-side withdrawal or deposit is paired with the closest staking row of the same quantity (≤ 2% apart, within 14 days) and skipped too, so staking never strips basis.

## 8. Japan-specific handling
- **Encoding:** files may be Shift_JIS. `decodeText` tries strict UTF-8 first, then Shift_JIS. Hermes lacks Shift_JIS, so mobile uploads are decoded server-side.
- **Time:** exports use JST without an offset. Importers attach `+09:00`; Japan has no DST.
- **Labels:** 取引種別 values vary by exchange. Importers decide what happened from structure (増加/減少 columns, signed quantities). Labels are used only to recognise income (ステーキング, 貸暗号資産, エアドロップ, 報酬 …). Anything else crypto-in-only becomes a deposit with unknown basis, for the user to review.
- **Values:** bitFlyer's 通貨1の対円レート gives a JPY value for received coins, used for income and deposits.
- **Industry standard format:** Coincheck's 業界標準フォーマット follows the JCBA reference format (2021). Other Japanese exchanges adopting it should be covered by the same importer once verified.
