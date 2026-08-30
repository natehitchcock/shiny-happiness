# ADR-0008: Do not query EDHREC

- **Status:** Accepted
- **Date:** 2026-08-29
- **Supersedes:** the EDHREC portions of [ADR-0002](0002-data-sources.md) and
  [ADR-0006](0006-data-source-terms-verification.md)

## Context

`DATA-03` existed to read EDHREC's terms and ask permission. The terms were read
on 2026-08-29 and the questions are answered — the answer is a prohibition.

From `https://edhrec.com/terms` (effective 2024-08-06, Space Cow Media),
retrieved 2026-08-29:

> "Subject to these Terms, Company grants you a non-transferable, non-exclusive,
> revocable, limited license to access the Site solely for your own personal,
> noncommercial use."

> "you agree not to: … (vi) use software or automated agents or scripts to
> produce multiple accounts on the Site, or to generate automated searches,
> requests, or queries to the Site."

> "(c) you shall not access the Site in order to build a similar or competitive
> website; and (d) except as expressly stated herein, no part of the Site may be
> copied, reproduced, distributed, republished, downloaded, displayed, posted or
> transmitted in any form or by any means"

`https://edhrec.com/robots.txt` (retrieved 2026-08-29) disallows only
`/articles/preview/`, `/articles/search/`, `/deckpreview/` and
`/puzzlebookvegas/`, and sets no `Crawl-delay`. **`robots.txt` and the Terms of
Use disagree, and the Terms are the binding half.** Doc 04 §4.3 previously said
EDHREC could be used "to the extent their terms and `robots.txt` allow", which
read as though the two agreed.

The alternatives were checked the same day and are not alternatives:

- **Archidekt** (`https://archidekt.com/terms`, effective 2018-09-07) carries the
  **identical boilerplate** — the same personal/noncommercial licence, the same
  "automated searches, requests, or queries" prohibition, the same
  "similar or competitive website" clause, word for word.
- **Moxfield** was already out of scope (doc 04 §4.4); its terms page returns
  `403` to a plain request.
- **Deckstats** serves a Cloudflare challenge for `robots.txt` itself.

This is not bad luck. EDHREC's own corpus comes from Archidekt and Moxfield, so
the aggregated-decklist data sits behind one door with one lock.

## Decision

**The project does not query EDHREC, and does not query Archidekt, Moxfield or
Deckstats.** No permission request is sent, because permission is not the
blocker — a "yes" from EDHREC would not convey rights in the underlying
decklists, which are not theirs to grant.

`ING-03` is **cut**, not deferred.

**Scryfall data is fine to use in full**, under its own terms:

> "As part of the Wizards of the Coast Fan Content Policy, Scryfall provides our
> card data and image database free of charge for the primary purpose of creating
> additional Magic software"
> — `https://scryfall.com/docs/api`, retrieved 2026-08-29

That includes **`Card.edhrecRank`**, which is a field of Scryfall's card data.
Reading it is not querying EDHREC. It is retained deliberately as the project's
popularity signal and remains the tie-break in scoring (doc 05 §5.6).

## What replaces the statistics

1. **Composition and archetype targets** stay the seed vectors already in
   `packages/domain/src/archetype-targets.ts`. Their comment said they were "to
   be REPLACED by percentiles derived from EDHREC averages"; they are now the
   source of truth, refined from the project's own corpus rather than a
   third party's.
2. **Core packages (`ING-05`)** are built from **MTGJSON**, which is free and
   open source under the **MIT License** and publishes official Wizards
   decklists — 192 Commander decks as of `DeckList.json` v5.3.0 (2026-08-28) —
   plus curation. Smaller and less current than a scraped corpus, and licensed
   without ambiguity.
3. **The project's own corpus** is the long-term answer. `DOM-07` already parses
   decklists and `API-04`/`WEB-22` import them. Decks a user imports into their
   own tool are the project's data, they grow over time, and they need nobody's
   terms. Inclusion and synergy statistics come back this way or not at all.

## Consequences

- **Groups 6–7** (`top-<type>`, `high-synergy`, doc 05 §5.3) have no data source
  at launch. The degradation path doc 04 already required is now the *normal*
  path, not the fallback: recommendations are combo-, role- and archetype-driven.
  Pillar P4 is unaffected — those reasons are non-empty on their own, and
  `recommend.test.ts` already covers `stats: null`.
- **`API-09`** honestly returns `source: 'default'` until the project's corpus is
  large enough to say otherwise. Doc 14 §14.3 already required the UI to present a
  default as a fallback rather than implying data backing.
- **Contract change (AGENTS.md R2).** Three exported names in `packages/domain`
  named a source the project will never query, and a name that lies is worse than
  no name — the next agent would wire them straight back to EDHREC. They are
  renamed to describe the statistic rather than its former supplier:

  | Was | Is |
  | --- | --- |
  | `Reason` kind `'edhrec-inclusion'` | `'corpus-inclusion'` |
  | `Recommendation.edhrecInclusion` | `Recommendation.inclusionShare` |
  | `Recommendation.edhrecSynergy` | `Recommendation.synergyScore` |

  `Card.edhrecRank` keeps its name: it is Scryfall's field name for Scryfall's
  data, and renaming it would obscure where it comes from (AGENTS.md §7 — name
  things as the domain names them).
- **Nothing is blocked on a third party any more.** `DATA-01` (Scryfall) and
  `DATA-02` (Spellbook) remain, and both publish usable terms. The deployment
  blocker that ADR-0006 described for EDHREC is gone because the dependency is
  gone.

## Alternatives considered

- **Ask for permission anyway.** Rejected. It was drafted and not sent. Even a
  yes leaves the licence chain problem — EDHREC redistributes Archidekt and
  Moxfield decklists, and cannot grant rights in them — so the permission
  obtained would not be the permission needed.
- **Use the undocumented `json.edhrec.com` endpoints.** Rejected outright. They
  return `200` without authentication and serve no `robots.txt` at all (`403`,
  S3 `AccessDenied`), which makes them convenient and no less covered by the
  Acceptable Use Policy. Convenience is not permission.
- **Scrape and cache aggressively, treating robots.txt as the standard.**
  Rejected. `robots.txt` is not the licence, and the Terms are unambiguous.
- **Drop popularity signals entirely, including `edhrecRank`.** Rejected as
  needless: it arrives inside Scryfall's bulk data under Scryfall's terms, and
  discarding it would cost the only stable ordering signal for no gain.
