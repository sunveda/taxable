# svdt Canonical CSV (v1)

_Status: Stable v1 · Importer: `svdt.canonical.v1` (`packages/importers/src/formats/canonical.ts`)_

A documented, exchange-neutral CSV that any history can be converted into. It's the
fallback for exchanges we don't support yet, the target for partner exports (B2B), and
the format our own "export ledger" feature will write (gap G7: data ownership).

## Rules
- UTF-8, comma-separated, RFC 4180 quoting, first row is the header. Column order doesn't matter; unknown columns are ignored.
- `timestamp`: ISO-8601. An offset is recommended (`2025-01-02T10:00:00Z`, `2025-01-02T19:00:00+09:00`); if it's missing, UTC is assumed.
- **Quantities are positive.** The direction comes from the column (`sent_*` vs `received_*`).
- **Assets** are tickers (`BTC`, `ETH`, `USDC`). Fiat uses its ISO code (`USD`, `JPY`).
- `account` is optional; the account chosen at upload is the default.
- `id` is optional but recommended. Re-importing rows with the same `id` doesn't duplicate them. Without an `id`, a hash of the row's content is used.

## Columns

| Column | Used by | Meaning |
|---|---|---|
| `timestamp` | all | When it happened |
| `type` | all | `trade`, `transfer`, `income`, `fee`, `deposit`, `withdrawal`, `ignore` |
| `account` | all | Account the row belongs to (optional) |
| `sent_asset`, `sent_quantity` | trade, transfer, withdrawal | What left the account |
| `received_asset`, `received_quantity` | trade, income, deposit | What arrived |
| `fee_asset`, `fee_quantity` | trade, transfer, fee, withdrawal | Fee paid (separate from `sent_quantity`) |
| `value`, `value_currency` | trade, income, deposit, withdrawal, fee | Market value of the received (or sent/fee) amount, if known |
| `to_account` | transfer | Destination account the user owns |
| `income_type` | income | `staking`, `mining`, `airdrop`, `interest`, `hard_fork`, `other` |
| `cost_basis`, `cost_basis_currency` | deposit | Original cost of coins arriving from outside, if known |
| `acquired_at` | deposit | Original acquisition time, if known |
| `id` | all | Stable row id (optional) |

## Meaning of each type

| `type` | Engine event | Taxable? |
|---|---|---|
| `trade` | Buy, sell or swap | Disposal of `sent_*` unless it is fiat |
| `transfer` | Move between the user's own accounts | No; basis moves with the coins. A crypto fee is a disposal (rule pack). |
| `income` | Staking, mining, airdrop, … | Per rule pack |
| `fee` | Fee only (e.g. failed transaction gas) | Disposal of the fee coins (rule pack) |
| `deposit` | Coins arriving from a wallet we can't see | No; flagged if `cost_basis` is missing |
| `withdrawal` | Coins leaving to a wallet we can't see | No; flagged for review (could be a payment or sale) |
| `ignore` | Nothing | Counted as skipped |

## Example

```csv
timestamp,type,sent_asset,sent_quantity,received_asset,received_quantity,fee_asset,fee_quantity,value,value_currency,to_account,income_type,id
2025-01-02T10:00:00Z,trade,USD,1000,BTC,0.01,USD,5,,,,,t1
2025-01-03T10:00:00Z,transfer,BTC,0.005,,,BTC,0.0001,,,ledger,,t2
2025-01-04T10:00:00Z,income,,,ETH,0.1,,,300,USD,,staking,t3
```
