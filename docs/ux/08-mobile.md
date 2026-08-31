# 8. Mobile

Pillar P1: **every feature works on a phone.** Not a reduced version — the same
product, laid out for a 360 px viewport and a thumb.

## 8.1 Layout

The desktop side-by-side split does not survive at phone width, but P3 (both
regions visible) still holds. The two regions become a **scrolling candidate feed
with the deck as a bottom sheet**:

```
┌─────────────────────────┐   ┌─────────────────────────┐
│ ☰ Krenko    B3   64/100 │   │ ☰ Krenko    B3   64/100 │
│ ▓▓▓▓▓▓▓▓░░ lands 34/36 ⚠│   │ ▓▓▓▓▓▓▓▓░░ lands 34/36 ⚠│
├─────────────────────────┤   ├─────────────────────────┤
│ ▾ Completes 3+ combos 6 │   │ ▾ Core · Bracket 3   24 │
│  ┌────────┐ ┌────────┐  │   │  ┌────────┐ ┌────────┐  │
│  │  card  │ │  card  │  │   │  │  card  │ │  card  │  │
│  └────────┘ └────────┘  │   │  └────────┘ └────────┘  │
│ ▾ Completes 2 combos 14 │   │ ▾ Lands              34 │
│  ┌────────┐ ┌────────┐  │   │  ┌────────┐ ┌────────┐  │
│  │  card  │ │  card  │  │   │  │  card  │ │  card  │  │
├─────────────────────────┤   │  └────────┘ └────────┘  │
│ ═══  DECK 64  ▴         │   │ ▾ Ramp                8 │
└─────────────────────────┘   └─────────────────────────┘
     peek detent                    full detent
```

**Bottom sheet, three detents:**
- **Peek** (~64 px) — a handle showing `DECK 64` plus the worst composition
  warning. Always visible; the deck is never fully out of mind.
- **Half** (~50 vh) — deck groups scrollable, candidates still visible above.
  This is the comparison detent and the one that preserves P3.
- **Full** — deck fills the screen; candidates one swipe away.

Dragging the handle moves between detents; tapping it advances one detent. Sheet
detent, like zoom level, persists.

## 8.2 Interactions — the no-drag-only rule

**Every action has a non-drag path.** This is the single most important mobile
rule in the project. Drag on a small touchscreen fails for people with tremor or
limited dexterity, fails inside a scrolling container, and fails for anyone using
a screen reader or switch control.

| Action | Tap path | Drag path | Keyboard |
| --- | --- | --- | --- |
| Accept a candidate | Tap card → sheet action `Add to deck` | Drag onto sheet handle | `Enter` on focused card |
| Quick-accept | Swipe card right | — | `A` |
| Exclude a candidate | Tap card → `Not for this deck` | Drag to the dismiss zone | `X` |
| Quick-exclude | Swipe card left | — | — |
| Remove from deck | Tap card in sheet → `Remove` | Drag out of the sheet | `Delete` |
| Reorder / recategorise | Tap → `Move to group…` | Drag onto a group header | `M` |
| Change zoom | Zoom control in command bar | Pinch | `1`–`4` |
| Inspect | Tap card → sheet opens at detail | — | `I` |

**As built (WEB-01):** the deck bottom sheet and its three detents do not exist
yet — below 900 px the workspace simply stacks — but *Inspect* has its own sheet
already, because without one the analysis region lands under the whole feed and
tapping a card wrote its details several screens down. It is the same `Preview`
element the desktop rail holds, restyled to the bottom edge by a media query
rather than a second copy; it is a non-modal `dialog`, takes focus as it opens,
closes on Escape and returns focus to the card that opened it. When the deck
sheet does arrive, the two have to become detents of one sheet rather than two
sheets stacked on each other.

Swipe-to-accept / swipe-to-reject is the fast path a practised user will live in.
Both are undoable from a snackbar, because swipe gestures misfire.

**Gesture disambiguation** is a real engineering problem here and needs deliberate
handling, not defaults:
- Horizontal swipe on a card = accept/reject. Vertical = scroll the feed. Resolve
  by initial angle within the first ~10 px, then lock the axis for the gesture.
- Pinch anywhere = zoom. Never let a pinch start a drag.
- Long-press (~400 ms) = pick up for drag. Short press = tap. A drag must never
  begin from a plain touch-move, or the feed becomes unscrollable.
- Drag from inside a scrolling region requires the long-press activation delay;
  `dnd-kit`'s `TouchSensor` with an activation constraint handles this and is a
  reason to prefer it (see [../09-architecture.md](../09-architecture.md)).

## 8.3 Touch and reach

- Minimum touch target 44×44 px, with 8 px between adjacent targets. Card tiles at
  L1 are smaller than this visually — their *hit area* is padded to meet it.
- Primary actions sit in the bottom third of the screen (thumb zone). The command
  bar is for status and infrequent controls; it is not where you accept cards.
- Nothing important within 16 px of a screen edge — palm rejection and gesture
  navigation both eat that band.
- Respect safe-area insets. The sheet's peek detent sits above the home indicator.

## 8.4 Zoom on mobile

All four levels are available (P2 is not waived on mobile).

- Pinch to zoom between levels, with the same anchoring rule as desktop.
- The command-bar zoom control is a 4-stop segmented control, because pinch is
  imprecise and undiscoverable — the control is the primary path and pinch is the
  accelerator, the same relationship as tap and drag.
- L1 grid: 4 columns at 360 px. L2: 2 columns. L0: full-width canvas, and it is
  genuinely useful on a phone — it is the only way to see 5,000 candidates on a
  small screen at all.

## 8.5 Network and offline

Phones are on bad networks in game stores with thick walls.

- Deck state is local-first: mutations apply optimistically and sync in the
  background. The app is fully usable while a sync is pending.
- Card data for the deck's colour identity is cached in IndexedDB after first load.
- Images: lazy, responsive `srcset` per zoom level, `loading="lazy"`, cached by a
  service worker with a stale-while-revalidate policy.
- An offline deck is editable; only *new* recommendations require the network, and
  their absence is stated inline rather than blocking the UI.
- Initial JS budget ≤ 200 KB gzipped for first interaction; card imagery and the
  L0 canvas renderer load after.

## 8.6 Accessibility

Not a separate workstream — a property of every task's definition of done.

- Every interactive element reachable and operable by keyboard and by screen
  reader, including all of §8.2's drag paths via their tap equivalents.
- Drag operations announce state changes via a live region ("Sol Ring added to
  deck, 65 of 100").
- Colour is never the only signal: combo degree is a number, not just a heat
  colour; bracket warnings carry an icon and text.
- Contrast ≥ 4.5:1 for text, ≥ 3:1 for UI boundaries, in both themes.
- Honour `prefers-reduced-motion` (doc 06 §6.4) and `prefers-color-scheme`.
- Target WCAG 2.2 AA. Test at 360 px width and at 200% text zoom.
