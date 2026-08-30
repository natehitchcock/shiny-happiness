# 1. Vision and pillars

## The problem

Building a Commander deck means holding two incompatible views in your head at
once: the wide view (*what does my 100 look like — curve, colors, roles, gaps?*)
and the narrow view (*is this specific card better than that specific card?*).
Existing builders make you choose. Spreadsheet-style list editors are all narrow
view. Visual grid editors are all wide view and know nothing about your deck's
internal synergies.

This app lets you move continuously between those views, and makes the machine
responsible for the thing humans are worst at: noticing that a card you have
never heard of completes three separate combos with cards you already accepted.

## Pillars

These are non-negotiable. A change that violates a pillar needs an ADR.

### P1 — Fully usable on a phone

Not "responsive". Not "view-only on mobile". Every feature reachable on desktop
is reachable on a phone, including deck editing, drag-based reorganisation,
bracket switching and combo inspection.

The hard consequence: **drag-and-drop can never be the only way to do anything.**
Every drag interaction has a tap/keyboard equivalent that a person can find
without being told. See [ux/08-mobile.md](ux/08-mobile.md).

### P2 — Scalable focus

The user controls how much they see and how much detail each thing gets, along
one continuous axis, with one control. Four discrete levels, from a density map
of the whole pool down to a single card's oracle text and combo lines. Zoom level
is shared across both regions so the whole workspace changes together.

### P3 — Two regions, always both visible

**Accepted** (what is in the deck) and **Candidates** (what could be) are on
screen together. Deck building is a comparison activity; hiding one side behind
a tab breaks it. On a phone the regions stack rather than disappear.

### P4 — Every suggestion explains itself

No opaque scores. A card surfaces because it completes a named combo, or fills a
counted role deficit, or ranks in a named corpus statistic. The reason is visible
on the card at zoom L2 and enumerated at L3. A recommendation the user cannot
interrogate is a recommendation they cannot trust.

### P5 — Grouping over ranking

A flat "top 100 cards" list is not useful. Candidates are always grouped by a
meaningful feature — combo degree first — and ranked only *within* a group.
The groups are the product.

### P6 — The user's choices are durable

Auto-added cards can be removed and stay removed. Rejected candidates do not
come back. Changing bracket does not silently discard manual work.

## Explicit non-goals for v1

- **Not a deck hosting/sharing platform.** Moxfield and Archidekt do that well.
  We export; we do not host a social graph.
- **Not a price optimiser.** Budget is a filter and a soft penalty, not a
  first-class objective.
- **Not a playtester/goldfish simulator.**
- **Not other formats.** Commander only. The domain model may not accrete
  Standard/Modern concepts.
- **Not multiplayer/collaborative editing.**

## What success looks like

A person with a commander in mind and 20 minutes on their phone during a lunch
break ends with a 100-card list they understand — where they can point at any
card and say why it is there.
