# ADR-0062 — A qualifier is read where the focus is chosen, and only when every wanter agrees

**Status:** accepted
**Date:** 2026-09-05
**Amends:** [ADR-0057](0057-a-want-says-which-event-a-qualifier-says-which-cards.md) — its
§9 reason chip was the only place the qualifier was ever rendered, and that is
the wrong moment. **Extends:** [ADR-0046](0046-subtypes-and-keywords-are-semantic-tokens.md)
(`readable()` owns a tag's own words), [ADR-0048](0048-membership-is-a-third-direction.md)
(three directions on the card panel).
**Changes:** one new export in `packages/domain/src/qualifiers.ts`, one function
in `packages/domain/src/recommend.ts` reduced to a wrapper over it, and three
render sites in `apps/web/src/App.tsx`. No wire type, no migration, no change to
what the recommender scores or orders.

---

## 1. The report

> "show the qualifier on the commander's semantic, so you know there are
> qualifiers when you select a semantic focus"

## 2. The defect

ADR-0057 derives the qualifier, stores it per wanter, subtracts it in
`synergyMatches`, and carries it to the client on `Reason.qualifier`. It is
rendered in exactly one place in the product:

```ts
// apps/web/src/App.tsx, inside a suggestion's reason sentence
const restricted =
  r.qualifier === undefined || r.qualifier === '' ? tag : `${tag} (${r.qualifier})`
```

That sentence needs a suggestion, a suggestion needs a deck, and a deck needs
the focus to have already been chosen. The focus prompt runs strictly earlier —
`FocusExpansion` is passed `support={undefined}` there with the comment "no deck
exists yet, so no pool has been counted" — so at the one moment the restriction
changes the reader's answer, nothing on screen said a restriction existed. The
chip read `casting spells`, which is what it read for a commander with no
restriction at all.

The same hole is in the card panel. "Benefits from: casting spells" is printed
for every card in the pool, and half of them mean something narrower.

## 3. The measurement

Against the production corpus, commander-legal cards, `wants` including
`spell-cast`:

| | cards | qualified | unqualified |
| --- | ---: | ---: | ---: |
| all commander-legal | 904 | **468** | 436 |
| legendary creatures | 237 | **127** | 110 |

It is a coin flip, and the legendary-creature row is the one that matters here
because those are the cards a focus prompt is ever asked about. **127 of the 237
commanders that offer "casting spells" mean something narrower by it**, and the
chip said the same two words for all 237.

What the 468 actually say, most common first:

| phrasing | clauses |
| --- | ---: |
| `noncreature` | 223 |
| `instant or sorcery` | 188 |
| `instant` | 14 |
| `costing 4 or more` | 10 |
| `costing 5 or more` | 9 |

The top two are the whole of the interesting case and they are **not the same
set**: every `spell-cast` supplier is an instant or a sorcery by type line
except the 186 adventure and MDFC creature-halves ADR-0057 §4 names, so
`noncreature` and `instant or sorcery` differ on exactly those. Two partner
commanders holding one each therefore disagree, and §5 below is why that prints
nothing rather than picking one.

## 4. Decision

**One rule, in one place.** `restrictionWords` in `recommend.ts` already knew
when a restriction may be printed. Its body moves to
`packages/domain/src/qualifiers.ts` as `agreedRestriction(totalWeight,
qualified)` and `restrictionWords` becomes a two-line wrapper that reads the
deck's shape into it. The web calls the same export. A second copy in `apps/web`
was written first and thrown away: the feed's sentence and the chip's would then
be two independent opinions about one card, which is the failure mode
`suppliedWants` exists to prevent one level down (ADR-0057 §12.3, where four
callers had written the intersection out by hand and two of them were wrong).

**The rule is unchanged.** A restriction may be printed only when every wanter
of the tag is qualified (`covered >= totalWeight`) and all of them agree on the
same words. Otherwise `null`, and the caller prints the bare, wider, TRUE claim.

**Weights are a comparison, never a display.** `recommend.ts` passes ADR-0057's
per-wanter deck weights, where a commander outweighs a spell. The web passes one
unit per commander, because on that screen every wanter is a commander and "did
every one of them carry a qualifier" has the same answer whatever the unit. That
is why the extracted signature takes a total and a list rather than a
`DeckSynergy`.

**Built beside `commanderTags`, at both of the two places that assemble it.**
The start screen builds one from `chosen`; the workspace builds one from
`deck.commanders` in the `useMemo` next to its own. Both sites already carry a
comment saying the two lists must not diverge — this is a second thing that must
not diverge, in the same two places, and it is the same function at both.

**Three render sites, and the qualifier is TEXT at all three.**

1. `EmphasisChoice`, which is the start screen's "Pick any of {commander}'s
   semantics" and the workspace's "Add a focus". The chip reads
   `casting spells (instant or sorcery)`. It takes the map as an optional prop;
   absent means render as before, which is not the same claim as "there is no
   restriction" and is the only honest thing a component with no map can say.
2. `Semantics`, the card panel's "Benefits from" row, derived from the SHOWN
   card's own oracle text rather than handed down. The panel opens on any card
   in the pool and the restriction is a fact about whichever one is in front of
   the reader. No agreement rule is applied and none is needed: one card cannot
   disagree with itself, and `deriveWantQualifiers` already returns nothing for
   a card whose own triggers disagree (ADR-0057 §5).
3. `TagChip`'s popover, which gets ONE new `hint-line` — "Only instant or
   sorcery cards count. Anything else causes casting spells without benefiting
   this card." The brackets on the chip name the restriction; they have no room
   for its consequence, and the consequence is the reason a reader cares.

**R4: the accessible name carries it.** The chip is a bare `<span class="tag">`
with no `aria-label`, so its accessible name is its text content — appending the
qualifier to that text extends the name rather than competing with it, and a
screen reader reads the restriction as part of the chip. Nothing is conveyed by
the parentheses themselves; they are punctuation around words that are read
aloud either way. The `EmphasisToggle` beside the chip keeps its existing label
untouched, because a second copy of the restriction on the button would be the
same fact announced twice for one control.

## 5. What was refused

**`SemanticOffer` — "Related to your focus" and "Every other semantic".** These
are corpus-wide vocabulary reached through `relatedSemantics` and
`remainingSemantics`, not a want any card on screen stated. A qualifier there
would be a claim about a card the reader is not looking at, which is precisely
the error §4's agreement rule exists to prevent. They render exactly as before.

**Merging two partners' restrictions.** `noncreature` and `instant or sorcery`
have no single true intersection a chip could print, and picking either would
describe one partner's card while showing both. ADR-0057 §5 refused the same
merge one level down for two triggers on one card, on the same ground and after
finding three different right answers among the 45 cards that state two. The
refusal is cheap in the same direction: it fails to sharpen a pair and can never
wrongly narrow one.

**A qualifier on a `produces` or `has` chip.** A want qualifier constrains which
cards can cause the event FOR the wanter. It says nothing about what this card
causes or is, and printing it on the supply side would be a claim nothing in the
model checks. Bonus Round carries `spell-cast` on both rows and its two chips
now read differently, which is what makes the rule testable rather than
theoretical.

**Encoding the restriction into `readable()`.** `tags.ts` is the one place a
tag's own words are written, and the qualifier is a modifier on a particular
card's want rather than part of what the tag means. ADR-0057 §9 made the same
call for the reason chip and this agrees with it, which is also why the two
surfaces print the identical shape.

**Weighting the web's commanders the way the deck weights its wanters.** It
would have meant importing `COMMANDER_WEIGHT` to multiply every term by four and
compare the results, which changes no answer this function can give.

## 6. Consequences

**This is visible on `spell-cast` and on nothing else.** `QUALIFIABLE_TAGS` is
deliberately a one-element set — `QUALIFIABLE_TAGS` in `packages/domain/src/qualifiers.ts`, so `deriveWantQualifiers` returns
a qualifier for that tag alone and every other chip in the app renders
byte-identically to before. The render sites here are general — they take a
tag→words map and a per-card derivation, neither of which names `spell-cast` —
so the day a second tag joins that set, all three sites carry it with no further
UI work. Recording that plainly is the point: the plumbing is general, the
vocabulary is one tag, and the gap between those two facts is the thing a later
reader would otherwise mistake for an unfinished feature.

**Nothing about the model changed.** `recommend.ts` produces the same scores,
the same order, the same reasons and the same `qualifier` strings it did before;
`restrictionWords` is a rename of its own body. No existing test was edited.

**No wire change and no migration.** The qualifier is derived on the client from
`oracleText`, which the eligible read already ships (ADR-0057 §7's "derived, not
stored"). `synergy_wants` is untouched and `wants:spell-cast` in the search box
keeps meaning what it meant.

## 7. Testing

Three gaps, all real, all now closed.

**`packages/domain/src/recommend.test.ts` — "a restricted want reaches the
reason".** Nothing anywhere asserted that `Reason.qualifier` is ever populated;
the whole derivation could have stopped reaching the reason and the suite would
have stayed green. `carries the restriction in words` pins a Zaffai-shaped
`DeckSynergy` to `{ kind: 'keyword-synergy', tag: 'spell-cast', direction:
'enables', withOracleIds: [], qualifier: 'instant or sorcery' }`, and `drops the
restriction when part of the deck wants the tag unqualified` pins the other
half.

**`packages/domain/src/qualifiers.test.ts` — `agreedRestriction`.** Six cases:
the whole of the want, two wanters agreeing, two disagreeing, one unqualified,
nothing qualified, and a qualified entry whose words are empty.

**`apps/web/src/semantic-qualifiers.test.tsx` — eight, through the controls a
person uses.** The chip on the start-screen prompt; an unrestricted commander
rendering unchanged; two partners disagreeing; one qualified partner beside an
unqualified one; a single restricted commander keeping it; the card panel
deriving it for a non-commander; the tooltip's sentence; and the `produces` chip
never taking it.

Every one was mutation-checked with the Edit tool rather than `sed` — the
working tree is `core.autocrlf=true` and a multi-line `sed` pattern silently
matches nothing there, which is the ordinary way a mutation check passes for the
wrong reason (ADR-0061 records the same trap). `pnpm build` was re-run between
each domain mutation and the web suite, because `apps/web` resolves
`@roundtable/domain` from `dist` and one run against a stale build reported a
false survivor before the rebuild was added.

| mutation | tests killed |
| --- | ---: |
| `covered < totalWeight` check removed | 3 |
| `distinct.size === 1` check removed | 2 |
| `EmphasisChoice` chip back to `readable(tag)` | 2 |
| the new `hint-line` removed | 1 |
| `direction === 'wants'` guard removed | 3 |
| the reason's `qualifier` field dropped | 1 |
