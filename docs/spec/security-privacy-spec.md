# Security & Privacy Spec

_Status: Draft v0.1 · Last updated: 2026-10-12_

We hold **complete financial histories, API keys, and (for B2B) tax identification
numbers.** A breach would end the company. Security is a product feature.

## 1. Data classes

| Class | Examples | Controls |
|---|---|---|
| **Secrets** | Exchange API keys/secrets, OAuth refresh tokens | Envelope encryption (KMS), decrypted only inside sync workers, never returned by any API, never logged |
| **Tax PII** | Name, address, TIN/SSN (B2B reporting), tax residence | Field-level encryption, per-tenant keys, access audited, data residency (US/EU) |
| **Financial data** | Transactions, balances, addresses, reports | Encrypted at rest, tenant isolation (RLS), user export and delete |
| **Telemetry** | Product analytics | No financial values or addresses; opt-out |

## 2. Principles
- **Read-only access only.** Reject API keys that have trade/withdraw permissions where the exchange exposes scope. See [ADR-0014](../adr/0014-read-only-access-no-custody.md).
- **Least privilege** for services and staff. Production data access is just-in-time, approved, and logged.
- **No secrets in the client.** The web and mobile apps never see exchange secrets after submission.
- **Auth:**
  - passkeys / WebAuthn first-class; TOTP as fallback; no SMS-only 2FA;
  - B2B: SSO (SAML/OIDC) and scoped API keys with rotation.
- **Data ownership:**
  - full ledger export in an open, documented format;
  - account deletion purges raw imports and derived data, except records we are legally required to retain.

## 3. Compliance roadmap
- GDPR / UK GDPR from day one: DPA, records of processing, EU data residency for EU tenants.
- SOC 2 Type I before the first B2B production customer; Type II within 12 months.
- Pen test before public launch and annually after.

## 4. Mobile-specific (later)
- Store tokens in the OS keychain/keystore.
- Biometric unlock is optional.
- No offline storage of PII beyond cached summaries. Cached data is encrypted.
