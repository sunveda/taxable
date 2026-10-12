# svdt-cloud

**The crypto tax engine you can actually check.**

svdt-cloud computes crypto capital gains and income, **explains every number** back to the
transaction that caused it, and **ranks the fixes that actually change your tax bill**.
One engine serves:

- **Consumers:** web app first; iOS and Android later.
- **Platforms:** exchanges, brokers, and wallets, via a Tax API, an embeddable tax center, and 1099-DA / DAC8 / CARF reporting.

Launch jurisdictions: **United States** and **Japan**
([ADR-0013](./docs/adr/0013-launch-jurisdiction.md), [ADR-0015](./docs/adr/0015-japan-second-jurisdiction.md)).

## Start here

1. [Gap analysis](./docs/research/gap-analysis.md): why this product, and where incumbents fall short
2. [Product spec](./docs/spec/product-spec.md): what we're building, and in which phase
3. [Tax engine spec](./docs/spec/tax-engine-spec.md): how the numbers are computed; §13 shows what's implemented
4. [Architecture diagrams](./docs/architecture/README.md): context, components, and flows
5. [ADR index](./docs/adr/README.md): key technical decisions

## Repository layout

See [ADR-0002](./docs/adr/0002-monorepo-structure.md) and [ADR-0016](./docs/adr/0016-tooling-baseline.md).

```
apps/
  web/          Next.js app (currently a demo page that runs the engine on sample data)
  api/          HTTP API (Hono, OpenAPI 3.1): imports, events, overrides, calculations
  mobile/       reserved for the Expo iOS/Android app
packages/
  domain/       shared types: ledger events, Decimal, time zones
  rule-packs/   jurisdiction rules as cited data: us, jp
  importers/    CSV importers (Coinbase, Kraken, bitFlyer, Coincheck, canonical) + transfer matching
  tax-engine/   pure, deterministic calculation engine + golden and property tests
  db/           Postgres schema, SQL migrations, row-level security, data access
  config/       shared tsconfig
docs/           research · spec · adr
```

## Development

Requires Node 22 and pnpm 10 (`corepack enable`).

```sh
pnpm install
pnpm test        # unit, golden-scenario and property tests
pnpm lint        # includes platform-neutral/determinism guardrails for shared packages
pnpm typecheck
pnpm build
pnpm --filter @svdt/web dev   # http://localhost:3000
```

### API

Without `DATABASE_URL`, the API uses an embedded Postgres (PGlite) in `apps/api/.data/`, so no
database server is needed locally. Tests use an in-memory one.

```sh
pnpm --filter @svdt/api create-key -- --name local   # prints an API key once
pnpm --filter @svdt/api dev                          # http://localhost:8787/v1/openapi.json
```

With `DATABASE_URL=postgres://…` (e.g. Neon from the Vercel Marketplace), run
`pnpm --filter @svdt/api migrate` first. Then, for example:

```sh
curl -X POST localhost:8787/v1/users -H "authorization: Bearer $KEY" -H 'content-type: application/json' -d '{}'
curl -X POST "localhost:8787/v1/users/$USER/imports?account=coinbase" -H "authorization: Bearer $KEY" \
  -H 'content-type: text/csv' --data-binary @export.csv
curl -X POST localhost:8787/v1/users/$USER/calculations -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' -d '{"jurisdiction":"us","taxYear":2025}'
```

## Disclaimer

Nothing in this repository is tax or legal advice. Every rule in `packages/rule-packs` is
marked `draft` until reviewed by a qualified tax professional for that jurisdiction.
