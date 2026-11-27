# ADR-0005: React Native (Expo) for iOS and Android — later phase

- **Status:** Accepted (implementation deferred to Phase 3)
- **Date:** 2026-10-12

## Context
Mobile is not in the MVP, but we must not paint ourselves into a corner. On mobile the
engine needs to run on-device for instant previews and offline summaries. Mobile scope is
year-round tax position, alerts, quick fixes from the fix queue, and pre-trade preview.

## Decision
- When we start mobile, we will build `apps/mobile` with **Expo (React Native)**, sharing `packages/tax-engine`, `domain`, `api-client`, and `ui` tokens.
- **Until then, these constraints apply to shared code:**
  - no DOM or Node-only APIs in `packages/tax-engine`, `domain`, `rule-packs`, `api-client`;
  - the decimal library must work in Hermes;
  - the auth design must support native flows (passkeys, OAuth PKCE, deep links).

## Consequences
- iOS and Android from one codebase, with the engine reused byte-for-byte, so mobile results match web.
- The Expo EAS build and update pipeline means no native toolchain on most developer machines.
- Some native polish costs extra (widgets, Live Activities). Expo modules can wrap native code where needed.

## Alternatives considered
- **Native Swift + Kotlin:** best platform fit, but triples UI work, and the engine would need porting or a Rust core with bindings.
- **Flutter:** good UI toolkit, but Dart means no engine sharing with the TS codebase.
- **PWA only:** weak push notifications on iOS and no store presence; can complement, not replace.
