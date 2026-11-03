# Taxable walkthrough transcript

English narration; synthetic data only. Mobile layouts are illustrations, not device captures.

## 00:00 — Taxable

PRODUCT WALKTHROUGH · 03 NOV 2026

Taxable is a crypto tax calculation and reporting project for Japan and the United States. This walkthrough covers the current specifications, screens, and user journey. Everything shown uses synthetic data. It is not ready for tax filing.

## 00:16 — One ledger. Three clients.

IMPLEMENTED ARCHITECTURE · DEVELOPMENT PREVIEW

The web app and Expo mobile apps share an API client. The API stores imported transactions and append-only corrections, then runs the shared tax engine. Each personal session is limited to its own user. Rule packs are drafts, and exchange-specific importers still need validation.

## 00:36 — 01 · Sign in

ACTUAL LOCAL WEB SCREEN

The actual web sign-in screen accepts a personal, expiring session. This is an invite-only development flow, not self-service account registration. The session is checked by the API. No session token is visible in this recording.

## 00:51 — 02 · Review the overview

ACTUAL LOCAL WEB SCREEN

After sign-in, the overview shows the selected country, year, calculation method, and draft totals. These synthetic records deliberately contain missing information. Notice the unknown-impact badge: a zero uncertainty range does not mean those issues have no financial effect.

## 01:10 — 03 · Import a CSV

ACTUAL LOCAL WEB SCREEN

The Import screen accepts a CSV and an exchange or wallet account name. The format can be detected automatically or chosen manually. Uploads are limited to twenty megabytes. Here we use the documented canonical format, rather than claiming an unverified exchange export is validated.

## 01:29 — 04 · Inspect the import result

ACTUAL LOCAL WEB SCREEN

This is the result of a real upload to the disposable local API. The app reports imported rows, skipped rows, warnings, and conflicts. Review these results before relying on the ledger. No private financial information or external account was used.

## 01:46 — 05 · Check transactions

ACTUAL LOCAL WEB SCREEN

Transactions shows the normalized ledger: when each event occurred, which account it belongs to, and what was sent or received. Source identifiers connect the result back to the imported record. This screen helps check whether the data matches the original statement.

## 02:02 — 06 · Review the fix queue

ACTUAL LOCAL WEB SCREEN

The Fix queue surfaces unresolved items. In this synthetic example, an Ethereum deposit lacks cost basis, an airdrop lacks a price, and a withdrawal needs classification. Suggestions are aids for review, not verified facts about the user’s finances.

## 02:20 — 07 · Supply a correction

ACTUAL LOCAL WEB SCREEN

Here the user enters a total cost basis of one hundred fifty thousand yen for the synthetic deposit. An acquisition date can also be supplied. The correction is recorded separately from the imported history, so the underlying source record is preserved.

## 02:36 — 08 · Recalculate and keep history

ACTUAL LOCAL WEB SCREEN

After saving, the missing-basis item is resolved and the report is recalculated. The other issues remain visible. The correction history records what changed, and the user can revoke a correction instead of silently deleting the original evidence.

## 02:52 — 09 · Review the draft report

ACTUAL LOCAL WEB SCREEN

The Report screen presents country-specific draft summaries, disposals, income, and holdings. These are engine results from the current ledger and corrections. They are not an approved tax return and should not be treated as professionally reviewed filing advice.

## 03:09 — 10 · Inspect how basis was used

ACTUAL LOCAL WEB SCREEN

The report’s detail view makes calculations reviewable. It exposes proceeds, costs, cost basis, gain, and available provenance or rule references. These references explain the draft implementation; they do not substitute for professional validation of the tax treatment.

## 03:28 — 11 · Choose settings

ACTUAL LOCAL WEB SCREEN

Settings lets the user select jurisdiction, tax year, supported calculation method, and interface language. The web interface supports Japanese and English. Choosing a method changes the calculation configuration, but does not establish that the method is appropriate for a particular filing situation.

## 03:49 — 12 · Sign out

ACTUAL LOCAL WEB SCREEN

Signing out revokes the current session through the API. The screen returns to sign-in. This action was exercised against the disposable local database. Other devices have their own sessions, and a full device-management interface remains future work.

## 04:05 — Mobile · Access and recovery

ILLUSTRATIVE MOBILE LAYOUTS · NOT DEVICE CAPTURES

The following mobile layouts are illustrations based on the implemented Expo screens, not simulator or device captures. Mobile sign-in uses the same personal session API. Credentials are stored with SecureStore. If logout is interrupted, the app persists the pending revocation and stays locked.

## 04:24 — Mobile · Four working areas

ILLUSTRATIVE MOBILE LAYOUTS · NOT DEVICE CAPTURES

The mobile app has four main areas: Report, Transactions, Import, and Corrections. Users can browse a paginated ledger, choose a CSV, inspect draft results, and review issues. Both iOS and Android JavaScript bundles build, but native binaries and device behavior have not yet been verified.

## 04:46 — Mobile · Correct and investigate

ILLUSTRATIVE MOBILE LAYOUTS · NOT DEVICE CAPTURES

Mobile also supports manual prices, total cost basis with acquisition date, and withdrawal classification or proceeds. The user reviews a correction before applying it. Source notes and undo are supported. Draft report details expose proceeds, basis, acquisition dates, source records, and rule identifiers.

## 05:09 — The complete preview journey

IMPLEMENTED FLOW · LOCAL SYNTHETIC VERIFICATION

The preview journey is sign in, import, inspect the ledger, review issues, supply corrections, and inspect the recalculated report before signing out. Automated integration tests exercise these steps against the real API handlers and an in-memory Postgres database. Device testing is a separate remaining stage.

## 05:30 — What remains before release

PLANNED / UNVERIFIED · DO NOT USE FOR TAX FILING

This is a substantial development preview, not a release-ready filing product. Remaining work includes verified identity-provider login and recovery, native builds and device testing, security review, real exchange-export validation, and professional tax review. The video captures local uncommitted work, not a deployed release.
