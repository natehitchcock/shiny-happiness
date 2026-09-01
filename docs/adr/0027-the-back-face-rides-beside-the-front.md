# 27. The back face rides beside the front, and absence means one face

Date: 2026-09-01

## Status

Accepted.

> **Number 0027 was assigned to this work before it started.** 0026 is the focus
> guarantee and 0028 is the suggestion sort; both were written the same week.
> Agents have twice collided by scanning `docs/adr/` for "the next free number"
> and both taking it. Ask for a number; do not derive one.

## Context

The user asked for a card flip button for double-faced cards. There is nothing
to flip to: the corpus has never stored the back face's art.

That was a decision, not an oversight, and it was written down in
`packages/clients/src/scryfall.ts`:

> The BACK face's art is deliberately NOT carried. `Card.oracleTextFaces` is the
> precedent for per-face data, but it earned its place: `OracleText` draws both
> faces' rules, so there is a reader. Nothing reads a back image — `imageFor(card,
> level)` picks one asset from a single `{artCrop, normal}` pair and there is no
> flip affordance anywhere in the UI. Adding it would cost two `Printing` fields,
> two columns and a migration, a wire-contract change on `/cards/batch`, and would
> feed nobody. **It belongs with the flip control, not before it.**

The condition that docblock named is now met. The cost it priced — two fields,
two columns, a migration, a contract change — is the cost paid here, and the
docblock has been rewritten so it no longer asserts a decision the code stopped
following.

What the same file already established, and this ADR does not re-derive:

- Scryfall puts `image_uris` on the **card** for anything printed on one
  physical face — ordinary, split, adventure and flip cards. `transform` and
  `modal_dfc` have two physical faces and put images **only** on `card_faces[]`.
- 501 of the corpus's 890 `//` cards are `transform` (401) or `modal_dfc` (100);
  all 501 carry `normal` and `art_crop` on face 0, and none has a card-level
  `image_uris`.
- `Fire // Ice` is the counter-example that fixes the shape: a split card **does**
  have top-level art, so a blanket "read the face" breaks cards already right.

## Decision

### 1. The front does not move

`Printing.imageUris`, `printings.image_art_crop` / `image_normal`, and the
top-level `artCrop` / `normal` of every `ImageMap` entry keep their exact
present meaning: the **front** face. The front is the card — the side that
enters the battlefield, the side Scryfall names and sorts by, and the side a
tile, the detail panel and the deck-web crop must draw. Every existing reader
keeps reading it and no existing test changed.

The back is carried **beside** the front, never in place of it, and never on the
domain `Card`: an image belongs to a printing and a `Card` is oracle identity
(doc 02 §2.1). That is the arrangement `prices` and `images` already have.

### 2. Absence means one physical face

This is the load-bearing decision, and everything below is a consequence of it.

There are **three** states, not two:

| State | Meaning | Flip control draws |
| --- | --- | --- |
| absent | The card has one physical face. | No button. |
| present, art resolved | Two faces, and we have the picture. | A button, and the picture. |
| present, art missing | Two faces, no picture. | A button, over the fallback panel. |

The second and third are both "there is a second side". A design that spelled
absence and missing-art the same way would make a `transform` card whose image
failed to resolve indistinguishable from Sol Ring, and the flip control could
never tell "no second side" from "second side, no picture".

The concrete shapes:

- **Domain** — `Printing.backImageUris?: { artCrop: string; normal: string }`.
  Optional, matching `Card.oracleTextFaces`, the existing precedent for per-face
  data: absence is the right shape for "there is none" *and* for "ingested
  before this field existed". `''` inside a present pair is "art unresolved",
  the same spelling `imageUris` already uses.
- **Schema** — `printings.image_back_art_crop` and `printings.image_back_normal`
  (migration 0016), both nullable, no default, plus
  `CHECK ((image_back_art_crop IS NULL) = (image_back_normal IS NULL))`. Both
  NULL is "one face"; both set is "there is a back", with `''` for an unresolved
  asset. The constraint is what makes the encoding a fact the database enforces
  rather than a convention someone has to be told.
- **Wire** — each `ImageMap` entry gains an optional `back` member:
  `{ artCrop: string | null; normal: string | null }`. Absent for a single-faced
  card; present with nulls for a two-faced card whose art is unresolved. Card
  detail carries `backImageUris` on each `Printing` row it already sends.

Adding an optional field is not a breaking change (AGENTS.md R2), so this ADR
records a *shape* rather than announcing a break. Doc 10 §10.2 is updated in the
same change.

### 3. The LAYOUT decides whether there is a back; the URLs only fill it in

`TWO_FACED_LAYOUTS` is `transform`, `modal_dfc`, `reversible_card`.

The tempting one-liner was `card_faces[1]?.image_uris !== undefined`. It is right
about every card in the corpus today and is still the wrong rule, because it
collapses states one and three from the table above: a two-faced card with no
resolved art would read as single-faced. Making the layout the structural fact
and the URLs the content is what keeps three states three.

Reading `card_faces[1]` blindly is worse again: `Fire // Ice`,
`Bonecrusher Giant // Stomp` and every flip card have two entries there, and they
are two **halves** of one piece of cardboard. Offering to flip one would be
offering to show its own right-hand side.

`meld` is deliberately excluded, and was checked rather than assumed because meld
backs were false positives in the commander-eligibility bug. They are not one
here, for a structural reason: a meld piece and the meld result are three
**separate** Scryfall records, each with one physical face and its own top-level
`image_uris`. `Brisela, Voice of Nightmares` has no `card_faces` at all. It is
the back of nothing — it is its own card.

`double_faced_token` is absent because `NON_PLAYABLE_LAYOUTS` already stops those
records before `toPrinting` runs; listing it would be a branch no data reaches.

If Wizards invents a fourth two-faced layout, its cards read as single-faced
until the set is updated: no art, no flip button, nothing broken. That is the
safe direction to fail in, and it is why the list is acceptable as a list.

## Consequences

- **A re-ingest is required before anything is visible.** The URLs are not
  derivable from data already in the database — they are read off
  `card_faces[1].image_uris` in the Scryfall bulk export — so no SQL backfill can
  produce them. `printings` rows written before this migration correctly report
  "one physical face" for every card until the next card ingest rewrites them.
- **Every printing row grows by two columns.** Only the ~1.5% of printings with
  two faces store anything in them; the rest are NULL, which is why the columns
  are nullable rather than `DEFAULT ''`.
- **`printingFactsForAll` returns slightly more.** The two columns join through
  `cards.default_printing` alongside the front pair that is already there, so
  there is no new join and no new query — and the result is cached per snapshot
  by `cachedPrintingFacts`, so the cost is paid once per ingest and not per
  request.
- **`/cards/batch` payloads grow only for two-faced cards.** This is the direct
  consequence of absence-means-one-face: a design with `back: null` on every
  entry would have added two members per card to the route the client calls at
  least twice per user action, for the 98.5% of cards that have nothing to say.
- **The down migration loses data.** Nothing else in the schema records which
  cards have a back face — `oracle_text_faces` counts halves, not faces — so
  going down means a re-ingest to get it back. That is stated in
  `0016_back_face_art.down.sql` rather than left to be discovered.
- **ADR-0021 is unchanged.** These are Scryfall's own CDN URLs, sent through
  unaltered, exactly as the front pair is. `ING-04` — whether this project may
  re-serve and resize Scryfall's image files — is untouched and still gated.
