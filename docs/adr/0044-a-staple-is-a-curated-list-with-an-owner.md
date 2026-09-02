# ADR-0044 — A staple is a curated list with an owner, and it leads

**Status:** accepted
**Date:** 2026-09-01
**Extends:** [ADR-0006](0006-data-source-terms-verification.md) (nothing is written
from recall), [ADR-0008](0008-drop-edhrec.md) (EDHREC is not queried),
[ADR-0031](0031-a-card-is-offered-under-the-role-it-is-counted-as.md) (a card is
offered under the role it is counted as),
[ADR-0040](0040-lands-are-built-last-and-the-loop-ends-with-a-question.md) (the
build order is derived).
**Changes:** `CandidateGroupKey` — `staple` is redefined and the catch-all is
renamed to `other`; doc 05 §5.3's group table; doc 19's loop.

---

## Context

> "staples should probably be at the top, and we should separate staples and
> staple lands, and then combos and the rest"

There is a group called `staple` today. It is emitted **last**, under the
heading "Staples" and the rationale "Widely played and legal in your colours",
and it holds this:

```ts
else if (statsAvailable && (s.stats?.inclusion ?? 0) >= STAPLE_INCLUSION) s.group = 'staple'
else if (!statsAvailable) s.group = 'staple'
```

`stats` is `null` in production — the API passes the literal, because ADR-0008
dropped EDHREC and the project's own corpus statistics do not exist yet. So the
second branch is the only one that ever runs, and the group is **every eligible
card in the deck's colour identity that had nothing more specific to say**. On
a five-colour deck that is thousands of cards, filed under a heading claiming
they are widely played, sorted by a score whose inclusion term
(`w.inclusion * (s.stats?.inclusion ?? 0)`) is exactly zero for every one of
them.

The user is looking at that heading at the bottom of the page and asking for it
to be at the top. Moving it would have been the wrong fix: the heading is not
describing anything.

---

## Decision 1 — the list is curated, and the file says so

There is no measurement of "how often is this played" available to this
codebase. ADR-0008 forbids querying EDHREC; the own-corpus statistic is inert.
A threshold cannot define "staple" here because there is no number to threshold.

So `packages/domain/src/staples/staples.data.json` is a **hand-written list of
27 card names** with its provenance in the file, in the shape ADR-0006 asks of
every other data file in this repository: where it came from, when, who decides,
and — because this one is an opinion rather than a fetch — the inclusion
principle it was written against and a one-line justification per card.

> A card belongs on the list only if it does a job **every** Commander deck has,
> and is the **default** answer to that job inside the colours that can cast it,
> so a deck of those colours that leaves it out is making a deliberate choice
> rather than a neutral one.

Twenty-seven, and the number matters. A five-hundred-card staples list is a
synonym for "good cards" and says nothing; the value of the list is entirely in
what it refuses. Small enough that a reviewer can disagree with it card by card
is the only form of accountability an opinion can have. The file is meant to be
edited and needs no code change to edit.

**Rejected: deriving it from `edhrecRank`.** It is on every card and it is
tempting. It is a rank over the whole format rather than over Commander decks in
these colours, so it would lead a Commander build with whatever is currently in
Standard — and it would be a second silent opinion with no owner and no line to
edit, which is what the curated file exists to avoid.

**Rejected: deriving it from `cardImpact` or `cardEfficiency`.** Both are honest
card-intrinsic measures and neither answers this question. Doc 18 records Sol
Ring at impact 0.68 and Wrath of God at 6.12, so an impact threshold drops the
single most universally played card in the format and keeps board wipes. "Does a
lot" and "every deck wants it" are different questions.

**Rejected: a number in the UI.** Anything shaped like a percentage beside these
headings would be read as a measurement. The heading and the rationale say "our
curated list… an opinion, not a statistic" in words, on both surfaces.

---

## Decision 2 — one list, and the split into lands is derived

The user asked for staples and staple lands separately, and they are separate on
screen: two groups in the feed, two phases in Quickbuild. The **data** is one
list, and `stapleGroupFor` partitions it by the card's own `types`.

Two files, or one file with a `"type": "land"` field, both encode the same fact
twice. Whether a card is a land is already in the corpus, put there by the
ingest from Scryfall's type line. A hand-typed second copy is a copy that can
disagree with the first, and **ADR-0031 is this repository's own record of what
that costs**: grouping read `roles[0]` while counting read `primaryRole`, the
two disagreed on 8.4% of a real pool, and a fifth of the rows ended up under a
heading that was not true of them. `"type": "land"` beside `"name": "Command
Tower"` is that defect pre-committed to disk.

It is also the field that would age worst. A modal double-faced card is a land
on one face, and the corpus already carries both faces' types. The derived split
follows a reprint for free; a checked-in field has to be re-reviewed by somebody
who remembered to.

**What is knowingly given up:** the file can no longer record "I meant this one
as a land staple", so a name that turns out not to be a land silently leads the
spells phase instead. That is caught where it can actually be caught — against
the corpus, in the test that resolves every name — rather than by a field that
only records what the editor believed.

---

## Decision 3 — the groups lead the page; membership is decided under the combos

Emitted order is `staple`, `staple-land`, `combo-3plus`, `combo-2`, `combo-1`,
`near-combo`, `fills-<role>`, `top-<type>`, `high-synergy`, `other` — which is
the sentence that was asked for.

**Membership order is not emission order, and only for these two groups.** The
membership chain still asks the combo questions first, so a curated staple that
finishes a combo the deck already holds is filed under `combo-1` and appears in
the combo section. "Adding this finishes a combo you hold" is a claim about
*this deck*; "every deck wants this" is true of the card everywhere, and P4 asks
the more specific true claim to win the card. Doc 05 calls the combo groups the
headline feature, and paying for a new heading with their best rows is a bad
trade.

Membership **is** decided above `fills-<role>`, and it has to be: an empty deck
is short in every role, so every staple would land in a `fills-` group and the
opening phase would never hold a single card — which is precisely the deck the
phase exists for.

Nothing below `staple-land` moved, and no card moves between two groups that
already existed. P5 holds: grouping is still the product's opinion, and the
score still only orders within a group.

The catch-all is renamed to `other` / "Everything else", with a rationale that
is true of it. That rename is the contract change this ADR exists for. It is a
rename rather than a third key because two groups both rendering as "Staples" —
one curated at the top, one holding the whole colour identity at the bottom — is
worse for the builder than either arrangement alone. The API validates no group
key (`schemas.ts` takes an array of plain strings), so a stale client asking for
`staple` gets the curated group and one asking for nothing gets everything;
neither errors.

---

## Decision 4 — identity, budget and bracket all still bind

**Colour identity** was never in question and is not bypassed: `isEligible` runs
before grouping, so a staple outside the commander's identity is not a candidate
at all and cannot appear in any group. **P6** likewise — an excluded card never
reaches grouping.

**Budget.** Everywhere else the per-card cap is a *score penalty*, and that is
right for a feed somebody is browsing, where an expensive card should sink
rather than vanish. It is wrong for a phase whose whole proposition is "these
are the picks you do not have to think about": leading a deck capped at $5 a
card with a $40 staple is the app ignoring a number the builder typed. A staple
over the cap does not qualify for the staples groups. It is not removed — it
falls through to whatever group it would have had, keeping its price and keeping
the penalty.

**Bracket.** Same shape. `recommend` is handed `gameChangerBudget`: how many
more Game Changers the deck may take before it exceeds the bracket the builder
chose, computed in the route because the Game Changers list lives in the corpus
and `packages/domain` does no IO (R1). A Game Changer with no room left does not
lead; it still appears, with its `bracket-warning` reason. Bracket flags are
still surfaced and never used to filter (doc 03 §3.2) — what is withheld is only
the product's endorsement of the card as an obvious pick.

**Absent `gameChangerBudget` means zero.** This is the one optional input in
`RecommendInput` that does not default to "no effect", because the no-effect
default here would be to spend an allowance the caller never said the deck had.
Default-deny is the only direction in which forgetting to pass it is safe. The
route reads a failure to load the bracket rules as zero for the same reason:
`loadBracketRules` refuses when the corpus supplies no Game Changers precisely
so a deck full of them cannot pass Bracket 1 vacuously, and reading that refusal
as "unlimited" would reintroduce the vacuous pass one layer up.

---

## Decision 5 — the phase ends by running out, not by being switched off

`quickbuildPlan` takes `staples: { spells, lands }` and prepends up to two gaps
of `kind: 'staples'` ahead of the derived order. The counts are the `total` of
the `staple` and `staple-land` candidate groups, read off the recommendations
response the workspace already holds.

Not recomputed from the list and the deck, deliberately. `recommend` has already
applied the colour identity, the accepted set, the exclusions, the budget cap
and the bracket allowance; `quickbuildPlan` has none of those inputs, and the
feed is on screen beside the panel — a second count computed here could
contradict the heading the builder is looking at. **One definition, two
surfaces** was the requirement, and this is what enforces it.

**The phase therefore ends by arithmetic.** Every accept and every rejection
removes a card from the group that produced the count, so the count falls by
one, and the gap disappears when the last one goes. There is no terminal state
to stall in, nothing to reset, and no empty group to sit on: `short > 0` is the
same condition that opens a composition gap. When both reach zero the plan is
byte-identical to the plan a caller that never sent the field would have got,
and ADR-0040's derived order leads — creature first, land last.

Prepended rather than sorted in, because `sort` weighs composition against curve
by cards owed against a target (doc 19 D3) and a staples count is neither owed
nor against a target. Mixing them would need a weighting this file has no basis
to invent, which is the thing `quickbuildPlan` already refuses to do.

`ordering` is unchanged and still describes the derived part underneath, because
it is still true of it. The panel does not print it while the staples phase is
running, because it is not the rule that put that gap there.

---

## Consequences

- `CandidateGroupKey` gains `staple-land` and `other`, and `staple` changes
  meaning. `apps/web` reads group keys as plain strings and the API validates
  none, so nothing rejects a stale request.
- `RecommendInput` gains optional `gameChangerBudget`; `QuickbuildInput` gains
  optional `staples`. Both are additive.
- `staples-resolve.test.ts` fails when a curated name stops resolving to a
  commander-legal card by exact string. Without it a typo or a Scryfall rename
  silently shrinks the list and **nothing else in the product goes red** —
  `recommend` would simply file the card elsewhere and every other assertion
  would still hold. It skips loudly against an unpopulated corpus, because CI
  runs a bare Postgres with no ingest and a red tick there would be a report
  about the CI service rather than about this list.
- The list is 27 cards and will be wrong for somebody. That is what an opinion
  with an owner and an edit button is for.
