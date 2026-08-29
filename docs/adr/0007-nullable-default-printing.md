# ADR-0007: `Card.defaultPrinting` is nullable

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

`Card.defaultPrinting` was typed `PrintingId`, non-nullable. But cards and
printings are ingested by separate jobs — `ING-01` loads oracle-level card data,
`ING-04` loads and caches imagery — so there is a real window in which a card
exists with no printing resolved.

The repository was papering over this by coercing SQL `NULL` to `''` and branding
it as a `PrintingId`. That produces an id that is not an id: the first lookup
using it fails with Postgres `22P02` (invalid uuid syntax), far from the code that
invented it.

## Decision

`Card.defaultPrinting` becomes `PrintingId | null`.

Doc 02 §2.1 already says the deck references oracle identity and "the UI resolves
a printing only when it needs pixels or a price" — a card without imagery yet is a
normal state, not an error, and the type should say so.

## Consequences

- This is a `packages/domain` contract change (R2), which is why it is an ADR.
  Every consumer that reaches for a printing must now handle its absence — which
  is the point: a card mid-ingest has no printing, and the compiler should insist
  the UI has a fallback.
- The repository stops fabricating ids. A `NULL` column maps to `null`.
- Card-art placeholders in the UI become a requirement rather than an oversight.

## Alternatives considered

- **Make the column `NOT NULL`.** Would force `ING-01` to resolve printings before
  writing any card, coupling two ingest jobs that are deliberately independent
  and can fail separately.
- **Keep the coercion and treat `''` as "none".** A sentinel that is invalid in
  the column's own type, checked nowhere, and fails at the point of use rather
  than the point of creation. Rejected.
