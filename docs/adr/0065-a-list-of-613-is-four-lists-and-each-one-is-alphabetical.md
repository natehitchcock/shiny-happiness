# ADR-0065 — A list of 613 is four lists, and each one is alphabetical

**Status:** accepted
**Date:** 2026-09-05
**Extends:** [ADR-0046](0046-subtypes-and-keywords-are-semantic-tokens.md) (the
two generated families that took the vocabulary from 27 to 613),
[ADR-0048](0048-membership-is-a-third-direction.md) (`readable()` and the
subtype/keyword split as a UI fact), [ADR-0050](0050-an-absent-optional-field-is-not-a-claim.md)
(an uncounted tag is not a counted zero).
**Amends:** [ADR-0045](0045-the-offer-is-related-and-the-table-stays-unordered.md)
— its support ranking is no longer the order of `SemanticOffer`. `bySupport` is
unchanged and still the domain's answer to "which of these is worth the most";
it is simply not the question a 613-item list is asked.
**Changes:** one new export in `packages/domain/src/synergy.ts`; `SemanticOffer`
and one new component in `apps/web/src/App.tsx`; one CSS rule removed and two
added. No wire type, no migration, no change to scoring, and `EmphasisChoice` is
byte-identical.

---

## 1. The report

> "Split it into categories, ordered alphabetically, and say the 'nothing in
> your colours supports this' thing once instead of on every chip."

## 2. The defect

`FocusExpansion` renders "Every other semantic" as `remainingSemantics(…)`, which
is every tag the screen is not already showing. Measured on the fixture the tests
run against — one commander with two tags — that offer is **611 chips in one
undifferentiated run**, and on a real deck it is within a handful of the same
number.

Three things were wrong with it, and they are separable.

**It had no structure at all.** The vocabulary is assembled from three sources
with three different provenances, and the list said so nowhere:

| source | what it is | count |
| --- | --- | ---: |
| `EVENT_TAGS` in `synergy.ts` | behaviours curated by hand, one regex table each | **27** |
| `SEMANTIC_VOCABULARY.abilities` | keywords read off the corpus (ADR-0046) | **317** |
| `SEMANTIC_VOCABULARY.subtypes` | subtypes read off the corpus (ADR-0046) | **269** |
| `SYNERGY_TAGS` | the flat array the UI drew | **613** |

A builder opening this has a question of the form "I want a tribe" or "does
landfall have a payoff I have not thought of". Neither is answerable by scanning
613 chips in one paragraph.

**It was ordered by something invisible.** `bySupport` ranked the whole run by
`RecommendResult.tagSupport`, so the order encoded a number that was never
printed. That is defensible for the ~3 chips of "Related to your focus", which is
what ADR-0045 sized it for. Over 611 it produces a list with no scannable
property at all: not alphabetical, not grouped, and ordered by a quantity the
reader cannot see.

**It said one sentence up to 611 times.** Every chip whose support was a counted
zero carried its own `<span class="note dim offer-unsupported">nothing in your
colours supports this yet</span>`. A mono-black deck's colour identity excludes
four fifths of the tribal vocabulary, so this is not a rare branch — it is the
common rendering of the list.

## 3. Decision

### 3.1 Four categories, in a fixed order that is not alphabetical

1. **Mechanics** — the 27 curated events.
2. **Keywords** — the 317 `ability:*` tags.
3. **Types** — the 269 `subtype:*` tags.
4. **Not available in your colours** — every tag whose support is a counted
   zero, drawn out of the three above.

**The contents are alphabetical and the categories are not, and that is not an
inconsistency — they are ordering different things.** Inside a category the
reader is scanning a flat list for one word they already have in mind, and
alphabetical is the only order they can predict. The categories are four unequal
kinds, and the useful ordering principle there is size against value: 27 curated
behaviours are what a deck is usually *about* and are the shortest list, so they
lead; the 586 generated tags are the long tail behind them. Alphabetising the
headings would put "Keywords" first for no reason anyone could state.

**The fourth is last because it is a state, not a kind.** Mechanics, Keywords and
Types are facts about the tag. "Not available in your colours" is a fact about
*this deck*, and its members lose their family on the way in — an Elf and a
landfall trigger sit side by side there. A tag moves in and out of it as the
deck's colours change, which is not true of any heading above it, so it cannot be
mixed into that sequence and it cannot come first.

### 3.2 Sorted by the words on the chip, with `localeCompare`

`readable(tag)`, not the tag. `subtype:elf` reads **Elves** and belongs under E;
sorting the wire spelling files all 269 subtypes under S and all 317 keywords
under A, which is an order with no visible reason.

`localeCompare(other, 'en')` and not `<`. Keywords render lowercased and subtypes
capitalised, so a code-point sort puts every capital ahead of every lowercase —
and the fourth category is exactly where the two families meet. Three orders are
distinguishable on the same three tags and only one of them is alphabetical:

| ordering | result |
| --- | --- |
| wire spelling (`ability:flying`, `subtype:elf`, `subtype:goblin`) | flying, Elves, Goblins |
| code point on the label | Elves, Goblins, flying |
| `localeCompare(…, 'en')` | **Elves, flying, Goblins** |

The locale is pinned rather than left to the host, because doc 05 requires the
same deck and dataset to draw the same order every time and the vocabulary is
Magic's own English.

### 3.3 The classifier is in the domain, and in `synergy.ts` specifically

```ts
export type SemanticCategory = 'mechanics' | 'keyword' | 'type'
export const semanticCategory = (tag: SynergyTag): SemanticCategory => { … }
```

`apps/web` must not know that a subtype is spelled `subtype:`. That is the
domain's own taxonomy, and a UI that re-derives it is a second opinion that
cannot be told when the first one changes.

**`synergy.ts` and not `semantic-tokens.ts`, which looks like the obvious home.**
The prefixes live in `semantic-tokens.ts` and so does `isSemanticTag`. But this
function has to be **total over `SYNERGY_TAGS`**, `SYNERGY_TAGS` is
`EventTag | SemanticTag`, and `semantic-tokens.ts` is imported *by* `synergy.ts`
— so it cannot see `EventTag` without an import cycle. The file that owns the
union owns the classifier. `semantic-tokens.ts` keeps owning the prefixes, and
`synergy.ts` imports the two constants rather than retyping the strings.

`mechanics` is the fall-through rather than a membership test against
`EVENT_TAGS`, and the argument type is what makes that sound: a `SynergyTag` that
carries neither prefix *is* an `EventTag`.

### 3.4 R4 — nested groups, and a heading level per category

`SemanticOffer` was already a `role="group"` named by its `<h4>`. Each category is
a `role="group"` named by its own `<h5>`, **nested inside** that group.

**Nested and not four siblings.** Four sibling groups would each name themselves
and nothing else: a reader who tabs onto "Elves" would hear "Types" with no way
to learn they are inside "Every other semantic" rather than "Related to your
focus". Nesting means both boundaries are crossed on the way in and both are
announced, in the order they contain each other.

**A compound `aria-labelledby="offerHeading categoryHeading"` was written and
thrown away.** It gives one group named "Every other semantic Types", which reads
correctly once and then repeats the offer's heading on all four — and it flattens
a real containment into a name, so nothing tells the reader they have *left* the
offer when they leave it.

**`<h5>` under the `<h4>`, which is the second route in.** Heading navigation is
how a screen-reader user actually skims a list this long, and it costs nothing:
the level was already free below the offer's own heading.

An empty category renders `null` — no heading over no chips — which is the rule
`SemanticOffer` already applied to itself.

### 3.5 The per-chip note becomes the fourth heading

`.offer-unsupported` is deleted from `styles.css` (it had no other user) and the
span is gone. The category carries one `<p class="note dim">`: *"Nothing in your
colours supports these yet. You can still focus one — nothing is hidden either
way."* Deliberately not an error colour and not `role="alert"`: emphasis reorders
and never filters, so this reports what was counted rather than warning against
clicking it.

**A counted zero moves a tag; an uncounted tag does not.** `support` absent means
no pool has been counted at all — the commander prompt runs before a deck exists
— and a tag missing from a map that *does* have counts is the absence of an
answer, not the answer nothing. That is ADR-0050's rule, and it is the same one
`bySupport` applies. Where there are no counts there are three categories and no
fourth.

## 4. What was refused

**`EmphasisChoice`, and this is the important one.** That is the commander's own
semantics, on the start screen and under "Add a focus". Its list is a median of
three or four chips, so it has no scanning problem to solve — and its order is
`synergyHas`, then `produces`, then `wants`, which is *that commander's story*
told in ADR-0048's row order. Sorting it alphabetically would destroy the one
thing it says. It is also passed `support={undefined}` on the start screen, so it
has no unavailable bucket to gain. It is untouched, and the existing comment on
`shown` explaining why its order means something is now load-bearing rather than
decorative.

**Keeping `bySupport` on top of the categories.** Ranking by support and grouping
by kind are two orders over one list, and a list can only have one. Ranking
*within* a category was the tempting compromise and is worse than either: the
reader would see a category, expect a list, and get an order derived from a
number that is still not printed. The count that ranking existed to surface is
now the fourth heading, which says the same thing where it can be read.

**Dropping the unsupported chips instead of moving them.** Emphasis reorders and
never filters — the interface says so in words, in the note above this very
control — and a category is not a filter. Every chip in the fourth category is a
live, enabled toggle with a working pressed state.

**Alphabetising the four headings.** Recorded here because it is the obvious
objection to §3.1: the contents are alphabetical, so why are the headings not.
Because there is a better ordering principle available for four items chosen by
hand, and there is not one for 317.

**A `SemanticCategory` for the fourth bucket.** It is not a kind of tag and the
domain has no way to compute it — it depends on a per-deck count that
`packages/domain` never sees. The classifier answers three, and the fourth is
assembled in the component that holds the counts.

## 5. Consequences

**Support ranking has no production caller left.** `bySupport` was imported by
`App.tsx` for exactly these two offers and by nothing else. It is deliberately
kept, exported and tested: it is the domain's correct answer to a question the
product still asks in `recommend.ts`'s own comments, and the next surface that
ranks an offer of three should use it rather than write it again. Recorded
plainly so a later reader does not mistake it for dead code — the comment at its
definition and the one at `App.tsx`'s import both now say why it is not called.

**One existing test was rewritten rather than deleted.** `emphasis.test.tsx` —
"leads with the semantic more of the deck's colours actually supports" — asserted
`lifeloss` at 60 ahead of `creature-death` at 2 in the related offer. That claim
is superseded by §3.1 and the test now pins the new order under its own name,
with the old claim quoted in place so the change is visible where it was made.

**The ADR's own brief said 29 curated event tags; there are 27.** Counted from
`EVENT_TAGS` at `packages/domain/dist/synergy.js`, which makes the total 613 and
not 615. Every number in this document is measured rather than quoted.

**Two tags render the same words, and that is pre-existing.**
`readable('treasure')` and `readable('ability:treasure')` are both "treasure", so
two chips in the offer now carry the accessible name "Emphasise treasure" — one
under Mechanics and one under Keywords. The categories make the collision
*visible* rather than causing it; before this change the two sat somewhere in a
run of 611 and nobody would meet them together. It is not fixed here because
fixing it means editing the curated table in `apps/web/src/tags.ts` or the
derived one in `semantic-tokens.ts`, and either is a change to what a tag is
called across every surface. `semantic-categories.test.tsx` counts chips rather
than comparing labels, with a comment saying why.

## 6. Testing

**`packages/domain/src/synergy.test.ts` — "which kind of thing a tag is".** Four
tests. The load-bearing one walks all 613 of `SYNERGY_TAGS` and asserts every one
lands in exactly one of the three kinds; a second pins the three counts to
`EVENT_TAGS.length`, `SEMANTIC_VOCABULARY.abilities.length` and
`…subtypes.length`. That is the cheapest guard there is against a fourth
generated family being appended and silently vanishing from the UI behind a
heading that would then be a lie.

**`apps/web/src/semantic-categories.test.tsx` — 18 tests, new file.** The four
categories get their members; a zero-support tag moves out of its family and into
the fourth whichever family it came from; the chips partition (the four category
counts sum to the offer's, so nothing is duplicated or lost); the sentence is
rendered exactly once for four unsupported tags and `.offer-unsupported` is gone
from the DOM; the order is `Elves, flying, Goblins`, which distinguishes
alphabetical from *both* the wire spelling and a code-point sort; an empty
category draws neither a group nor its text, asserted on "Related to your focus",
which is event-only by construction and so has empty Keywords and Types every
time; `support === undefined` on the start screen yields three categories and no
fourth; every category group's `aria-labelledby` resolves to a real `<h5>` it
contains, inside an offer whose `<h4>` still governs; and `EmphasisChoice` keeps
the commander's own order — asserted with a commander whose three tags span all
three categories and whose own order is the exact reverse of the alphabetical one.
