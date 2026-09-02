# 37. Interaction is two leaf roles, not an umbrella

Date: 2026-09-01

## Status

Accepted.

> **Number 0037 was assigned to this work.** The number was handed down with the
> task rather than derived by reading the directory — agents have collided twice
> doing that, and 0033 is still missing because of it.

## Context

Five corrections to the role taxonomy came from the product owner:

1. "Board wipes are cards that destroy all creatures typically. Making each
   opponent sac one creature is not a board wipe. Also, doing a lot of damage to
   all creatures could also be considered a board wipe. Ending the turn is not a
   board wipe."
2. "Countering spells is not really spot removal, counters need their own
   category likely."
3. "For some decks, there needs to be some number of interaction spells, which
   do stuff like counter or bounce creatures."
4. "Land tutors are the worst kind of tutors. Usually people want tutors that
   enforce their combos or wincons, which tend to be creature and spell tutors.
   Land tutors are really ramp cards, not tutors."
5. "Graveyard removal should be a separate semantic from spot removal."

Everything below was measured over the whole 34,493-card corpus, before and
after, by diffing every card's derived roles — not by checking examples. That
method is not ceremony: the trample-reminder-text rule that once made Colossal
Dreadmaw a burn payoff produced 176 false positives, and every one of them
survived inspection of the rule and of a dozen sample cards.

## Decision

### Report 3 is the one that needed a ruling: `interaction` is NOT a role

Report 3 asks for "some number of interaction spells". There were three ways to
give it one, and two of them are wrong.

**Rejected — `interaction` as an umbrella over counterspells, bounce and spot
removal.** This breaks the invariant `primaryRole` exists to preserve. Counting
uses exactly one role per card, and `archetype-targets.ts` states as its first
binding constraint that `land + Σ roles` is a real budget against 99 precisely
because role counts do not overlap. An umbrella that also contains spot removal
is either double-counted — in which case the budget is a lie and a row can spend
120 of 99 while reading as 80 — or it wins precedence and hides the columns
underneath it, in which case a builder can no longer ask for three counterspells.
Voltron was already broken once by role counts that were written as though they
overlapped; this would rebuild that bug into the type system.

**Rejected — `interaction` as a single new leaf role catching counters and
bounce together.** It merges two mechanically different answers. A counterspell
answers on the stack, costs nothing on board, and cannot be responded to by the
permanent it stops; a bounce answers a resolved permanent and is temporary,
because the card comes back. A deck that wants permission and a deck that wants
Cyclonic Rift want different cards, and one number cannot express both.

**Accepted — add `counterspell` and `bounce` as leaf roles.** "Interaction" is
then a DERIVED VIEW — the sum of `counterspell`, `bounce` and `spot-removal` —
which any consumer can compute and which needs no union member, no precedence
slot, and no share of the budget. `archetype-targets.test.ts` now asserts control
holds more answers than aggro by summing exactly that way, because after the
split neither row's `spot-removal` column carries the claim on its own.

This also answers report 2 in the same move: `counter target` was 459 cards
filed under `spot-removal`, which told a control deck it was full of removal
when it was full of permission.

### Report 5 needed no new role — the role already existed and could never be counted

`graveyard-hate` has been in the vocabulary since ADR-0005. It had **107 members
and zero primaries**: not one card in the corpus could ever be *counted* as
graveyard hate, so no meter for it could ever move off zero.

Two causes, both measured. `spot-removal`'s `exile target` matched "exile target
player's graveyard" and "exile target card from a graveyard", so 71 of the 107
also held spot-removal; and `spot-removal` outranked `graveyard-hate` in
`ROLE_PRECEDENCE`. The remaining 36 were taken by `board-wipe` (18, via
`exile all`), `token-maker` and `ramp`.

The fix is a guard on `exile target` and a precedence move, not a new semantic.
`graveyard-hate` now has 96 primaries.

### Report 4: a land tutor is ramp

15 cards leave `tutor`, 14 of which were counted as tutors. 120 cards join
`ramp` — the larger number, because the old rules had a hole: `ramp` only caught
a land put *onto the battlefield*, and `tutor`'s `(?!basic land)` lookahead
rejected the word "basic" only. So Sylvan Scrying and Expedition Map were tutors
while Traveler's Amulet and Renegade Map — the same effect, one turn slower —
were neither, and fell into the `synergy` catch-all. 64 of the 120 came from
there.

`ROLE_PRECEDENCE`'s docblock names Cultivate as "ramp *and* land-fetch", and
precedence was already right about it: Cultivate says "up to two basic land
cards", which the tutor rule never matched, so it was `ramp` alone before and
after. The mis-filing was in role membership, not in counting.

### Report 1: where the mass-damage line is drawn, and how

There was no mass-damage rule at all, so Blasphemous Act and Pyroclasm both
derived to `synergy`, the "we could not classify this" bucket. The threshold is
**2 damage**, and it is measured rather than picked.

Over the 19,232 creature printings in the corpus that have a printed toughness:

| damage | kills creatures with toughness ≤ N | share of the corpus |
|---|---|---|
| 1 | 1 | 21.1% |
| 2 | 2 | 45.9% |
| 3 | 3 | 68.5% |
| 4 | 4 | 84.8% |

The 1→2 step is the largest single jump in that table (+24.8 points), which is
where the cut belongs; and it is where the product owner's own example of a
mass-damage wipe sits, since Fiery Cannonade deals exactly 2. Below the line, a
1-damage sweep clears a fifth of the format's creatures — it is a token-sweeper,
not a reset. `X` is included because it has no cap.

The same line is applied to `all creatures get -N/-N`, because it is the same
mechanic — a number against toughness — and two thresholds for one mechanic
would be indefensible. That rule also used to match `-0`, i.e. five cards that
reduce power only and kill nothing.

### Report 1: "ending the turn is not a board wipe"

**All eight** cards in the corpus that end the turn were classified `board-wipe`,
and for seven of them it was their *only* role: Time Stop, Discontinuity,
Glorious End, Sundial of the Infinite, Obeka, Hurkyl's Final Meditation, Ultima,
Day's Undoing.

The cause is the same one that made Colossal Dreadmaw a burn payoff: the rule
matched **reminder text**. "Exile all spells and abilities" is the reminder gloss
on "end the turn", and `exile all` was bare.

Bare `exile all` was wrong far beyond the end-the-turn cards. "All" is a
quantifier over whatever noun follows it, and in 83 of its 134 matches that noun
was in a zone that is not the battlefield — a hand (Bottled Cloister, Serum
Powder), a library (Paradigm Shift), a graveyard (Relic of Progenitus), or the
stack. The rule now refuses `destroy all` / `exile all` when the same *sentence*
names such a zone. Scoping to the sentence rather than the card is what keeps
Settle the Wreckage, which exiles a board and then talks about a library.

Rejected: a whitelist of permanent nouns after "all". It dropped "Destroy all
Goblins" and "Destroy all Islands", which are real wipes.

### Report 1: the edict

`each (player|opponent) sacrifices (all|\w+) creatures?` — `\w+` matches "a", so
70 of that rule's 86 matches were single-target edicts. Only effects with no
fixed cap survive: `all`, or an `X` the card scales. A fixed number is a tax the
board pays *and chooses*, so the creature that matters lives; that is a different
card from a reset.

Knowingly excluded: Blasphemous Edict ("thirteen creatures"), which is a wipe in
practice. A hard-coded number for one card belongs in `CURATED_OVERRIDES`, which
exists for exactly this.

## Consequences

### Roles are persisted, so none of this is live until a re-ingest

`cards.roles` and `cards.primary_role` are columns
(`0001_initial.up.sql:21-22`), written at ingest from
`packages/clients/src/scryfall.ts:442`, because deriving over 34k cards per
request does not fit API-02's 200 ms budget (ADR-0011). Everything above is
inert until the operator runs:

```
pnpm --filter @roundtable/ingest start cards
pnpm --filter @roundtable/ingest impact-roles
```

The second command is not optional. `impact/by-role.data.json` is generated from
`cards.roles`, and it cannot measure `counterspell` or `bounce` until the first
command has written them. `impact-roles.test.ts` carries an explicit exemption
list for those two roles plus a second test asserting they really are unmeasured,
so the exemption fails the moment it stops being true.

### `ROLE_PRECEDENCE` is now checked for exhaustiveness

It is typed `readonly Role[]`, so a subset satisfies the compiler. A role missing
from it is invisible rather than broken: `primaryRole` can never return it, so it
is never counted, never gets a `fills-` group, never gets a meter, and `isRole`
rejects it at the client boundary — with no compile error anywhere. Its docblock
claimed exhaustiveness and nothing checked it. A test now does.

`ROLE_VALUES` in `query/ast.ts` was a second hand-written copy of the vocabulary
with the same problem: forget it and `role:bounce` becomes a parse error the user
sees as `unknown role`, on a query Quickbuild generates for that role's own gap.
It is now derived from `ROLE_PRECEDENCE`.

### Corpus movement, by `primaryRole`

| role | before | after |
|---|---|---|
| spot-removal | 3112 | 2553 |
| counterspell | — | 426 |
| bounce | — | 254 |
| graveyard-hate | **0** | 96 |
| board-wipe | 475 | 496 |
| ramp | 1544 | 1664 |
| tutor | 203 | 189 |
| synergy (catch-all) | 13034 | 12827 |

The catch-all shrinking by 207 is the headline: those are cards the tool had no
description for and now does.

### What is not changing

The bracket modifier still bumps `spot-removal` alone, not the whole answer
column. Doc 05 §5.4 specifies a modifier worth at most 4 cards and the IDEALS
budget is stated against that; bumping four roles would make it 8 and
over-subscribe every row it touches. A bracket-5 deck that wants more permission
than removal is what the per-deck override sheet (doc 16) is for.

The land short-circuit in `deriveRoles` still makes Bojuka Bog a `land` and not
`graveyard-hate`. That is ADR-0005's rule and is deliberate — the land count is
the first number anyone checks — but it does mean the graveyard-hate meter
undercounts a deck whose hate is on lands.
