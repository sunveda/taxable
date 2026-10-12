# B2B Platform Spec — Exchanges, Brokers, Wallets

_Status: Draft v0.1 · Last updated: 2026-10-12_

## 1. Why B2B buyers will pay

| Driver | Detail |
|---|---|
| **Mandatory reporting** | US 1099-DA (proceeds from 2025, basis from 2026); EU DAC8 from 2026; OECD CARF in 46+ jurisdictions. Every in-scope platform must comply. |
| **Support cost** | Users receiving their first 1099-DA (often with blank basis for transferred-in assets) will flood support. A tax center that explains the form cuts tickets. |
| **Retention and engagement** | Pre-trade tax preview and year-round tax position keep users on-platform. |
| **Incumbent gap** | Taxbit and CoinTracker's broker suite target Tier-1 exchanges via enterprise sales. Mid-size and regional exchanges are underserved: they need **self-serve onboarding, published pricing, and multi-regime compliance in one integration**. |

## 2. Products

### 2.1 Tax API (Phase 2 beta)
- REST + JSON, OpenAPI 3.1 spec, versioned (`/v1`). SDKs generated for TS, Python, Go.
- Endpoints (draft):
  - `POST /v1/users/{externalUserId}/events:batchImport`: push normalized or raw events.
  - `POST /v1/users/{id}/calculations`: run with `jurisdiction`, `taxYear`, `method`. Returns a calculation id.
  - `GET /v1/calculations/{id}`: buckets, disposals, income, issues.
  - `GET /v1/calculations/{id}/explain?path=...`: provenance graph for any figure.
  - `POST /v1/users/{id}/preview-disposal`: **pre-trade tax preview** ("selling 0.5 BTC now → est. gain $X, long-term").
  - `GET /v1/calculations/{id}/reports/{format}`: 8949 PDF, CSV, etc.
- Idempotency keys on all writes. Webhooks for long-running jobs.

### 2.2 Embedded Tax Center (Phase 3)
- A white-label web component plus React/React Native packages. The same UI as our B2C app, themed by the partner.
- Runs on the partner's data by default. With user consent it can pull in the user's off-platform history (our B2C account), which fills in noncovered basis.

### 2.3 Broker Reporting Module (Phase 3)
- **US:** 1099-DA generation, recipient copies, IRS FIRE/IRIS e-file format, corrections, backup-withholding flags.
- **EU / OECD:** DAC8 and CARF data collection (TIN, self-certification flows), validation, and XML generation per the OECD schema.
- **Compliance dashboard:** filing status, reconciliation exceptions, missing-TIN users.

### 2.4 Basis Passport (Phase 2 download → Phase 3 network)
- **The problem:** an exchange that receives transferred-in crypto has no basis. The asset is "noncovered" (US) and the user's form shows blank basis.
- **The product:**
  - Our engine already knows the user's full lot history across platforms.
  - With **explicit user consent**, it issues a **signed basis statement** for specific lots being transferred: asset, quantity, acquisition date, basis, method, engine and rule version, and a hash of the provenance.
  - The receiving partner can verify the signature via API and use the statement to support user-facing tax displays and, where permitted, voluntary basis reporting.
- **Legal note:** this does not change an asset's covered or noncovered status. Partners decide how to use it under their own counsel's advice. Needs legal review before Phase 3.
- **Network effect:** each new partner makes the passport more valuable to users, and each user with a passport makes us more valuable to partners.

## 3. Multi-tenancy

- See [ADR-0011](../adr/0011-api-first-multi-tenant.md).
- Tenant = partner organization.
  - B2C users belong to the built-in "direct" tenant.
  - A person can link their direct account to partner identities only by explicit consent.
- Data isolation: row-level tenant ids enforced in the data-access layer plus Postgres RLS. Per-tenant encryption keys for PII.
- Rule packs are global; a tenant can pin a rule-pack version for its filing year.

## 4. Onboarding (self-serve target)

1. Sign up → sandbox API key → synthetic test data.
2. Upload a sample export → automatic mapping suggestions → verify parity on sample users.
3. Production keys after contract and DPA (data processing agreement).

## 5. SLAs (targets)
- API availability 99.9% (GA). Batch report generation for 1M users within 24 h.
- Data residency options: US, EU (needed for DAC8 customers).

## 6. Pricing hypothesis
- Self-serve: per active reporting user per year (published, tiered by volume).
- Enterprise: committed volume plus filing modules.
- Pre-trade preview: per 1k calls above an included quota.
