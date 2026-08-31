# 17 — The deck web

**Status: scoped, not built.** As [doc 16](16-archetype-customiser.md) was until
it shipped, this is a design to argue with before it costs anything. Open
questions are at the end — and doc 16 §16.9 is worth reading first for the form
answering them is expected to take: a decision, the reasoning, and a record of
where the build diverged.

A second way to look at one deck: every card as its art, every relationship as a
line between two of them. The three-column workspace answers "what should I add
next"; the web answers a question it cannot — "what is actually holding this
deck together, and what is just sitting in it".

## 17.1 What it replaces

Everything below the masthead. The masthead stays because it is how you get
back, and because the deck's name and size are as true in the web as in the
list.

Not a modal, not a panel, not a third column. The workspace is already three
regions competing for a laptop screen (doc 06 §6.2); a graph squeezed into a
quarter of that would be a diagram of nothing. The web is a *mode*, entered from
a control in the masthead and left the same way, at `#web` — the same mechanism
the gallery already uses.

The deck is not editable in the web in v1. Accept, reject, and lock stay in the
workspace. This is deliberate scope, not an oversight: see §17.9.

## 17.2 What a node is

One node per card in the deck's `accepted` zone, plus the commanders. Excluded
cards are absent — P6 says a rejected card is not offered again, and putting it
on a canvas is offering it.

The node is the **art crop**, not the whole card. At the sizes a 100-node graph
allows, a full card face is a grey rectangle with unreadable text; the art is
the part that is still recognisable at 64 px, which is why doc 07's L1 already
uses `artCrop` and not `normal`.

**Commanders are drawn differently** — a brass ring, and pinned rather than
free — because the whole deck is legal only by reference to them.

### Art coverage, measured

| | count |
| --- | --- |
| Oracle cards in the corpus | 34,492 |
| …with a default printing | 34,492 |
| …whose default printing has an `image_art_crop` | 33,991 (98.5%) |

The remaining **501** cards have a printing and no art URL. They are not an edge
case to ignore: a deck of 100 has roughly a 78% chance of containing at least
one. `CardFace` already renders a named, arted-less fallback tile and is tested
for it — the web uses the same component rather than inventing a second answer.

### The gap: art does not reach the client

`GET /cards/batch` returns domain `Card`s, and `Card` deliberately carries no
image URLs — they belong to a `Printing`, and embedding them would couple the
deck model to presentation (doc 02 §2.1). `CardDetail.printings` omits them too.
So today **the client cannot draw a single node.**

Two ways to close it:

1. **Add `imageUris` to the batch response** as a sibling of `prices` — a
   `Record<oracleId, { artCrop, normal } | null>` resolved through
   `cards.default_printing`. Prices already set this precedent exactly: a
   printing-level fact returned alongside oracle-level cards, in its own map, so
   the `Card` type stays clean.
2. **A new `POST /decks/:id/web`** returning nodes and edges pre-computed.

**Recommendation: (1).** Every edge in §17.3 is derivable from data the client
*already has* — `synergyProduces`/`synergyWants` come back on every hydrated
card, and `analysis.deckCombos` lists the complete combos with their pieces. A
`/web` endpoint would compute, server-side, what the browser can compute from
its own memory, and would need re-fetching on every accept. Option 1 is one
optional map on an existing response and no new contract surface. It still needs
an ADR under R2, because it changes a response shape.

## 17.3 What an edge is

Four kinds, and the colour says which. This is a categorical encoding — identity,
not magnitude — so the hues are assigned in a fixed order and never cycled.

| Kind | Claim | Direction | Colour |
| --- | --- | --- | --- |
| **Combo** | both cards are pieces of the same complete combo | none | `#b28f1f` gold |
| **Benefits** | A causes an event B benefits from | A → B | `#5f95cf` steel |
| **Theme** | both benefit from the same event; neither causes it | none | `#9b6fd4` violet |
| **Near-combo** | adding one card outside the deck would complete a combo | deck → candidate | `#c06248` rust |

Steel is not a new colour: it is what a `produces` tag already wears in the
workspace, so the two views agree. Gold is `--brass` stepped down one — the
existing `#c9a227` sits at L 0.728, outside the dark-mode lightness band, and
`#b28f1f` is the same hue inside it.

**The palette is validated, not eyeballed:**

```
$ node scripts/validate_palette.js "#b28f1f,#5f95cf,#c06248,#9b6fd4" \
      --mode dark --surface "#131a2a"
  [PASS] Lightness band       all 4 inside L 0.48–0.67
  [PASS] Chroma floor         all 4 >= 0.1
  [PASS] CVD separation       worst adjacent #c06248↔#5f95cf ΔE 19.0 (deutan) · tritan 15.0
  [PASS] Normal-vision floor  worst adjacent #9b6fd4↔#c06248 ΔE 20.7 (normal)
  [PASS] Contrast vs surface  all 4 >= 3:1
```

The obvious palette — brass, steel, sage, rust — **fails**: sage and rust are
4.5 ΔE apart under deuteranopia, which is the classic red/green collision and
would make "combo" and "near-combo" the same line for around one man in twelve.
Violet replaces sage for that reason and no other.

**Colour is never the only encoding.** Combo edges are solid, benefits edges are
solid with an arrowhead, theme edges are dashed, near-combo edges are dotted. A
legend is always present, and the table view of §17.7 names every edge in words.

## 17.4 Density is the whole problem

Measured on a real themed 99 — a mono-black-and-white aristocrats build, colour
identity ⊆ {B,W}, every card carrying at least one of `creature-death`,
`sacrifice-outlet`, `token`, `lifegain`, `drain`:

| | count |
| --- | --- |
| Nodes | 99 |
| Directed **benefits** edges | 1,011 |
| Max out-degree | 32 |
| Median out-degree | 15 |
| Complete combos inside the deck | 4 |
| Combos **one card away** | 756 |

A thousand edges over ninety-nine nodes is not a graph, it is a felt pen. And
756 near-combo edges would each pull in a node from outside the deck, tripling
the node count to draw the weakest claim on the list.

Compare a pile that is *not* a deck — the 99 most-played black cards, chosen by
rank rather than by theme: 79 benefits edges, 0 complete combos. That contrast
is the feature. The web should look like a mess for a good deck and like dust
for a bad one, and the reduction rules below must not flatten that difference
away.

### Reduction rules

1. **Merge parallel edges.** Two cards connected by three shared tags are one
   edge of weight 3, not three edges. Weight drives stroke width (1–3 px) and
   nothing else. This alone takes the aristocrats deck from 1,011 to roughly the
   number of connected *pairs*.
2. **One kind per pair, strongest wins.** Combo beats benefits beats theme. Two
   cards in a combo together do not also get a theme line; the combo is the more
   specific and more interesting claim.
3. **Theme edges are off by default.** They are the weakest claim in the model
   (`THEME_WEIGHT = 0.2`) and the most numerous. A toggle turns them on.
4. **Near-combo edges are off by default and capped.** When on, they are limited
   to the top 20 by the same ranking the "one card away" group already uses, and
   the candidate nodes they introduce are drawn smaller and desaturated, so it
   is never ambiguous which cards are in the deck.
5. **A hard ceiling of 400 drawn edges.** Above it, the lowest-weight edges are
   dropped and the count says so: "showing 400 of 612 connections". Silently
   drawing fewer than the truth is worse than an unreadable graph.

## 17.5 Layout

Force-directed, because the question is "what clusters" and that is the one
question force layout answers well. Three constraints:

- **Deterministic.** Seeded from the deck id, so the same deck lays out the same
  way twice. A graph that reshuffles on every visit cannot be learned, and
  "where is my ramp" is a question users ask of a picture they remember.
- **Settled, not animated forever.** Simulate to convergence (or 300 ticks) and
  stop. A permanently drifting canvas is a `prefers-reduced-motion` violation
  and a battery cost.
- **Off the main thread if it is slow.** Budget below.

Commanders are pinned at the centre. Everything else finds its own place.

`prefers-reduced-motion` skips the settling animation and paints the converged
layout directly. The graph is the point; watching it wobble is not.

## 17.6 Interaction, and R4

AGENTS.md R4: every drag has a tap and a keyboard equivalent. A graph is where
that rule is easiest to break, so it is stated as a table.

| Action | Pointer | Touch | Keyboard |
| --- | --- | --- | --- |
| Pan | drag background | one-finger drag | arrow keys |
| Zoom | wheel | pinch | `+` / `-` |
| Focus a card | click node | tap node | `Tab` through nodes in deck order |
| Follow an edge | click edge | tap edge | `[` / `]` cycle the focused node's edges, `Enter` moves to the far end |
| Card details | hover | tap | `Enter` on a focused node |
| Reset view | button | button | `0` |

**Tab order is deck order, not layout order.** Layout order is a physics
accident and would change what `Tab` does when a card is added. Deck order is
the order the user already knows from the list.

Focus draws a visible ring at the same 2 px brass the rest of the app uses, and
focusing a node dims every edge that does not touch it. That dimming is the
single most useful thing on the screen and costs nothing: it turns a hairball
into "these six cards, and why".

## 17.7 The table view

A `<table>` of the same data, one row per edge: *from*, *to*, *kind*, *why*.
Toggled from the same control as the theme and near-combo switches.

Not an accessibility box-tick. It is the only view that can be searched,
sorted, and pasted into a text box, and it is what a screen reader can actually
read. The graph is a summary of the table, and the table is the source of truth
for what the graph claims.

## 17.8 Budget

| | target |
| --- | --- |
| Edge computation, 100 nodes | < 16 ms — it is an O(n²) tag intersection over 100 items with tiny arrays |
| Layout to convergence | < 400 ms; move to a worker if it exceeds it |
| Art requests | 100 images, lazy, `loading="lazy"` + `decoding="async"` |
| Interaction frame | 60 fps while panning at 100 nodes |
| Re-render on deck change | recompute edges, warm-start layout from current positions |

Rendering is SVG, not canvas, at these sizes. 100 nodes and ≤400 edges is well
inside what SVG handles, and it comes with focus, `Tab`, and hit-testing for
free — all of which §17.6 would otherwise have to reimplement on a canvas.

## 17.9 Deliberately not in v1

- **Editing from the web.** Accept and reject stay in the workspace. Adding a
  card from the graph means the graph relayouts under the click, and the answer
  to that ("warm-start, animate the delta") is a second design.
- **Comparing two decks.**
- **The whole candidate pool.** 34,492 nodes is a different product.
- **Saving or exporting the image.**

## 17.10 Open questions

1. **Should theme edges exist at all?** They are the weakest claim, off by
   default, and add a fourth colour that constrains the palette. The argument
   for keeping them: "these eight cards all want tokens and nothing here makes
   tokens" is a real and useful thing to see, and it is invisible in the list
   view. The argument against: it is a *deficit*, and deficits already have a
   home in the analysis pane.
2. **What is the node for a card with no art — and no printing image at all?**
   `CardFace`'s fallback is a named tile, which is right in a list. In a graph
   where every other node is a picture, 501 cards would become the only
   readable ones, which inverts the emphasis.
3. **Does the near-combo overlay belong here or in the workspace?** It is the
   only thing in §17.3 that introduces cards the deck does not contain, which
   makes it a *suggestion* view wearing a graph. It may be a better fit as a
   filter on the existing "one card away" group.

## 17.11 What this needs before it can be built

- An ADR for the `imageUris` map on `/cards/batch` (R2).
- A decision on question 1, which fixes the palette at three colours or four.
- Doc 08's mobile answer: a force graph on a 375 px screen is either a different
  layout or an honest "this view needs a wider screen", and guessing is worse
  than either.
