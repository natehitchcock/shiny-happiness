# 7. Focus scaling — the zoom system

Pillar P2. One control moves the entire workspace along a continuum from "the
whole pool as a density map" to "one card, everything about it". This is semantic
zoom: levels do not just scale pixels, they change *what is drawn*.

## 7.1 The four levels

### L0 — Constellation
*"Show me everything at once."*

Every card is a 6–10 px pip. Groups are spatial clusters with labels. Colour
encodes the pip: by default the card's colour identity; switchable to mana value,
role, or combo degree (combo degree at L0 is a heat map of where your synergies
are, and is the most striking view in the app).

No card names. This level answers shape questions: *is my curve top-heavy? is all
my interaction in one colour? where are the combo clusters?*

Handles the full pool — up to ~5,000 pips in the candidate region.

### L1 — Grid
*"Show me a lot, identifiably."*

Art-crop tiles, ~72 px. Name on a bottom strip, mana value pip, role dot, and the
combo-degree badge if non-zero. This is the working level for scanning a group.
Roughly 60–120 tiles visible on a desktop viewport.

### L2 — Card
*"Show me these properly."*

Full card image at readable size (~220 px wide), with an overlay badge row: combo
degree, bracket flags, price, EDHREC inclusion. Oracle text is legible on desktop
and legible-with-effort on a phone. ~12–24 cards visible.

The default entry level. New users land here because it is the least abstract.

### L3 — Detail
*"Show me this one."*

Single card, full information, combo lines expanded, reasons enumerated. Doc 06
§6.5. Reached by zooming past L2 with a card focused, or by tapping any card at
any level.

## 7.2 Behaviour

**Shared level.** Both regions render at the same level. "Spread all the cards out
in front of me" must be one gesture, not two.

**Zoom-to-focus.** Zooming keeps the focused card (last touched / hovered /
keyboard-focused, else the viewport centre) anchored. Zooming out from L2 to L0 and
back returns you to where you were. Losing your place on zoom-out is the failure
mode that makes semantic zoom feel hostile.

**Level, not scale.** Levels are discrete with animated transitions (~200 ms
cross-fade plus position interpolation). No intermediate continuous scaling — half
zoomed between L1 and L2 is legible at neither.

**Controls, all equivalent:**
- Segmented control in the command bar (4 stops) — always visible, the discoverable path
- `Ctrl`/`⌘` + scroll wheel, and trackpad pinch
- Keyboard `+` / `−`, and `1`–`4` to jump directly
- Touch pinch (doc 08)

**Persistence.** Level persists per deck. Return to a deck at the level you left it.

## 7.3 Rendering strategy

| Level | Approach | Reason |
| --- | --- | --- |
| L0 | Single canvas per region, pips drawn imperatively | 5,000 DOM nodes is not viable; canvas is |
| L1 | Virtualised DOM grid (TanStack Virtual), art-crop `<img>` | Needs hit-testing, a11y, drag |
| L2 | Virtualised DOM grid, full-card `<img>` | Same |
| L3 | Single DOM component | Trivial |

L0's canvas needs a parallel accessibility path: a visually-hidden list of group
names and counts, and keyboard navigation that moves between *groups* rather than
pips. A canvas that a screen reader sees as an empty rectangle is not acceptable
at any level, and L0 is precisely where a summary is *more* useful than
card-by-card traversal anyway.

**Image loading:** three asset sizes (pip = none, art crop, full card). Never load
a full card image to render an L1 tile. Preload one level in each direction, so
zooming feels instant. `content-visibility: auto` on off-screen groups.

**Performance budgets** (mid-range Android, throttled 4×):
- Level transition: 60 fps, no frame > 32 ms
- L0 with 5,000 pips: initial paint < 300 ms
- L1 scroll: 60 fps sustained
- Accept → re-group settled: < 400 ms end to end

These are test-gated, not aspirational — see [../11-work-breakdown.md](../11-work-breakdown.md) `PERF-01`.

## 7.4 What zoom does not do

Zoom changes *representation*, never *membership*. Zooming out does not filter,
sample, or aggregate cards away — every card in the pool has a pip at L0. If the
pool is too large to be meaningful at L0, that is a filtering problem, and the
answer is filter controls, not a lying zoom level.
