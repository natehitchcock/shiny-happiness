# 4. Data sources

This document is binding. Network access to third parties is a legal and
reputational surface, not just an engineering one. Every rule here exists because
the alternative gets the project blocked or sued.

> ⚠️ **The specifics below are UNVERIFIED.** Rate limits, header requirements,
> image licensing and attribution wording were written from general knowledge and
> have not been checked against any source's own documents — an attempt on
> 2026-08-29 was blocked by network policy. Read this document as _intent_, and
> see [ADR-0006](adr/0006-data-source-terms-verification.md) for the exact
> questions each source still owes an answer to, and what each one gates. No code
> depending on an unanswered question ships to production.

## 4.0 The one architectural rule

**All third-party access goes through `packages/clients`.** No `fetch` to an
external host from `apps/web`, `apps/api` or `packages/domain`. Ever. Each source
is one adapter behind a narrow interface, and every adapter shares one rate
limiter and one on-disk cache. This is what makes it possible to swap a source
out when — not if — one of them changes its terms.

```ts
interface CardSource {
  getBulkCards(): AsyncIterable<Card>
}
interface ComboSource {
  getAllCombos(): Promise<Combo[]>
}
interface StatsSource {
  getCommanderStats(c: OracleId): Promise<CommanderStats>
}
interface DeckImporter {
  canHandle(url: string): boolean
  import(url: string): Promise<ImportedDeck>
}
```

## 4.1 Scryfall — cards, images, legality. **Primary. Use it.**

Scryfall is the canonical MTG card database and has a documented public REST API
plus **bulk data files** (all cards as one JSON download, regenerated daily).

**Rules for this project:**

- **Use bulk data, not the search API, for ingestion.** Scryfall explicitly asks
  that programs needing lots of card data download the bulk files rather than
  crawling the API. Pull `oracle_cards` (one entry per oracle id — matches our
  domain model) nightly. `default_cards` only if printing-level data is needed.
- **Rate limit anything else** to roughly 10 requests/second with a 50–100 ms
  delay between calls, single-flight. The shared limiter in `packages/clients`
  enforces this globally; adapters may not bypass it.
- **Send a descriptive `User-Agent` and an `Accept` header.** Anonymous or
  spoofed agents get blocked, correctly.
- **Do not hotlink images at scale.** Fetch once, cache to our own object store,
  serve from our CDN with the correct attribution. Respect their image URLs'
  cache lifetimes and never rewrite them into our own hostname without caching.
- **Do not redistribute** bulk card data or images as a dataset of our own.

**Card images are copyright Wizards of the Coast**, not Scryfall's to license.
Displaying them in a fan tool is customary, but it is governed by the WotC Fan
Content Policy — see §4.6.

Task `DATA-01` owns re-reading the current Scryfall API documentation and terms
before first ingest and recording the specifics in an ADR. The numbers above are
the shape of the constraint; the doc is the authority.

## 4.2 Commander Spellbook — combos. **Primary. Use it.**

This is the right source for combo data and it is what makes the core feature of
this app possible. Commander Spellbook is a community-maintained database of MTG
combos with a public API and full-database export, structured as
_(cards, prerequisites, steps, results)_ — which is exactly our `Combo` shape.

**Do not attempt to derive combos from EDHREC synergy scores or from oracle text.**
Synergy is not combo-hood, and text parsing cannot find "these three permanents
loop". Every combo-degree feature in this app depends on Spellbook's structured
data.

- Ingest the full combo database on a schedule (daily is ample; combos change
  slowly).
- Index by oracle id → combos containing it. This index is the hot path for
  `comboDegree`; it must be in memory or in Postgres with a GIN index, not
  recomputed per request.
- Map Spellbook card identifiers to Scryfall `oracle_id` at ingest time and
  **fail loudly on unmapped cards** rather than silently dropping combos. A
  silently dropped combo is an invisible wrong answer.
- Check their terms and attribute them visibly in the UI. Ask before heavy use;
  they are a small volunteer project and have been receptive to tools that credit
  them.

## 4.3 EDHREC — statistics and recommendations. **Use with care.**

EDHREC aggregates public decklists into per-commander statistics: inclusion rate,
synergy score, top cards by type, and average deck composition. This is the source
for the "top ten sorceries" style groups and, critically, for **deck composition
targets** (§5.4) — the land/ramp/interaction counts.

**Be clear-eyed about the situation:** EDHREC has no official, documented public
API. The JSON endpoints that back their pages are undocumented, unversioned, and
may be used without permission only to the extent their terms and `robots.txt`
allow. They can change or disappear without notice.

**Rules:**

- Read `robots.txt` at ingest time and honour it programmatically, not just at
  review time.
- Cache hard. Per-commander statistics change slowly; a 24-hour TTL minimum, and
  serve stale on error rather than re-fetching.
- One request at a time, generous delay, descriptive User-Agent with a contact
  address. Never parallelise across commanders.
- Fetch **on demand per commander the user actually opens**, plus a warm cache for
  popular commanders. Do not crawl the site.
- The `StatsSource` interface must be satisfiable by a fallback that returns
  "no statistics available" so the app degrades to combo-only recommendations
  instead of breaking.

Task `DATA-03`: **contact EDHREC and ask for permission or a data arrangement
before launch.** This is the correct move and costs one email. Until it is
answered, EDHREC-derived features stay behind a config flag and are not deployed
publicly.

## 4.4 Moxfield — out of scope

**Decision: not pursued.** Moxfield restricts automated access and their API is
not public. Rather than build on access we do not have, the need it was meant to
serve is covered elsewhere:

- _"Get my existing deck in"_ → user-pasted decklist text or file upload (§4.4.1).
  Works for Moxfield, Archidekt, TappedOut and MTGO exports alike, touches no
  third-party server, and is strictly more useful.
- _"Bracket × colour card statistics"_ → EDHREC aggregates (§4.3) plus our own
  corpus (§4.5).

`DeckImporter` keeps a URL-import seam so the door stays open, and
`/api/v1/import/url` returns `501` with a problem document pointing at text
import. No agent should spend time here.

### 4.4.1 Decklist text import

The actual import path. Parse the common export formats:

```
1 Sol Ring
1x Sol Ring (C21) 263
SORCERY (12)
1 Rhystic Study *CMDR*
// Maybeboard
```

Handle: quantity prefixes with and without `x`, set/collector annotations,
category headers, commander markers, sideboard/maybeboard sections, split-card
names (`Fire // Ice`), and accented card names. Resolve by name against the card
database with fuzzy fallback. **Report unresolved lines; never fail the whole
import** — bring in what parsed and let the user fix the rest in place.

## 4.5 Our own corpus

Every deck built or imported in the app is a data point we own outright. Over
time this is the most valuable and least legally fraught statistics source, and it
is the only one that can be tuned to our own bracket definitions. Design the stats
layer so our corpus can be blended in from day one, weighted low until it has
volume.

Anonymise before aggregating; never surface another user's deck.

## 4.6 Fan content compliance

Non-negotiable before any public deployment (task `LEGAL-01`):

- Comply with the current **Wizards of the Coast Fan Content Policy**: unofficial
  fan content, no claim of affiliation, required disclaimer, restrictions on
  monetisation.
- Attribute Scryfall, Commander Spellbook and EDHREC visibly, with links.
- Do not use WotC or Scryfall trademarks in the product name or logo. (Another
  reason `Roundtable` is a placeholder — check it too.)
- Serve card images only in the context of the tool; do not expose a bare image
  proxy that acts as a general-purpose CDN for MTG art.

## 4.7 Ingestion schedule

| Job                   | Source                          | Cadence         | Failure mode                |
| --------------------- | ------------------------------- | --------------- | --------------------------- |
| `ingest:cards`        | Scryfall bulk `oracle_cards`    | Daily           | Serve previous snapshot     |
| `ingest:combos`       | Commander Spellbook export      | Daily           | Serve previous snapshot     |
| `ingest:brackets`     | WotC bracket/Game Changers list | Weekly + manual | Serve checked-in file       |
| `warm:stats`          | EDHREC, top ~500 commanders     | Weekly, slow    | Feature degrades, app works |
| `build:core-packages` | Internal, from stats corpus     | On stats change | Serve previous version      |

Ingestion is **snapshot-and-swap**, never in-place mutation: build the new dataset
alongside the live one and flip a pointer. A half-ingested card database that the
recommendation engine reads from is worse than a stale one.
