# ADR-0010: Commander Spellbook terms, answered (DATA-02)

- **Status:** Accepted
- **Date:** 2026-08-30
- **Supersedes:** the Commander Spellbook questions in [ADR-0006](0006-data-source-terms-verification.md)

Retrieved **2026-08-30**.

## What is published

`https://commanderspellbook.com/robots.txt`, in full:

```
User-agent: *
Allow: /
Sitemap: https://commanderspellbook.com/combo-sitemap.xml
Sitemap: https://commanderspellbook.com/card-sitemap.xml
```

There is **no terms-of-service page**: `/terms` and `/api` both return `404`. The
site footer carries only the Wizards Fan Content notice and a Font Awesome
attribution — no usage restriction on the combo data itself.

They operate a dedicated bulk-data host, `json.commanderspellbook.com`, serving
`variants.json` (645 MB) and `variants.json.gz` (27.8 MB), alongside a paginated
REST API at `backend.commanderspellbook.com/variants/`.

## Decision

**Use Commander Spellbook, via the compressed bulk file.**

Be clear about what this is and is not. Unlike Scryfall ([ADR-0009](0009-scryfall-terms.md)),
there is **no explicit grant** — nobody has written "you may use this". What
exists is the absence of any prohibition, plus a `robots.txt` that allows
everything, plus a public bulk-data host that has no purpose other than
programmatic consumption. That is a weaker position than Scryfall's stated
permission and a much stronger one than EDHREC's, where the terms
[expressly forbid](0008-drop-edhrec.md) automated queries.

Note the ownership overlap, because it is easy to miss: Commander Spellbook is
operated by **Space Cow Media**, the same company as EDHREC. The two sites reach
opposite conclusions because their published terms differ, not because one is
liked better. EDHREC published a prohibition; Spellbook published an open
`robots.txt` and a bulk endpoint.

## The five questions

1. **Rate limit / crawl policy** — none published, and no `Crawl-delay`. The bulk
   file makes the question mostly moot: one request per ingest, weekly. The
   paginated API is not used.
2. **Bulk availability** — yes. `variants.json.gz`, 27.8 MB compressed, with a
   `timestamp` and `version` in the envelope. Preferred over the 645 MB
   uncompressed file and over pagination.
3. **Attribution** — nothing required in writing. Attribute anyway: combo data is
   the product's core differentiator and it is entirely their work. `LEGAL-01`
   names Commander Spellbook with a link, alongside Scryfall.
4. **Redistribution** — unaddressed either way. Treated as forbidden by default:
   combo data is cached for the app's own use and never re-served in bulk, the
   same rule AGENTS.md §5 applies to Scryfall.
5. **Card identifier** — **answered, and it is the good outcome.** Each variant's
   `uses[].card` carries an `oracleId` that is Scryfall's oracle id, so combo
   pieces map to `packages/domain`'s `OracleId` with **no name matching at all**.
   ADR-0006 flagged name-matching as the risk here; it does not arise.

## Consequences

- `ING-02` uses the compressed bulk file and maps on `oracleId` directly.
- A variant whose `uses[]` contains a card this corpus does not know **fails
  loudly** and is reported, never dropped (doc 04 §4.2, AGENTS.md §8). With
  oracle ids on both sides, an unmapped piece means a genuine corpus mismatch —
  usually that the Scryfall ingest is older than the Spellbook one — and that is
  worth surfacing rather than silently producing a combo with missing pieces.
- Because nothing is granted in writing, this is **revisitable**: if Spellbook
  later publishes terms that forbid this, the feature comes out, the way EDHREC
  did. Recording the position now means the next agent can tell the difference
  between "checked and permitted" and "nobody looked".
- A courtesy note to Spellbook saying what is being built would be reasonable and
  is not required. Not sent; it is the maintainer's call.
