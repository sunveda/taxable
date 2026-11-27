# ADR-0004: Next.js (App Router) for the web app

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
The web app needs:
- public SEO pages (marketing, tax guides per country: a major acquisition channel for every incumbent);
- an authenticated, data-heavy app (tables of thousands of transactions, drill-downs);
- shared components with a future React Native app.

## Decision
- We use **Next.js (App Router) with React and TypeScript** for `apps/web`.
- Marketing and guides are statically generated. The authenticated app is mostly client-rendered and talks to `apps/api` through `packages/api-client`.
- Business logic stays out of Next.js route handlers. The web app is a **client** of the same API that mobile and B2B partners use (ADR-0011).

## Consequences
- SEO and app share one codebase and one design system.
- React knowledge transfers directly to React Native (ADR-0005).
- Keeping logic in `apps/api` prevents the web from becoming a privileged backend that mobile can't match.

## Alternatives considered
- **Remix / React Router 7:** viable; Next.js has the larger ecosystem and hiring pool.
- **SvelteKit:** excellent, but no path to sharing with React Native.
- **SPA + separate static site:** two stacks for marketing and app.
