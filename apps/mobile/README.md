# apps/mobile (reserved)

The iOS and Android app will live here. It will be an Expo (React Native) app that reuses
`@svdt/tax-engine`, `@svdt/domain`, and `@svdt/rule-packs` unchanged, so results match
the web app exactly. See [ADR-0005](../../docs/adr/0005-react-native-expo-for-mobile.md).

Constraints that shared packages must already respect:

- no DOM or Node-only APIs in engine, domain, or rule packs (enforced by ESLint);
- dependencies must run on Hermes (`decimal.js` does).
