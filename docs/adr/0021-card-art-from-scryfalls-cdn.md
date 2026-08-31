# ADR-0021: Card art is referenced from Scryfall's CDN, not re-served from ours

- **Status:** Accepted
- **Date:** 2026-08-30
- **Relates to:** [ADR-0009](0009-scryfall-terms.md) Q4 and the `ING-04` gate it
  leaves open; [ADR-0015](0015-drawn-mana-symbols.md), which met the same gate
  and went the other way for a different asset
- **Diverges from:** [doc 04](../04-data-sources.md) §4.1, "do not hotlink
  images at scale", and doc 07 §7.3's three-size pipeline

## Context

The app has never shown a card picture. Not because the data is missing — the
ingest populated `printings.image_art_crop` and `printings.image_normal` for
109,184 of 110,577 printings, and 33,991 of 34,492 cards reach art through
`cards.default_printing` — and not because the components are missing:
`Tile`, `CardFace` and `Detail` in `packages/ui` have read `card.imageUris`
since `UI-01`, fallback included.

The URLs simply never left the server. `GET /cards/batch` returns domain
`Card`s, and a `Card` deliberately carries no image URL because an image belongs
to a printing (doc 02 §2.1). So four build sessions produced a deck builder in
which every card is a line of text.

The reason nobody fixed it is that the obvious fix is gated. Doc 04 §4.1 says:

> "**Do not hotlink images at scale.** Fetch once, cache to our own object
> store, serve from our CDN with the correct attribution."

and doc 07 §7.3 wants "three asset sizes (pip = none, art crop, full card)".
That is `ING-04`, and ADR-0009 Q4 stops it:

> "Re-serving images from our CDN sits close to 'proxy Scryfall data', and
> resizing sits close to 'distort'. … **`ING-04` should not ship a three-size
> pipeline without confirming this with Scryfall.**"

So the state of play was: the version doc 04 prefers cannot ship without a
conversation nobody has had, and in the meantime the product shows no art at
all. That is the worst of both — no performance benefit, no imagery, and no
progress on the question.

## The decision

**Reference Scryfall's own CDN URLs directly, at the sizes Scryfall publishes.**

Concretely, and these are the whole of it:

- The API sends the stored `art_crop` and `normal` URLs unchanged, on
  `cards.scryfall.io`. Nothing is rewritten into our own hostname, nothing is
  proxied, nothing is cached in an object store of ours.
- The two sizes used are the two Scryfall publishes and we already store. No
  third size is derived, no image is re-encoded, and no `width`/`height` pair is
  ever set to anything but the asset's own proportion.
- No CSS filter, no `opacity` fade, no blur-up placeholder, no watermark, badge
  or logo drawn **over** the art. Badges in `CardFace` sit in a row beneath the
  frame; the combo badge and role dot in `Tile` sit over the art crop, which is
  a crop Scryfall itself publishes for that purpose and carries no copyright
  line or artist credit to cover.
- The artist name and copyright line are part of the card face, so at `normal`
  they are present and uncovered wherever the full card is drawn. Stated
  precisely, because ADR-0009's wording is precise: the constraint is not to
  "cover, crop, or clip off" them, and nothing here does. The rendered card is
  smaller than the asset — 160 px in the analysis rail, 220 px on a phone sheet
  — at which the credit line is small, exactly as it is in Scryfall's own search
  grid. Whole card, unaltered proportion, nothing drawn over it.

This is what ADR-0009 Q4 calls the safe reading, minus the part it gates:
"cache for performance, serve at the aspect ratio Scryfall provides, never
re-encode in a way that alters the art". We do not cache and we do not serve, so
the two clauses that sit "close to proxying" and "close to distorting" are not
engaged at all. Every image request goes to the origin whose terms grant it,
from a browser, exactly as it would if the user visited Scryfall.

The rate-limit position is also better than the alternative, not worse.
ADR-0009 Q1 quotes Scryfall directly:

> "The direct file origins located at \*.scryfall.io do not have rate limits."

## What this costs, stated plainly

**Doc 04 §4.1's "no client request ever hits a third-party image host" no longer
holds, and this ADR is the record of that.** It was a performance preference and
a privacy-adjacent one — it keeps our users' IP addresses off Scryfall's logs
and puts image latency under our control. Both are real. Neither is a licensing
constraint, and the user has approved the trade in exchange for shipping
imagery now rather than after a conversation with a third party.

What is deferred with it:

- Latency and availability are Scryfall's. A slow or unreachable CDN is a page
  with grey card frames on it. The frames are reserved and labelled, so it
  degrades to the no-art rendering rather than to a broken layout.
- Our users' browsers appear in Scryfall's logs. Not personal data of ours to
  give away, but not nothing either.
- No `avif`/`webp` negotiation, no per-viewport sizing, no long-lived immutable
  cache headers of our own choosing.

**`ING-04` is not unblocked, closed, or answered by this.** Its question — may
this project re-serve and resize Scryfall's image files from its own store — is
untouched, and the moment anyone wants the caching layer doc 04 describes, the
conversation with Scryfall is still the first step. This ADR is deliberately the
version that needs no such conversation. ADR-0015 reached the same gate for mana
symbols and took the option that needed no third-party asset at all; this one
takes the option that needs no re-serving. Same gate, two different sides of it,
both leaving `ING-04` where it was.

## Where the art is drawn, and where it is not

The decision that matters as much as the terms one. Art is not free: every
picture is a request, a decode and a row of space, and a list that gets three
times longer to scroll has been made worse, not better.

**Drawn:**

- **The preview panel**, at `normal` through `CardFace`. One card, and the
  surface where somebody decides whether this is the Krenko they meant — a
  question half-answered by looking. When the card has no art the face is
  omitted entirely rather than falling back: the primitive's fallback panel
  repeats the name, cost, type line and rules text, which is right in a grid and
  redundant inside a panel that already says all four.
- **The chosen commander on the start screen**, at `normal` through `CardFace`.
  "Krenko" is four different legends and "Kenrith" is two, and every screen after
  this one assumes the right one was picked. Here the no-art fallback IS wanted,
  because nothing else on that screen describes the card.
- **The `#gallery` page**, where three of six fixtures now carry real URLs so
  both the art path and the no-art fallback can be looked at by a person.

**Not drawn, deliberately:**

- **The deck rail.** Around a hundred rows, read by name under a section
  heading. A thumbnail per row triples the scroll length and answers no question
  anyone asks of that list.
- **The suggestion feed.** Same shape, and worse: the rows already carry a combo
  badge, a type line, reason chips, column cells, a cost and two buttons. The
  decision surface for a suggestion is the preview, which is one click away and
  has the picture in it.
- **The commander search results.** Up to eight rows, distinguished by the name
  the reader just typed. Art earns its space at the moment the choice is made,
  not while it is being made.

`presentation.ts` remains the authority on which asset a level loads, and
`imageFor(card, level)` is now the only way to ask. A component reading
`imageUris.artCrop` by hand was a second copy of doc 07 §7.3's "never load a
full card image to render an L1 tile".

## Consequences

- `POST /cards/batch` and `GET /cards/search` gain an `images` map beside
  `items` and `prices` — a printing-level fact returned alongside oracle-level
  cards, which is the arrangement `prices` has had since API-01. `Card` is
  unchanged, so this is an additive field and not a contract change (AGENTS.md
  R2). Doc 10 §10.2 is updated in the same change.
- `printingFactsForAll` carries the URLs, so they are cached per snapshot with
  everything else that map holds. Measured against the real corpus this takes
  the read from 4.28 MB to 12.05 MB and 149 ms to 201 ms, once per snapshot per
  warm instance. The alternative — a per-request lookup for the ≤500 ids a
  batch asks about — is a smaller read but a recurring one on the route the
  client calls at least twice per user action, and a second per-request database
  read is the shape that exhausted the transfer allowance and took the
  deployment down (see `apps/api/src/corpus-cache.ts`).
- The price and the image in that map come from **different printings on
  purpose**: the cheapest for the price, because that is what acquiring the card
  costs, and `cards.default_printing` for the art, because that is which card it
  is. They disagree for 10,042 of 34,492 cards, so this is not a distinction
  without a difference.
- Every image is `loading="lazy"` and `decoding="async"`, and every frame states
  its box before the art lands. A deck list is around a hundred images and a
  list that reflows as they stream in is unusable while it loads.
- Nothing animates, so there is nothing for `prefers-reduced-motion` to turn
  off. A fade-in was considered and dropped: ADR-0009 Q4 forbids blurring and
  colour-shifting card images, an opacity ramp is close enough to that line to
  need an argument, and the argument buys a 200 ms flourish.
- If Scryfall ever asks us to stop, the change is one function
  (`printingFactsForAll`) and one map on the wire. Nothing downstream knows
  where a URL came from.

## Alternatives considered

**Ship `ING-04` as doc 07 §7.3 describes it** — three sizes in our own object
store. The version the docs prefer, and the one ADR-0009 explicitly says not to
ship without asking Scryfall first. Not rejected: deferred, unchanged, still
`ING-04`.

**Ask Scryfall now and wait.** Correct, and still worth doing before `ING-04`.
Rejected as a blocker for this change because it makes shipping any card
imagery at all depend on a third party's reply, when a version exists that needs
no reply.

**Proxy the CDN through our API without caching** — `/api/v1/art/:id` streaming
from `cards.scryfall.io`. It would keep doc 04 §4.1's letter. It is also the
single thing ADR-0009 Q4 names as the risk ("sits close to 'proxy Scryfall
data'"), for a cosmetic benefit, and it would put every card image through a
serverless function on a metered plan. Rejected on both counts.

**Send only `art_crop` and never `normal`.** Smaller, and enough for a tile.
Rejected: the preview is where a card is identified, and identifying a card from
its art alone is a game, not a feature.

**Put `imageUris` on the domain `Card`.** Simplest wire change by far. Rejected:
it is false — a `Card` is oracle identity and an image is a property of one
printing of it — and it is a contract change that would need an ADR of its own
and would break every consumer of the domain type to serve the browser alone.
