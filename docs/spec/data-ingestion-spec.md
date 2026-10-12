# Data Ingestion Spec

_Status: Draft v0.1 · Last updated: 2026-10-12_

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
| Generic CSV | Upload + column-mapping UI | Fallback for the long tail; saved mappings are reusable |
| Wallet address | Chain indexer (provider abstraction) | BTC (xpub/address), EVM chains, Solana in MVP |
| Broker tax forms | 1099-DA CSV/PDF | Stored as the **reported-figures** layer, not as ledger events |
| B2B push | Tax API batch import | Partner-provided events in the canonical schema |

## 3. Importer interface

```ts
interface Importer<Config> {
  id: string;                  // "coinbase.api.v3", "kraken.csv.2024", "evm.address"
  detect?(file: RawFile): Confidence;
  fetch?(config: Config, cursor?: Cursor): AsyncIterable<RawPage>;
  normalize(raw: RawPage | RawFile): { events: LedgerEvent[]; warnings: ImportWarning[] };
}
```

- Importers live in `packages/importers`, one module per source. They are pure normalization;
  network fetch is separated so it can be mocked.

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
The launch market is the US ([ADR-0013](../adr/0013-launch-jurisdiction.md)). The exact list is
finalized in the first importer PR: the top 5–8 US-available CEXs by user share, plus generic CSV, BTC, EVM (Ethereum, Base, Arbitrum,
Optimism, Polygon, BNB Chain), and Solana.
