# ADR-0014: Read-only data access; we never custody or move funds

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
Users connect exchanges via API keys and wallets via public addresses. Keys with trade or
withdraw permission would make us a high-value target and could create regulatory
obligations.

## Decision
- We accept **read-only** credentials only. Where an exchange exposes key scopes, we verify them at connect time and **reject** keys with trade/withdraw/transfer permissions.
- Wallets are connected by **public address / xpub only**. We never ask for seed phrases or private keys, and the UI warns users who try to paste one.
- Secrets are envelope-encrypted with a cloud KMS, decrypted only inside sync workers, never logged, and never returned by any API.
- The product never initiates transactions. Features like tax-loss harvesting are **suggestions** only. Partners may act on them in their own apps.

## Consequences
- Lower breach impact: a leak exposes history, not funds. It is still serious; see the [security spec](../spec/security-privacy-spec.md).
- No money-transmission or custody regulation.
- Some exchanges lack scoped keys or read-only OAuth. For those we fall back to CSV import.
