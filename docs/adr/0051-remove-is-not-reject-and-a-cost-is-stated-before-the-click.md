# ADR-0051 — Remove is not reject, and a cost is stated before the click

**Status:** accepted
**Date:** 2026-09-02
**Extends:** [ADR-0012](0012-remove-one-copy-and-record-nothing.md) (remove is an
amount, not a judgement),
[ADR-0044](0044-a-staple-is-a-curated-list-with-an-owner.md) (a staple is a
curated list with an owner). **Changes:** nothing in `packages/domain` and
nothing in doc 10's contract — this is entirely about which command a control
sends and what a panel says before it is pressed.

---

## Context

A five-colour playtest produced three reports. Two of them are the same mistake
in two places: a control that did something more permanent than its label said,
and a panel that reported a consequence only after it had happened.

**The deck rail's "Remove" sent `exclude`.** `exclude` takes every accepted copy
AND bans the card under pillar P6 — the recommender may never offer it again.
The playtest took five lands out of a five-colour deck with that button, and
`fills-land` then filtered to "Baldur" and returned zero candidates. The rail
has no undo, and the way back — the "Rejected" section at the foot of the same
column — is a hundred rows below the click, so it was reported as absent.

The domain has had the right verb since ADR-0012. `{ type: 'remove' }` is
documented in `deck-command.ts` as "One copy, and nothing recorded — the card
stays suggestible", the client's `PendingCommand` union already carried it, the
optimistic reducer already folded it, `wire` already serialised it, and the
basic-land stepper two sections further down the same rail already used it. The
deck rail was the one surface that never issued it.

Doc 19 D5 argues against this exact trap for Quickbuild — "a builder clicking
past a card they might want later would silently exile it" — which is why
Quickbuild's own pass remembers nothing. It was live one surface over, under a
milder word.

**Quickbuild walked past 100 cards and past the chosen bracket.** At 100 of 100
the panel still offered "4 more at mana value 2"; one click made it 101 and the
only notice was in the legality block below the fold. Accepting Mana Vault from
an ordinary ramp gap took a Bracket 3 deck to 4 of 3 Game Changers — the
masthead chip turned red *after* the click, and the option had carried nothing.

---

## Decision 1 — the rail gets two controls, because there are two intentions

"Take this out of my deck" and "never suggest this to me again" are both
legitimate and they are not the same act. They are now two buttons:

| Control | Command | Meaning |
| --- | --- | --- |
| **Remove** | `remove` | One copy out. Nothing recorded; still suggestible. |
| **Never suggest** | `exclude` | Every copy out, and P6 bans it. |

This mirrors what the "Rejected" section already does in the other direction,
where "Suggest again" (`restore`) and "Add" (`restore` then `accept`) are two
controls for the same reason — the file's own comment there reads "Two ways
back, because they are different intentions". Symmetry was available and was not
being used.

**Rejected: rename the one button to "Never suggest".** It is honest, it is a
one-word diff, and it leaves a builder with no way at all to take a card out of
their own deck without banning it. The remaining route would be to reduce a
count on a card that has no stepper, or to reject and then restore — two
commands and a recompute to express one ordinary edit.

**Rejected: `remove` only, with rejection left to the suggestion feed.** A card
already in the deck is exactly where you learn you never want to see it again.
The alternative loop is remove, wait for the card to be re-suggested, then
reject it there — which is worse than the defect for anyone who meant it.

The Remove label says "one copy" when the line holds more than one, because
`remove` takes one and ADR-0012's whole example is that taking 34 Mountains to
33 must not delete all 34.

## Decision 2 — the already-excluded rows are not repaired, and cannot be

Real decks now hold `zone: 'excluded'` rows written by a button labelled
"Remove". Some of those users meant "take it out"; some meant "never again". The
row is identical either way — one `deck_entries` row with a zone and a
timestamp — and nothing recorded which button-label was on screen or what the
user intended.

**So no migration.** Restoring them all would un-reject every card someone
deliberately threw out, which is pillar P6 broken in the other direction and is
not recoverable either. Restoring some would need a rule for guessing intent
from a timestamp, and a guess written into a migration is indistinguishable from
data afterwards.

What is owed instead is that the manual undo exists and can be found. **It
already existed** and was verified in the browser before anything was built: the
"Rejected" section renders whenever the deck holds an excluded entry, and every
row in it carries both "Suggest again" and "Add". Nothing was added there.

What was missing was a signpost at the moment of the mistake, so rejecting from
the rail now says where the card went — reusing the sentence `rejectionText`
already gives a `previously-excluded` refusal, rather than inventing a second
wording for "your way back is the Rejected list".

## Decision 3 — the composition rail's "settled" needs a card to have settled

`settled` was `locked >= actual && actual >= min`, and it means "every card
counted toward this role is committed, so there is nothing left to decide". At
zero cards both halves are vacuously true: nothing is locked out of nothing, and
the band floor is `max(0, ideal - width)`, which is 0 for every role with an
ideal of 2 or less.

Measured against a live five-colour deck at bracket 3: `GET /analysis` returned
**11** targets and the rail drew **9**. The two it dropped were `counterspell`
(0 of 1) and `graveyard-hate` (0 of 1) — while the feed beside it was heading
groups "Fills gap · counterspell" and "Fills gap · graveyard-hate", because
`findDeficits` measures against the **ideal** and the rail's floor is the
**band**. The meter was blind exactly where it was most useful, and the row
appeared only once you already owned one.

The guard gains `actual > 0`. The `locked >= actual` half is untouched: it is
what the gold locked overlay draws and it was the half that was right. The
"Only show roles that still need cards" checkbox is also untouched — hiding a
role that is inside its band is what that checkbox promises, and it is opt-in.

## Decision 4 — Quickbuild warns before the click and refuses nothing

Three options were available for both the 100-card limit and the Game Changer
allowance: refuse the card, warn on the option, or let it through and say so
afterwards.

**Letting it through and saying so afterwards is what shipped, and it is the one
that is definitely wrong.** By the time the legality block or the bracket chip
updates, the deck has changed and the panel has moved on to the next trio.

**Refusing is ruled out by rules this project has already written down twice.**
Doc 03 §3.2: bracket flags are surfaced and never used to filter. AGENTS.md §8
lists "filtering candidates by bracket instead of flagging them" among the
things that get a PR rejected. The stated reason for both is that the user is
allowed to cross their own line **knowingly** — and the defect was never that
the card was offered. It was that "knowingly" was false.

So: the option carries the arithmetic before it is pressed, and the Add control
stays enabled.

- **At or over 100 cards** the panel says so once, above the trio, and every Add
  control's accessible name says what the click makes the total. Stated once
  because it is a fact about the deck rather than about any of the three;
  repeated into each control's *name* because a screen-reader user moving
  control to control never reads the paragraph.
- **A Game Changer with no room** says "…takes you to 4 of the 3 your bracket
  allows" under the card and in the Add control's name.
- **When the bracket check is unavailable**, the card is named as a Game Changer
  and no allowance is asserted. A fabricated allowance is the thing AGENTS.md §8
  forbids, and `null` is what the masthead chip already prints as "NOT CHECKED".

The numbers come from `analysis.bracket` through the same `gameChangerAllowance`
the masthead chip uses. One definition, two surfaces — the panel and the chip
cannot tell a builder two different things about one deck.

**ADR-0044 D4 is unchanged and is not widened.** It governs which cards *lead*
the staples phase: an over-allowance Game Changer is withheld from the `staple`
and `staple-land` groups and appears everywhere else with its `bracket-warning`
reason. That is still exactly what happens. Nothing here filters a candidate,
alters `gameChangerBudget`, or changes what the recommender endorses. What
changes is that the panel reads the flag it was already being sent.

The flag now travels beside the prose rather than only inside it.
`reasonText` renders a `bracket-warning` as the two words "bracket warning" — a
bullet among the reasons the card is *good*, with no consequence attached — so
`QuickbuildCandidate` gains an optional `bracketFlags`, and the panel combines
it with the allowance to say what the click will do.

Also: `legalityText` pluralises through the existing `plural()`. It said "1
cards over 100" in the one case it is read in most.

---

## Consequences

- `QuickbuildCandidate` gains optional `bracketFlags`; `QuickbuildProps` gains
  optional `gameChangers`. Both additive, so R2 does not bite.
- Nothing in `packages/domain` changed. `applyCommands` already did the right
  thing for both verbs; the bug was entirely in which one the rail sent.
- Decks in the wild keep exclusions their owners may not have meant. There is no
  way to tell which, and the honest response is to say so and leave the manual
  undo where it is.
- The deck rail row now has three action controls rather than two. Doc 08 §8.5's
  360 px budget is unchanged — they are the same `.act` buttons already in the
  row — but a fourth would need a rethink of the row, not another button.
