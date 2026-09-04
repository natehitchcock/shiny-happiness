# ADR-0061 — A Quickbuild pick returns the reader to the top of the options

**Status:** accepted
**Date:** 2026-09-03
**Extends:** [ADR-0056](0056-a-pick-passes-over-the-trio-it-was-made-from.md) (a pick
cycles all three options), [ADR-0051](0051-remove-is-not-reject-and-a-cost-is-stated-before-the-click.md)
(per-option warnings and longer Add labels). **Changes:**
`apps/web/src/Quickbuild.tsx` and one rule in `apps/web/src/styles.css`. No
domain, no API contract, no change to `App.tsx`.

---

## Context

> "on mobile, every time I select an option, I scroll down half the page, and
> have to scroll all the way to the top to see the options again"

The surface is Quickbuild — "options" is its own word for the three cards it
offers — and the cause is **focus**, not layout.

Quickbuild's Add is wired to the workspace's `decide`, which is the **feed's**
accept path. `decide` arms `focusAfterAct` with the suggestion row after the one
acted on, and a layout effect hands focus to that row's own Add button.
ADR-0056 made a pick cycle all three options, so every control in the trio
leaves the document on a pick and focus falls to `<body>` — which is exactly the
condition `focusAfterAct` exists to catch. It caught it, and sent focus to a row
in the feed **behind** the panel: outside the dialog, outside its focus trap, and
some way down a list the builder cannot see. The browser then scrolled its
nearest scrollable ancestor to reveal it.

Below 900px that ancestor is the **document**. `.workspace` collapses to one
column and the suggestion `.region` grows with the feed, so `.quickbuild`'s
`position: absolute; inset: 0` sizes the panel to a section that is thousands of
pixels tall and its own `overflow-y: auto` never engages. The scroll is
therefore a page scroll.

### Measured, in Chrome, in a 390px same-origin iframe

`resize_window` does not work on this machine. A same-origin iframe is a real
viewport — `@media (max-width: 900px)` keys off it, and it reported
`innerWidth: 390` with `.workspace` at a single `375px` column — so
`contentWindow.scrollY` is the page scroll the report describes.

Three consecutive picks, each starting with option 1 aligned to the top of the
screen, viewport 844px:

| | before | after | delta | option 1 afterwards | focus landed on |
| --- | --- | --- | --- | --- | --- |
| 390px | 820 | 1885 | **+1065** | off screen | `Add …` in a `.card-row` |
| 390px | 874 | 2212 | **+1338** | off screen | `Add …` in a `.card-row` |
| 390px | 932 | 2538 | **+1606** | off screen | `Add …` in a `.card-row` |
| 360px | 857 | 1574 | **+717** | 618px above the fold | `Add …` in a `.card-row` |
| 360px | 956 | 1945 | **+989** | 887px above the fold | `Add …` in a `.card-row` |
| 360px | 1058 | 2316 | **+1258** | 1156px above the fold | `Add …` in a `.card-row` |

The jump **grows as the loop goes deeper**, because the feed row that matches
the card just taken sits further down the feed each time. That is the "every
time" in the report.

**Desktop, 1400px, same build: +1, 0, 0.** The focus still leaked into a feed
row, but the row was near the top of a three-column layout, so nothing moved.
That is why nobody had complained.

### The two candidate causes that were ruled out, not assumed away

**Content height changing under a preserved scroll offset.** Measured directly
by parking focus on the panel's Close button — a stable, connected element, so
every focus guard declines — and picking. The trio's total height was **955px
before and 955px after, on every pick**: the options are equal-height flex items
and a replacement trio is the same height as the one it replaced. There is no
reflow to preserve an offset against.

**A stray `scrollIntoView` from the tour work.** `Element.prototype.scrollIntoView`
was spied on for a whole pick and recorded **zero calls**. The only two callers
in the app are `Tour.tsx`, on tour anchors, and `revealBracket`, on the bracket
chip; neither is on this path.

## Decision

**The panel claims the focus it drops, and puts it on the first option of the
trio that replaced the old one.** A layout effect, so focus moves before the
browser paints and never visibly rests on `<body>`.

**The `<li>`, not its Add button.** The button sits underneath a whole card
detail, so landing on it would put the top of the option off screen — a smaller
version of the same complaint. The `<li>` starts at the top of the trio and
already carries `Option 1 of 3: <name>` as its accessible name, so a
screen-reader user is told *which option they are on* as well as that something
changed. It is `tabIndex={-1}`: focusable by script, out of the Tab ring, and
invisible to the focus trap's own selector, so Tab still goes straight to Add
and Reject.

**No `scrollIntoView`.** Focusing an element already scrolls the minimum needed
to reveal it. When the option is already visible — the desktop case — nothing
happens at all, which is why desktop is unchanged. When it is above the
viewport, as it is on a phone after a pick, the scroll is upward and stops with
the option's top at the top of the screen. An explicit scroll would have to
re-derive that and would move the page in the case that currently does not move.
It is instant, so `prefers-reduced-motion` has nothing to suppress: no
stylesheet sets `scroll-behavior: smooth`, and this is the same reasoning
`revealBracket` already records.

**`focusAfterAct` is left exactly as it was.** It answers a real defect — Enter
on a feed Add used to drop focus to `<body>` and cost seven tabs per card — and
it still does. An `origin` parameter on `decide`, so that only feed acts aim at
feed rows, was written and then **removed**: React fires layout effects
bottom-up, so the panel's runs first and leaves focus on a connected non-`<body>`
element, after which `focusAfterAct`'s guard declines and clears itself. The
implication also runs the other way — the panel's effect declines only when
focus is already connected and not `<body>`, which is precisely when the
workspace's declines too — so the feed can never take focus from a Quickbuild
pick either way. A mutation test proved it: reverting the `origin` change left
every test passing. Defensive code that no test can distinguish from its absence
is code that rots, and this ADR records the argument instead.

## Consequences

Measured on the same harness, same protocol, after the change:

| | before | after | delta | option 1 afterwards |
| --- | --- | --- | --- | --- |
| 390px | 533 | 587 | +54 | **top of the screen** |
| 390px | 587 | 644 | +57 | **top of the screen** |
| 390px | 644 | 702 | +58 | **top of the screen** |
| 360px | 552 | 650 | +98 | **top of the screen** |
| 360px | 650 | 752 | +102 | **top of the screen** |
| 360px | 752 | 854 | +102 | **top of the screen** |
| 1400px | 184 | 185 | +1 | unchanged |
| 1400px | 185 | 185 | 0 | unchanged |

The residual 54–102px is **not the options moving**. `getBoundingClientRect().top`
for option 1 is `0` after every pick at both phone widths: the options are
pinned to the top of the screen. The scroll is the deck rail — which sits
*above* the suggestions region in the one-column layout — growing by one card
row as the card is added, with Chrome's scroll anchoring correctly compensating
so that what the reader is looking at does not move. It is constant per pick and
does not accumulate, against a jump that grew to 1606px and did.

Desktop is unchanged to the pixel: +1, 0, 0 both before and after.

**R4 and the keyboard path are intact.** Focus lands somewhere sensible and
named after every pick, including when the gap runs out — the panel itself, at
the top of the sentence explaining why, rather than `<body>`. Both live regions
still fire: the workspace announces "<name> added. N cards in the deck." and the
panel announces the new heading and the three cards now on offer. The feed's own
accept path is untouched and still moves focus to the next row.

## Testing

jsdom has no layout and **cannot see a scroll jump**, so nothing here pretends
to. What jsdom can see exactly is the focus destination that causes the scroll,
and that is what `apps/web/src/quickbuild-focus.test.tsx` asserts: that focus
after a pick is not in a `.card-row`, is inside the dialog, is on the first
option of the new trio, survives the gap running out, and that the feed's own
path still moves forward. The scroll numbers above are the browser measurement
and live in this ADR.

Every test was mutation-checked: removing the restore flag, landing focus on the
panel instead of the trio, and dropping `tabIndex` each turned the suite red,
and each mutation was verified to have actually changed the file by checksum
before the run — a `sed` that matches nothing in a CRLF tree is the ordinary way
a mutation check passes for the wrong reason.
