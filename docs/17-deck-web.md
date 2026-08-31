# 17 — The deck web

**Status: built.** Reached at `#web` from the masthead. The three open questions
are answered in §17.10, and §17.12 records where the build diverged from this
design — in the form [doc 16](16-archetype-customiser.md) §16.9/§16.10 set.

Two of those answers cut things this document specified, and both were decided
by measurement against a real themed 99 out of the corpus rather than by taste.
**Theme edges and near-combo edges are not built**, so what ships is two edge
kinds, not four. The numbers are in §17.4 and §17.10; the short version is that
theme edges make a random pile look *more* connected than a real deck, which is
the exact contrast §17.4 says the reduction rules must not flatten.

The measured density in this document was also wrong in the direction that
mattered — the reduction rules it prescribes reduce almost nothing — and §17.4
is rewritten around what the corpus actually says.

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

### The gap: art did not reach the client — closed

This section used to say "**today the client cannot draw a single node**", and
that was the blocker on the whole document. It is gone, and it was closed by
**option (1) below, exactly as recommended**, by a change made for a different
reason: [ADR-0021](adr/0021-card-art-from-scryfalls-cdn.md) shipped card art on
2026-08-30 so the preview panel and the start screen could show a picture.

What that leaves for the deck web, and all it needs:

- `POST /cards/batch` and `GET /cards/search` return an **`images` map beside
  `items` and `prices`** — a `Record<oracleId, { artCrop, normal }>` resolved
  through `cards.default_printing`. `Card` is unchanged, so it was an additive
  field and not a contract change (AGENTS.md R2). The client's `hydrate` puts it
  in `Hydrated.images`, keyed like `cards` and `prices`.
- **`imageFor(card, level)` in `packages/ui/src/card/presentation.ts`** is the
  only way to ask which asset a level draws. The web asks for level 1 and gets
  `artCrop`, which is doc 07 §7.3's "never load a full card image to render an
  L1 tile" as a property of one function rather than a convention three
  components have to remember. It returns `null` for three different absences —
  the level draws no image, the card has no art on any printing, or the URL came
  back as the empty string the database layer uses for `NULL`. All three are
  drawn the same way, which is §17.10 question 2's answer.
- The URLs are Scryfall's own CDN, referenced unaltered. Nothing is proxied,
  cached or resized, and `ING-04` is untouched.

The recommendation's *reasoning* also held, and is now load-bearing rather than
predictive: **no new endpoint was needed.** Every edge in §17.3 is computed in
the browser from data it already holds — `synergyProduces`/`synergyWants` come
back on every hydrated card and `analysis.deckCombos` lists the complete combos
— so entering the web makes **zero requests**, which `deckweb/mode.test.tsx`
pins. A `POST /decks/:id/web` would have computed server-side what the browser
computes from its own memory and would have needed re-fetching on every accept.

The rejected option is recorded here rather than deleted: it was
**`POST /decks/:id/web` returning nodes and edges pre-computed.**

## 17.3 What an edge is

**Two kinds as built, from the four scoped.** The colour says which. This is a
categorical encoding — identity, not magnitude — so the hues are assigned in a
fixed order and never cycled.

| Kind | Claim | Direction | Colour | Line |
| --- | --- | --- | --- | --- |
| **Combo** | both cards are pieces of the same complete combo | none | `#b28f1f` gold | solid |
| **Benefits** | A causes an event B benefits from | A → B | `#5f95cf` steel | solid, arrowhead |

A pair where each card causes something the other benefits from is **one** edge
with an arrowhead at both ends, not two lines drawn over each other.

The two that were scoped and cut, with the reasoning in §17.10:

| Cut kind | Claim | Colour it would have used |
| --- | --- | --- |
| **Theme** | both benefit from the same event; neither causes it | `#9b6fd4` violet |
| **Near-combo** | adding one card outside the deck would complete a combo | `#c06248` rust |

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

**No colour moved when two kinds were cut, and the validator was not re-run.**
Removing members from a set that passes cannot lower the separation of any pair
that remains — every surviving pair was already in the run above and already at
or above the worst figures it reports. Gold and steel are what ship. Both worst
pairs the run names (`#c06248↔#5f95cf` under deuteranopia, `#9b6fd4↔#c06248`
under normal vision) involved a cut colour, so the shipped pair is strictly
further apart than either.

Gold is a token, `--edge-combo`, generated into `tokens.css` from `tokens.ts`
with a contrast rule asserting it at 3:1 on `--ink`. Steel is the existing
`--steel` unchanged, which is the point of choosing it: a `produces` tag already
wears it in the workspace, so the two views agree.

**Colour is never the only encoding.** Combo edges are solid, benefits edges are
solid with an arrowhead — which also carries the direction, the whole content of
that edge. A legend naming both in words is always present, the focused edge
turns brass, and the table view of §17.7 names every edge in a sentence.

## 17.4 Density is the whole problem

Re-measured during the build against the live corpus (34,492 cards, 108,046
combos), on a deck built to the same recipe as the scope note's: a
mono-black-and-white aristocrats 99 led by Lotho, Corrupt Shirriff, colour
identity ⊆ {B,W}, every card carrying at least one of `creature-death`,
`sacrifice-fodder`, `token`, `lifegain`, `lifeloss` — those being the real tag
spellings; the scope note's `sacrifice-outlet` and `drain` are not tags.

| | scoped | measured |
| --- | --- | --- |
| Nodes | 99 | 99 |
| Directed **benefits** edges | 1,011 | **712** |
| Max out-degree | 32 | **18** |
| Median out-degree | 15 | **4** |
| Complete combos inside the deck | 4 | 3 |
| Combos **one card away** | 756 | 689 |

The shape of the argument survives; two of the numbers do not, and the median is
out by a factor of nearly four. Seven hundred edges over ninety-nine nodes is
still not a graph, it is a felt pen.

Compare a pile that is *not* a deck — the 99 most-played black cards, chosen by
rank rather than by theme: **120** directed benefits edges and 0 complete
combos, against the deck's 712. That contrast is the feature. The web should
look like a mess for a good deck and like dust for a bad one, and the reduction
rules below must not flatten that difference away.

### What the scoped reduction rules actually reduce

Measured on that deck, and this is the finding that reshaped the rules:

- **Rule 1 buys 3%, not the order of magnitude claimed.** "Merging parallel
  edges alone takes the deck from 1,011 to roughly the number of connected
  pairs" is wrong twice over. Two cards connected by a producer/wanter pair
  share **one** tag almost always: 668 of the 690 merged edges have exactly one,
  and 22 have two. So merging by tag removes nothing, and merging the two
  directions took 712 to 690.
- **Which means rule 5 has nothing to sort by.** "The lowest-weight edges are
  dropped" needs weights that differ, and 97% of the edges tie at weight 1. The
  ceiling would then have cut by iteration order — which follows hydration
  order, which follows the network — and a graph that redraws differently on a
  reload is exactly what §17.5 exists to prevent.
- **The ceiling does all the work.** Combo plus benefits comes to 691 drawn
  edges before it, and 400 after. Fifteen of the deck's cards touch no drawn
  edge at all.

### Reduction rules, as built

1. **Merge parallel edges.** One edge per *pair*, whatever the tags and whatever
   the directions. Two cards that each cause something the other benefits from
   get one line with two arrowheads. Kept for correctness — drawing a pair twice
   is a lie about how connected it is — but it is not a density measure and this
   document should not have claimed it was.
2. **One kind per pair, strongest wins.** Combo beats benefits. Two cards in a
   combo together do not also get a benefits line; the combo is the more
   specific and more interesting claim.
3. ~~Theme edges are off by default.~~ **Cut** — §17.10 question 1.
4. ~~Near-combo edges are off by default and capped.~~ **Cut** — §17.10
   question 3.
5. **A hard ceiling of 400 drawn edges, ranked by SCARCITY.** Above it the least
   scarce edges are dropped and the count says so: "showing 400 of 691
   connections". Silently drawing fewer than the truth is worse than an
   unreadable graph.

**Scarcity replaces "weight", which is the change rule 1's measurement forced.**
A tag is worth `1 / (number of deck cards that produce it)`, and an edge is
worth the sum over its shared tags. In the aristocrats deck forty cards produce
`lifeloss` and one produces `landfall`: an edge on the fortieth drain effect is
not news, and an edge into the deck's only land engine is the deck. That gives
the range a tag count does not have — it also drives the 1–3 px stroke — and it
ranks the right thing rather than merely ranking *something*. Combo edges are
never dropped, and ties break on the oracle-id pair so the cut is reproducible.

**What is NOT reduced, deliberately.** The graph still draws every card and
every kept edge at full opacity until something is focused. Focus is the reading
tool (§17.6), not a smaller default.

## 17.5 Layout

Force-directed, because the question is "what clusters" and that is the one
question force layout answers well. Three constraints:

- **Deterministic.** Seeded from the deck id, so the same deck lays out the same
  way twice. A graph that reshuffles on every visit cannot be learned, and
  "where is my ramp" is a question users ask of a picture they remember.
- **Settled, not animated forever.** Simulate to convergence (or 300 ticks) and
  stop. A permanently drifting canvas is a `prefers-reduced-motion` violation
  and a battery cost.
- **Off the main thread if it is slow.** Budget below. It was not: a 100-node,
  400-edge layout runs to its cap in well under the 400 ms budget, so it stays
  synchronous and there is no worker.

Commanders are pinned at the centre. Everything else finds its own place. See
§17.12 for the two force-model changes the first readable version needed.

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
| Card details | hover | tap | `Enter` on a focused node with no edge picked |
| Reset view | button | button | `0` |

`Enter` does the two jobs in that order, because §17.6 as scoped gave it to both
and the order has to be stated somewhere: with no edge picked it describes the
card, and after `[` or `]` has picked one it moves to the far end. Each step is
announced through an `aria-live` region, so a screen-reader user hears which
connection of how many, and what it claims, before following it.

**Tab order is deck order, not layout order.** Layout order is a physics
accident and would change what `Tab` does when a card is added. Deck order is
the order the user already knows from the list.

Focus draws a visible ring in the same brass the rest of the app uses. A
commander's frame is brass too, so the two are separated by geometry rather than
hue — the commander's brass is *on* the box and always present, the focus ring
is thicker and comes and goes — and a commander additionally carries its name on
the canvas, which no other node does.

Focusing a node dims every edge that does not touch it. That dimming is the
single most useful thing on the screen and costs nothing: it turns a hairball
into "these six cards, and why".

## 17.7 The table view

A `<table>` of the same data, one row per edge: *from*, *to*, *kind*, *why*.
Toggled from a control in the same bar as the zoom and the legend — the theme
and near-combo switches it was scoped to share do not exist. It also names, in
words, every card no drawn edge touches, which is §17.1's "what is just sitting
in it" in the form you can copy out. While it is showing, the drawing is
`aria-hidden`: two readings of the same data in the accessibility tree is two
readings of the same data.

Not an accessibility box-tick. It is the only view that can be searched,
sorted, and pasted into a text box, and it is what a screen reader can actually
read. The graph is a summary of the table, and the table is the source of truth
for what the graph claims.

## 17.8 Budget

| | target |
| --- | --- |
| Edge computation, 100 nodes | < 16 ms — it is an O(n²) tag intersection over 100 items with tiny arrays |
| Layout to convergence | < 400 ms; move to a worker if it exceeds it |
| Art requests | 100 images. `loading="lazy"` and `decoding="async"` do NOT apply — SVG `<image>` carries neither, and nothing is below a fold that does not exist |
| Interaction frame | 60 fps while panning at 100 nodes |
| Re-render on deck change | recompute edges, relayout from the seed. Not warm-started: the deck is not editable here (§17.9), so the only way it changes under the web is a queued command landing, and a rebuild from the seed keeps the promise that the same deck is the same picture |

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

## 17.10 The three open questions, answered

### 1. Should theme edges exist at all? — **No. Cut.**

Not on grounds of density, which is where the scope note framed the argument,
but on grounds of **truth**. The theme edge claims "both of these cards benefit
from an event and neither causes it", and the interesting reading of that — the
one this document offers in its own defence — is "these eight cards all want
tokens and nothing here makes tokens". Measured against the corpus, that reading
is false for both decks tested.

The deck's synergy model has a second relation the rest of the app already uses:
`INTERACTION_PAIRS` in `packages/domain/src/synergy.ts`, which says what feeds
what — tokens are creatures entering, deaths fill a graveyard, treasures are
artifacts entering. Running the aristocrats 99 against it:

| | tags wanted but not produced | …and not fed by any interaction either |
| --- | --- | --- |
| themed 99 | `creature-etb`, `untap`, `attack-trigger` | **none** |
| 99 most-played black | `untap`, `creature-etb`, `plus1-counter`, `attack-trigger` | **none** |

Every deficit a theme edge would have drawn is served by something the deck
does produce. A line saying "nothing here makes creatures enter", drawn across a
deck holding twenty-five token makers, is a confident wrong answer — the thing
AGENTS.md §8 and pillar P4 both exist to stop.

The density measurement then removes any remaining case for keeping them, and it
is the sharper of the two findings:

| | themed 99 | 99 most-played black |
| --- | --- | --- |
| Theme edges, as §17.3 defines them | 226 | **1,061** |
| Benefits edges | 688 | 119 |

**Theme edges make a random pile look nearly five times more connected than a
real deck.** §17.4 says the reduction rules must not flatten the mess-versus-dust
contrast; theme edges do not flatten it, they *invert* it. The cause is one tag:
`untap` is derived from having a tap ability, so roughly half of any pile of
good cards wants it and none of them produces it, and a clique of forty-six
nodes is 1,035 edges saying "these cards tap". In the themed deck the same two
cliques (`untap`, `creature-etb`) are the whole of the 226.

What this costs, and it is what the scope note was protecting: the deficit view
of "eight cards want tokens" is not available in the web. It remains in the
analysis pane, where a deficit is a number against a target rather than a shape,
and where it is measured against the deck rather than against a pair.

The palette drops from four colours to two as a result. That is not a loss worth
mourning: §17.3's four-colour set was constrained precisely by fitting four
categorical hues into one lightness band, and two is a strictly easier problem.

### 2. What is the node for a card with no art? — **The same box, quieter, and every other node gets a name too.**

The worry was right and the framing was the trap. In a graph of ninety-nine
pictures, one tile with words on it *is* emphasis, and 501 cards in the corpus
take that path — a 100-card deck has roughly a 78% chance of containing one. The
fix is not to make the fallback quieter than legibility allows. It is to notice
that the inversion comes from the *other* ninety-nine having no text at all.

So: **every node carries its name**, in `aria-label`, in an SVG `<title>` the
browser shows on hover, and in the details panel on hover or focus. The art-less
node is then one labelled node among a hundred labelled nodes, and the only
difference is where the label is drawn. Its box is the same size and shape, in
flat `--ink-2` with a `--rule` border and the name typeset small inside it — no
accent colour, no heavier border, nothing that reads as importance.

`CardFace`'s tested fallback is used, but in the details panel rather than as
the node: at 64 px a card-shaped panel carrying name, cost, type line and rules
text is four illegible rows. `Tile`'s no-art path was the other candidate and
was rejected for a duller reason — the graph is SVG (§17.8) and `Tile` is DOM,
so using it would have meant a `<foreignObject>` per node.

### 3. Does the near-combo overlay belong here or in the workspace? — **The workspace. Cut from the web.**

The scope note's own suspicion was right: it is a suggestion view wearing a
graph. Three things decided it.

**It is inert here.** §17.9 makes the web read-only on purpose. A near-combo
node is a card the deck does not contain, drawn with no way to accept it — a
recommendation with no button, which is worse than no recommendation. The "one
card away" group in the suggestion feed has the button, the reasons, and the
price.

**The cap is arbitrary and the measurement says so.** The deck is one card away
from 689 combos, involving **269 distinct cards outside it**. Rule 4's "top 20"
picks 20 of those 269 by a ranking the reader cannot see or change from this
view, and every one of them adds a node.

**The obvious salvage does not survive contact either.** Rather than pulling in
outside cards, the overlay could have marked the deck cards that are *waiting* —
a piece of a combo the deck is one card short of. Measured: **49 of the deck's
99 cards** are a piece of at least one one-away combo. Half the deck highlighted
is not a highlight. (Ashnod's Altar alone is a piece of 127 of them, which is
also a fair description of Ashnod's Altar.)

Rust is therefore unused by the deck web and stays what it was: the alarm
colour.

## 17.11 What this needed before it could be built, and what became of it

- ~~An ADR for the `imageUris` map on `/cards/batch` (R2).~~ Closed by
  [ADR-0021](adr/0021-card-art-from-scryfalls-cdn.md), written for the preview
  panel and the start screen. See §17.2.
- ~~A decision on question 1, which fixes the palette at three colours or
  four.~~ Answered above: two.
- **Doc 08's mobile answer**, which was the one thing that had to be decided
  here. A force graph on a 375 px screen is not legible at any zoom that fits
  it, and pretending otherwise is worse than saying so. Below 640 px the view
  **opens on the table of §17.7** rather than on the drawing: the same data, in
  the one form that survives the width, with every row searchable. The graph is
  still there, still pannable and pinchable, and the details panel moves from
  the right-hand corner to the bottom edge. This is the "different layout"
  branch rather than the "needs a wider screen" branch, and it needed no second
  data model because the table was already required.

## 17.12 Where the build diverged from this design

Seven places beyond the two cut edge kinds. Each is a change to this document
made in the same commit as the code, per AGENTS.md §10.

1. **One node per distinct card, with a copy count — not one per accepted
   entry.** §17.2 says "one node per card in the deck's `accepted` zone". Taken
   literally, a normal mana base is thirty identical Swamp nodes: thirty copies
   of the same art, none of which can ever touch an edge, because basics carry
   no synergy tags and are in no combo. `×30` on one node says the same thing in
   one thirtieth of the canvas.

2. **Edge rank is scarcity, not the number of shared tags.** Forced by
   measurement — see §17.4. The scoped weight is 1 for 97% of a real deck's
   edges, so it can drive neither the stroke width it was specified for nor the
   ceiling that depends on it.

3. **The canvas is about four times the area of the pane it is drawn into, and
   takes the pane's proportions.** The size is arithmetic, not preference: a
   hundred 64 × 47 nodes is 300,000 square units of card and a laptop graph pane
   is around 720,000. Two fifths of the surface covered in cards cannot be laid
   out without overlap. A pane-sized canvas gave a nearest-neighbour median of
   26 units against a 64-unit node — a pile. The deck therefore opens at around
   a third size, which is a shape you can read as a shape, and the zoom §17.6
   already specifies is how you get back to the art. §17.2's "recognisable at
   64 px" is about which *asset* to load, and that is still `artCrop`; it is not
   a promise about the pixel size at whole-deck zoom.

   The *proportions* are measured because a fixed 3:2 viewBox in a pane of any
   other shape is letterboxed, and everything shrinks to fit the axis that does
   not match: in a browser, a 99-card deck drew into 216 px of a 470 px pane.
   The aspect is quantised to a tenth so that dragging a window edge does not
   re-run the simulation on every frame, and read through a `ResizeObserver` —
   a single measurement in an effect caught the pane mid-layout, came back
   square for a pane that ends up 1.11:1, and letterboxed a tenth of the width
   away for the rest of the session.

4. **The layout is not textbook Fruchterman–Reingold.** Two changes, both made
   because the first version produced a picture nobody could read while every
   test still passed:
   - the attractive force is a **linear spring with rest length `k`**, not
     `d²/k`. The quadratic version fires a drifted node back across the graph
     and out the other side; a few outliers then set the scale for the fit and
     the median gap collapsed to 15 units against a 64-unit node.
   - a step applies **a fifth of the net force**, not all of it. Undamped, every
     graph with an edge in it oscillated until the cooling schedule ran out, so
     "simulate to convergence" never happened and §17.5's settled-not-animated
     promise was met only by the tick cap.

   The pull to the centre is also **elliptical, not circular** — stiffer in the
   short axis in proportion to the canvas aspect. An isotropic pull settles the
   deck into a circle, and a circle in a 3:2 frame used 1,604 of 2,600 units
   across; with the ellipse it is 95% of the width and 88% of the height, and
   the same again at 2.3:1 and 0.9:1. Both axes are still scaled by one number
   at the fit, so no distance is misstated.

   Positions are also **fitted to the canvas at the end** rather than clamped
   during the simulation. Clamping pressed 100 of 100 nodes against the frame
   with a closest pair of 0 px — two cards drawn exactly on top of each other —
   because clamping is not a force and several nodes reach the same boundary
   pixel. The fit is symmetric about the centre so the pinned commanders stay in
   the middle, which is the reader's only landmark.

5. **The settling animation is a replay of recorded frames, not a live
   simulation.** The layout runs to completion synchronously and keeps forty
   snapshots along the way; the animation plays those and stops, because a
   replay cannot drift — it runs out of frames. Under `prefers-reduced-motion`
   no frames are recorded at all and the converged layout is painted directly.

6. **The workspace is hidden, not unmounted, while the web is showing.** §17.1's
   "replaces everything below the masthead" is what the reader sees, and
   `.workspace[hidden]` is how. Unmounting would re-run the whole recommendation
   pipeline on every toggle of a view whose data is already in memory, and would
   throw away the query, the columns and the collapsed groups with it.

7. **`Enter` means two things on a focused node, in a stated order.** §17.6's
   table gives `Enter` to both "card details" and "follow an edge". As built:
   with no edge selected `Enter` describes the card; after `[` or `]` has picked
   one, `Enter` moves to its far end and the pick clears. Every step announces
   itself through an `aria-live` region.

**Verified against the real thing, not only in jsdom.** The deck above was built
in the local corpus and opened in a browser: 99 nodes, "showing 400 of 691
connections · 99 cards · 15 connected to nothing" — the same numbers §17.4
measures — with 97 of the 99 nodes carrying art and two taking the no-art tile.
Focusing a card dimmed the rest, and the details panel read out sentences like
"Psychosis Crawler and Sheoldred, the Apocalypse each cause something the other
benefits from: drawing cards."

One thing that came out of that run and is worth keeping: against an API from
**before** ADR-0021, which sends no `images` map at all, every node falls back
to the no-art tile and nothing else changes. That is `hydrate`'s
`body.images ?? {}` doing its job, and it means the web degrades to a readable
text graph rather than to a broken one.

Two smaller things worth recording because they are absences rather than
changes. SVG `<image>` carries neither `loading="lazy"` nor `decoding="async"`,
so ADR-0021's blanket statement about every image does not hold here; nothing is
deferred either way, because the whole graph is inside the viewBox on entry.
And the tag-to-words table moved out of `App.tsx` into `apps/web/src/tags.ts` so
both surfaces name an event the same way — which immediately turned up three
tags (`creature-etb`, `enchantment-etb`, `spell-cast`) that were missing from it
and had been rendering as the wire spelling in the workspace's own tag hint.
