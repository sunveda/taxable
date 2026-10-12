# svdt-cloud

**The crypto tax engine you can actually check.**

svdt-cloud computes crypto capital gains and income, **explains every number** back to the
transaction that caused it, and **ranks the fixes that actually change your tax bill**.
One engine serves:

- **Consumers:** web app first; iOS and Android later.
- **Platforms:** exchanges, brokers, and wallets, via a Tax API, an embeddable tax center, and 1099-DA / DAC8 / CARF reporting.

> Status: **pre-code.** The research, specs, and architecture decisions live in [`docs/`](./docs/README.md).

## Start here
1. [Gap analysis](./docs/research/gap-analysis.md): why this product, and where incumbents fall short
2. [Product spec](./docs/spec/product-spec.md): what we're building, and in which phase
3. [ADR index](./docs/adr/README.md): key technical decisions

## Planned repository layout
See [ADR-0002](./docs/adr/0002-monorepo-structure.md).

```
apps/      web (Next.js) · api · worker · mobile (Expo, later)
packages/  tax-engine · rule-packs · domain · importers · api-client · ui · config
docs/      research · spec · adr
```

## Disclaimer
Nothing in this repository is tax or legal advice. Rule packs must be reviewed by a
qualified tax professional before production use.
