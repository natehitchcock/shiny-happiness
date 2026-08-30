# ADR-0006: Data source terms — verification checklist

- **Status:** **Open — NOT VERIFIED.** Amends [ADR-0002](0002-data-sources.md).
- **Date:** 2026-08-29

## Context

[ADR-0002](0002-data-sources.md) selected the data sources on the strength of
what each is _understood_ to permit. The specifics in
[docs/04-data-sources.md](../04-data-sources.md) — rate limits, header
requirements, image licensing, attribution wording — were written from general
knowledge and have **never been checked against the sources' own documents.**

That is a real risk and it is not the kind that shows up in a test. A wrong rate
limit gets us IP-banned in production. A wrong assumption about image licensing is
a legal problem, not a bug.

### Verification attempt, 2026-08-29

Attempted and **blocked**: the environment this was authored in permits outbound
HTTPS only to package registries. `scryfall.com`, `commanderspellbook.com` and
`edhrec.com` all returned `403` from the egress proxy.

**No terms were read. Nothing in doc 04 has been confirmed.** Every number and
claim in that document should be treated as a hypothesis until the checklist below
is completed and this ADR is superseded by one recording actual answers.

## Decision

Convert `DATA-01`, `DATA-02`, `DATA-03` and `DATA-05` from "read the terms" into
the specific questions below. Each names what it gates, so an unanswered question
is a visibly blocked piece of work rather than a vague obligation.

**No code depending on an unanswered question ships to production.** Writing the
adapter is fine; deploying it publicly is not.

---

### DATA-01 · Scryfall

Sources: `scryfall.com/docs/api`, `/docs/api/bulk-data`, `/docs/terms`

| #   | Question                                                                                                                | Gates                                                                                        |
| --- | ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | Exact rate limit — requests/second and minimum delay between requests?                                                  | `RateLimiter` config in `packages/clients`; doc 04 §4.1 currently guesses 10/s and 50–100 ms |
| 2   | Required `User-Agent` format, and is a contact address expected in it?                                                  | Default headers on the Scryfall adapter                                                      |
| 3   | Bulk data file names, sizes and regeneration cadence; is there an explicit "use bulk, don't crawl" statement?           | `ING-01`; whether the nightly job is even the sanctioned approach                            |
| 4   | **What licence covers card _data_ versus card _images_, separately?** May images be cached and served from our own CDN? | `ING-04` — the entire image pipeline, and doc 04 §4.1's caching rule                         |
| 5   | Required attribution wording and placement?                                                                             | UI footer, `LEGAL-01`                                                                        |
| 6   | Any prohibition on redistributing bulk data?                                                                            | AGENTS.md §5's "never commit bulk card data" rule                                            |
| 7   | Do price fields carry separate terms or attribution?                                                                    | Whether the app shows prices at all (doc 13 `price:`, doc 05 budget)                         |

### DATA-02 · Commander Spellbook

Sources: `commanderspellbook.com`, their API/backend docs, their GitHub organisation

| #   | Question                                                                         | Gates                                                                                                                                   |
| --- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Is there a documented public API and/or a full-database export? Exact endpoints? | `ING-02`, and whether combo degree is feasible at all                                                                                   |
| 2   | Licence on the combo data                                                        | Whether we may store and serve it                                                                                                       |
| 3   | Required attribution                                                             | UI, `LEGAL-01`                                                                                                                          |
| 4   | Rate limit or fair-use statement                                                 | Shared limiter config                                                                                                                   |
| 5   | **What card identifier do they use — Scryfall `oracle_id`, or names?**           | `ING-02`'s mapping step. If names, the mapping is fuzzy and the "fail loudly on unmapped cards" rule (doc 04 §4.2) becomes load-bearing |
| 6   | Contact address for a courtesy heads-up about our usage                          | —                                                                                                                                       |

### DATA-03 · EDHREC

Sources: `edhrec.com/robots.txt`, their terms/about pages

| #   | Question                                                                           | Gates                                                                                             |
| --- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 1   | What does `robots.txt` allow and disallow, path by path? Is there a `Crawl-delay`? | Whether `ING-03` may run at all, and at what rate                                                 |
| 2   | Any stated API, data-reuse or automated-access policy?                             | Same                                                                                              |
| 3   | Contact address for a permission request                                           | The request itself, which is part of this task                                                    |
| 4   | Do they publish bracket-tagged aggregates, and at what URL shape?                  | `ING-05` core-package generation (doc 05 §5.5)                                                    |
| 5   | Are per-commander deck-archetype distributions available?                          | `API-09` archetype suggestion (doc 14 §14.3) — without this it always returns `source: 'default'` |

**Resolved by [ADR-0008](0008-drop-edhrec.md): there are no EDHREC-derived
features.** Questions 1–3 were answered on 2026-08-29 and the answer was a
prohibition, so the feature was cut rather than flagged. Read literally, the
original sentence below would have unblocked `ING-03` the moment the questions
were *answered*, regardless of what the answers said — which is exactly backwards.

> ~~**Until questions 1–3 are answered, EDHREC-derived features stay behind a config
> flag that is off by default.** Doc 05 §5.3's degradation path already makes the app
> work without them, so this costs groups 6–7 and the archetype suggestion, not the
> product.~~

### DATA-05 · Brackets and Game Changers

Source: Wizards of the Coast's official Commander brackets material.

| #   | Question                                                         | Gates                                                                                  |
| --- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 1   | Current bracket definitions and their exact allowances           | `brackets/rules.data.json`, doc 03 §3.2                                                |
| 2   | **Current Game Changers list, verbatim**                         | Same. The list has been revised since introduction; it must be fetched, never recalled |
| 3   | Is there a machine-readable canonical source, or is this manual? | The update cadence in doc 04 §4.7                                                      |

### LEGAL-01 · WotC Fan Content Policy

| #   | Question                                  | Gates                                                                           |
| --- | ----------------------------------------- | ------------------------------------------------------------------------------- |
| 1   | Required disclaimer wording and placement | Site footer                                                                     |
| 2   | Monetisation restrictions                 | Any future business model                                                       |
| 3   | Trademark and naming restrictions         | **The project's name** — `Roundtable` is a placeholder and has not been cleared |

---

## Consequences

- Doc 04's specifics remain **unverified**. It should be read as intent, not as
  fact, until this is closed out.
- The work is small — an afternoon with a browser — but it cannot be done from a
  sandboxed environment, and it cannot be done from memory. Anyone completing it
  should record **quoted wording and a retrieval date**, then supersede this ADR.
- The single highest-risk unknown is **Scryfall question 4** (image licensing). It
  gates `ING-04`, and getting it wrong is the failure mode with consequences
  outside the codebase.

## Alternatives considered

- **Writing the specifics from general knowledge and moving on.** This is what
  doc 04 currently does, and the reason this ADR exists: it produces a document
  that reads as authoritative while being unchecked. Rejected — the confident
  wrong answer is the dangerous one.
- **Deferring until implementation.** `ING-01` cannot be written correctly without
  answers to Scryfall 1–3, and would be written against guesses. The questions are
  cheap to answer now and expensive to discover later.
