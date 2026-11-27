# ADR-0008: Arbitrary-precision decimal arithmetic; explicit rounding

- **Status:** Accepted
- **Date:** 2026-10-12

## Context
Crypto quantities run to 18 decimals (wei) and beyond. JS `number` is a 64-bit float:
`0.1 + 0.2 !== 0.3`, and integers above 2^53 lose precision. Rounding rules differ by
jurisdiction and form.

## Decision
- All quantities and monetary amounts use an **arbitrary-precision decimal type**. Candidate: `decimal.js` or `big.js`; the library is chosen in the first engine PR, subject to a Hermes compatibility check.
- The type is wrapped in our own `Quantity` and `Money` types in `packages/domain`, so the library can be swapped.
- `number` is banned for these values by lint rule and type branding.
- Values cross the API boundary as **strings**, never JSON numbers.
- **No rounding inside the engine.** Rounding happens only at the reporting boundary, with the mode and precision declared by the rule pack or form spec (e.g. whole dollars on some forms).
- `Money` always carries its currency. Mixed-currency arithmetic is a type error.

## Consequences
- Correct sums and conservation properties hold exactly.
- Slower than float math. Acceptable; profile if needed (ADR-0003 escape hatch).
- Database columns use `NUMERIC` without float conversion.
