# 30. The picture flips and the text does not

Date: 2026-09-01

## Status

Accepted. Implements the UI half of
[ADR-0027](0027-the-back-face-rides-beside-the-front.md), whose three-state
encoding this ADR is a consumer of and does not change.

> **Number 0030 was assigned to this work before it started.** 0027 is the
> back-face data and 0029 was taken the same week. Agents have collided twice by
> scanning `docs/adr/` for "the next free number". Ask for a number; do not
> derive one.

## Context

ADR-0027 carried the back face's art from Scryfall to the browser and stopped
there, deliberately: `apps/web/src/api.ts` declared `ImageUris.back` and
`printings[].backImageUris` and nothing read either. `packages/ui` was untouched
— `CardView` had no back face and `imageFor(card, level)` picked one asset from
a single `{artCrop, normal}` pair.

The user asked for a card flip button. This is it.

What was already right and is not re-derived here: `OracleText` draws BOTH
faces' rules text with the boundary ruled and announced ("Other face:"). The
text half of a double-faced card has never been the problem.

## Decision

### 1. The control lives in `packages/ui`, in three pieces, at L2 and L3

Two surfaces draw card detail: the L3 `Detail` primitive (visible at `#gallery`)
and the workspace's `Preview`, which draws its picture through `CardFace`. The
metrics work put one shared component in both rather than two implementations,
and that precedent is followed — but the seam is not the same one.

`CardMetrics` owns a whole block of layout. The picture does not, because the
two surfaces box it differently and both are right to: `.rt-face-image` is a
fixed frame that reserves the art's exact box before it loads, and
`.rt-detail-image` is `max-width: 100%; height: auto` so a 21 rem panel can be
narrower than the nominal L3 width. A component owning the box would have had to
be told which of those to be.

So what is shared is what would otherwise be duplicated and drift, and each
surface keeps its own box:

- `useCardSide(card)` — the state machine.
- `FlipButton` — the control and its accessible name.
- `FaceNoArt` — the panel for the third state.

`imageFor(card, level, side)` gains a third parameter defaulting to `'front'`,
so every existing call site keeps its exact present meaning. `hasBackFace(card)`
is the question "are there two physical faces", and it reads the KEY, never the
URLs — see §4.

Reaching `CardFace` puts the control on four surfaces at once: the preview
panel, the start screen's commander confirmation, the deck web's details
popover, and the L2 gallery row. All four show one card and have room for it.

**`Tile` does not get one, and that is a decision rather than an omission.** An
L1 tile is 72 px. Doc 07 §7.1 already excludes price, bracket flags and oracle
text at that size because they are illegible, and doc 08 §8.3's 44 px minimum
target would be 61 % of the tile's width — it would cover the art it exists to
reveal. The whole tile is already a `role="button"` that opens the card, so a
second control inside it is a nested interactive control competing for the same
region. Nothing is decided at L1; the answer to "what is on the other side" is
one tap away, on a surface with room to show it.

### 2. The picture flips; the rules text does not

`OracleText` already draws both faces at once. Flipping it too would REMOVE
information the reader has today and turn a viewer into a filter: someone
comparing what Delver of Secrets does with what Insectile Aberration does would
have to press a button between the two halves of one comparison. It would also
put the app's own combo and synergy claims — which are about the whole card —
next to half of the card's text.

The picture flips because an `<img>` can hold one face at a time. That is the
only constraint in play, and the text does not share it.

### 3. The flip resets when the surface moves to a different card

A card left flipped while you browse to another is a bug, not a feature.

The front IS the card (ADR-0027 §1) and is what every panel's heading names, so
a picture of the back under a heading naming the front is a panel disagreeing
with itself. And "flipped" could not be a stable preference even if it were
wanted: nine cards in ten have no back to hold it, so the mode would evaporate
silently on the next single-faced card and reappear on the one after.

Implemented as a render-phase `setState` keyed on `oracleId` rather than an
effect, which would paint the new card's back face for one frame before
correcting itself. Committing the reset is the load-bearing half and is easy to
leave out: without it the stale entry survives and reappears when its own card
does, so browsing away and back returns to a card still showing its back. It
takes three renders to observe, and the tests that pin it open a second card in
between.

### 4. The third state draws a panel, not a broken image and not nothing

ADR-0027's states, and what each draws:

| State | Picture | Control |
| --- | --- | --- |
| absent | as today | none |
| present, art resolved | the face on screen | yes |
| present, art missing | `FaceNoArt` — the face's name, and "No picture of this face." | yes |

`<img src="">` re-requests the page and paints it broken; rendering nothing
would make the card look exactly like a card with one face, which is the
collapse the database's `CHECK` and the layout gate in `packages/clients` exist
to prevent. `FaceNoArt` names the face, so pressing the control visibly does
something even when neither side has art.

`CardFace`'s existing no-art fallback — a card-shaped panel with the name, cost,
type line and rules text — is unchanged for single-faced cards. It is NOT used
for a two-faced card, because it says the same thing whichever face you are on
and would make the control appear inert.

Two collapses of state three into state one were found and fixed on the way:

- `Detail` rendered nothing at all when `imageFor` returned null, so a two-faced
  card with unresolved art lost its second side with its picture.
- `Preview` drew its card face only when `viewImageUris` was defined, and that
  function returns `undefined` for a pair of nulls — so the third state
  disappeared in the one surface whose job is to tell it from the first.

### 5. R4: the control names the face it will show

A tap target of at least 44 px in both axes (doc 08 §8.3, from
`HIT_TARGET_MIN`), a real `<button>` so Enter and Space come from the element
rather than from a hand-rolled `onKeyDown`, and a `:focus-visible` ring on the
brass token.

The accessible name is "Show the back face: Insectile Aberration" — the
DESTINATION face, because naming the current one tells a screen-reader user
where they already are, and a bare glyph tells them nothing. The visible text is
the destination face's name, a substring of the accessible name, so speech
control can hit the button by reading it (WCAG 2.5.3).

`aria-pressed` on a toggle button was rejected: ARIA requires a toggle's name to
stay fixed across its states, so a toggle could never satisfy "say which face
you are going to". This is an action button whose name changes because the
action changes.

A visually-hidden `role="status"` reports the face now on screen, because the
thing that actually changed is a picture and a picture announces nothing. It is
empty until the user has pressed the control at least once — a live region that
already has content when it is inserted is announced on insertion by some screen
readers, which would greet every double-faced card with a sentence nobody asked
for.

### 6. Only a card with two physical faces has a face to NAME

The face names are not on the wire, and do not need to be: Scryfall's `name` for
every `transform` and `modal_dfc` card is exactly `front // back`, so
`faceNames` splits on ` // `. Two more columns and a contract change to carry
what the name already states would have been paying ADR-0027's cost twice.

But the split is gated on `hasBackFace`, and that gate is the point. `Fire //
Ice` is one piece of cardboard whose single picture shows both halves; splitting
its name would put `alt="Fire"` on an image of Fire and Ice, naming half of what
is on screen. That was found in a browser, on the exact card ADR-0027 §3 names
as the counter-example, and it is now pinned by a test.

## Consequences

- **The deck web's art type widened.** `apps/web/src/deckweb/DeckWeb.tsx`
  narrowed the art map to `{artCrop, normal}` in four places; the popover draws
  through `CardFace` and would otherwise have been the one surface in the app
  that denies a transform card has another side. It is now a named `WebImages`
  with an optional `back`.
- **`#gallery` gained two fixtures**, a real `transform` card and a two-faced
  card whose back art has not resolved. The second state does not occur in the
  corpus — all 1,393 printings with a back face have resolved art — and a path
  with no picture of it is a path nobody notices has gone ugly.
- **Nothing about the front moved.** Every existing `imageFor` call, every
  existing `alt`, and the single-faced no-art fallback are byte-for-byte the
  behaviour they were. The suite that covers them did not change.
- **The tile and the deck-web node are untouched**, so doc 07 §7.3's "never load
  a full card image to render an L1 tile" is unaffected: the back face is only
  ever loaded at the level that was already loading a full card.
