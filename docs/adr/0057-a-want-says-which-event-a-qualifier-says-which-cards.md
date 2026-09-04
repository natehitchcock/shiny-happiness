# ADR-0057 — A want says which event; a qualifier says which cards

**Status:** accepted, **amended 2026-09-03** — see §12 and §13.
**Date:** 2026-09-03
**Supersedes:** nothing. **Extends:** ADR-0011 (mechanical synergy), ADR-0046 (subtypes and keywords), ADR-0048 (membership is a third direction).
**Amends:** ADR-0038, whose price for refusing name-substitution is corrected in §13.

> **Two claims below are wrong and are corrected in place.** §5's "everything
> refused here is refused by being over-inclusive" has an exception, and it is
> half of everything the qualifier removed — §12. §11's "both production
> callers pass it" undercounted by two — §12.3. Both were found by playtest
> within hours of shipping.

---

## 1. The report

> "we should work on semantic qualifiers. Y'shtola for example, only wants spell
> cast that are a certain mv or higher. There should be qualifiers tied to some
> semantics that constrain which cards can benefit or cause that specific
> semantic. So, for example, counterspell doesn't cost enough to fire off
> Y'shtola's ability, so it should not be considered a spellcast that triggers
> Y'shtola."

Verified against the corpus:

```
Y'shtola, Night's Blessed  [Legendary Creature — Cat Warlock]
Vigilance
At the beginning of each end step, if a player lost 4 or more life this turn, you draw a card.
Whenever you cast a noncreature spell with mana value 3 or greater, Y'shtola deals 2
  damage to each opponent and you gain 2 life.

  produces = ["damage","lifegain","player-damage","card-draw"]
  wants    = ["spell-cast"]
```

Counterspell produces `spell-cast` and costs two, so the model scored it as an
enabler for her and the chip read "enables your casting spells". The card does
not trigger her at all.

---

## 2. The measurement

Each want was attributed to the sentence that produced it — derive the profile
with one sentence as the card's text, subtract the profile derived with no text
at all, and what is left is the set of want tags that sentence is responsible
for. No private table was exported; the real rules were used.

Over the 31,782 commander-legal cards there are **16,845 want clauses** on the
curated events. **2,098 of them (12.5%) carry a qualifier on the TRIGGER.**

The trigger, not the sentence, and that distinction is most of the number.
Classifying the whole sentence gives 44.8%, and 3,478 of those are "you
control" — which is not a qualifier but the SUBJECT question, and ADR-0022 and
ADR-0054 already model it.

| kind | clauses | cards |
| --- | ---: | ---: |
| zone | 1,045 | 994 |
| card-type | 960 | 907 |
| subtype | 133 | 132 |
| ordinal-count | 118 | 117 |
| colour | 62 | 49 |
| timing | 57 | 55 |
| **mana-value** | **47** | **46** |
| keyword-restriction | 40 | 40 |
| power/toughness | 28 | 27 |
| counter-threshold | 4 | 4 |

Mana value is SEVENTH, and it is the one that matters. See §4.

---

## 3. What it removes

A currently-scoring pair is (a card that wants tag T) × (a card that supplies T
through `produces` or `has`). The corpus holds **20,896,723** such pairs.

| kind | clauses | pairs touched | removed | % of touched |
| --- | ---: | ---: | ---: | ---: |
| card-type | 987 | 3,729,665 | — | 4.1% on `spell-cast` |
| mana-value | 47 | 216,661 | 147,271 | 68.0% |
| colour | 57 | 149,433 | 111,828 | 74.8% |

With disjunctions handled properly — "instant OR sorcery" is one predicate, not
two — the honest total is **570,255 pairs, 2.73% of all currently-scoring
pairs.** That is the number the decision turned on: the model gets sharper and
the feed does not go quiet.

---

## 4. The surprise, and it changed what was built

Y'shtola is over-broad on two axes and **only one of them bites.**

The producer rule for `spell-cast` is the type line "Instant|Sorcery", so every
supplier is an instant or a sorcery by construction:

```
spell-cast suppliers, corpus-wide             7,211
  of them already noncreature                 7,025  (97.4%)
her "noncreature" clause therefore removes      186  (2.6%)
her "mana value 3 or greater" floor removes   2,971  (41.2%)
```

In her own colour identity (BUW, 4,085 suppliers): 1,692 (41.4%) fall to the
floor, 95 (2.3%) to the type test, 2,326 (56.9%) survive both.

**The brief emphasised the type axis and the corpus says it is nearly a no-op.**

The type axis is kept anyway, for two reasons that are not "it was asked for":
it is what the reason chip must say to be honest, and the 186 exceptions are
real — an adventure or MDFC creature whose other half is an instant produces
`spell-cast` from the joined type line and triggers nothing when the creature
half is cast.

---

## 5. What is honoured, and what is refused

One test decides: **can it be evaluated against a candidate card's own
columns?** `mana_value`, `types` and `colors` are all in the eligible read
already, so no producer has to advertise anything — the matcher reads the
candidate. That asymmetry is what makes this affordable.

**Honoured:** mana-value, card-type, colour.

**Refused, each on a measurement:**

- **ordinal-count (118), timing (57), accumulated-threshold (51).** "Your second
  spell each turn", "during your turn", "if a player lost 4 or more life this
  turn" — Y'shtola's own first line is the third of these. All are facts about
  GAME STATE, and no property of a candidate card can satisfy or fail one. A
  qualifier that cannot be evaluated is not a qualifier; it is a note.
- **zone (1,045).** 1,001 are `graveyard-creature`, whose tag IS "a creature
  card in a graveyard". The zone is the tag's own definition, and reading it as
  a constraint would have the tag exclude the only thing it means. This was the
  largest single kind in the table and it is not a kind at all.
- **subtype (133) and keyword-restriction (40).** Already carried. ADR-0046's
  `subtype:*` and `ability:*` families fire on exactly these clauses and the
  same-tag-opposite-direction relation already scores them. Re-expressing them
  here would be two names for one claim — the ground `semantic-tokens.ts`
  refused `subtype:treasure` on.
- **Qualifiers on payoff-only tags (114 clauses).** `creature-cast` has no
  producers at all, by ADR-0054's deliberate refusal, so a qualifier on it
  removes exactly zero pairs.
- **A card with two DISAGREEING qualified triggers (45 cards).** Two triggers
  are a disjunction and a flat qualifier list is a conjunction. Every merge rule
  that fits some of them breaks the rest — Primeval Bounty triggers on "a
  creature spell" AND "a noncreature spell", which intersects to nothing and
  unions to every spell — so the card keeps its unqualified want. That is the
  safe direction: it fails to sharpen 45 cards and can never wrongly exclude
  one. Identical triggers are collapsed first, which is the commoner case.

**Deferred:** power/toughness (28) and counter-threshold (4). Evaluable, but the
populations are too small to earn the machinery.

> **AMENDED.** This section said, of the refusals: *"everything refused here is
> refused by being over-inclusive, so no candidate is ever excluded on a
> qualifier the model only half understands."* **That is false for one family**,
> and the exception was 54% of everything the qualifier removed. See §12. The
> claim holds for every kind listed above; it does not hold for words the
> capture picked up that were never about the spell in the first place.

---

## 6. Exclude, not reduce

A tag qualifier is a **game rule**, and a trigger has no partial state:
Counterspell does not half-fire Y'shtola. The owner's words were "should not be
considered", and the measurement says exclusion costs 2.73% of pairs.

ADR-0058 makes the **opposite** ruling one level over, for roles, and the
difference is what the two things are. A role qualifier is a judgement about
coverage — Disenchant really is removal — where this is a fact about the rules.
Stating both rulings side by side is the point: they are not inconsistent, they
are about different kinds of claim.

---

## 7. Storage: nothing is stored

ADR-0048's rule applies verbatim: *store a derivation whose inputs the read does
not need; derive one whose inputs it already carries.* The input here is the
wanter's own `oracle_text`, which is column ten of the twenty-four the eligible
read already ships.

So `synergy_wants` stays `text[]`, **there is no column, no migration and no
re-ingest**, and `wants:spell-cast` still matches a qualified want because the
stored array never changed. The qualifier rides BESIDE the tag, never inside the
string.

Derived for the **deck's** cards only — at most a hundred per request — and
never for the candidate pool, because the qualifier lives on the wanter and the
candidate is judged by its own `manaValue`, `types` and `colors`.

**Encoding it in the string was refused on two concrete breakages**, not on
taste: `evaluate.ts` matches `wants:` by exact string equality, so
`spell-cast?mv>=3` is a tag `wants:spell-cast` cannot reach; and `SYNERGY_TAGS`
is an append-only persisted contract that migration 0014 sorts stored deck
emphasis into, so a new spelling silently reorders scoring ties for decks that
already exist.

**A jsonb column was refused** because it would cost a migration and a full
re-ingest to buy back a regex pass the read can already afford.

---

## 8. The filter

`wants:spell-cast` still matches a qualified want, and **needs no code change to
do so** — the stored array is untouched, so the existing exact-equality
predicate keeps working. The tag is still wanted; it is wanted conditionally.

On a qualifier a user cannot express: `wants:spell-cast>=3` is lexically free
today (the tokenizer takes the earliest operator, so the `:` wins and
`spell-cast>=3` arrives intact) and dies at validation with a did-you-mean list.
`role:spot-removal(artifact)` is **not** free — `)` terminates a word token and
the dangling closer used to be swallowed in silence. Both halves of that were
fixed as their own commit, independently of whether the syntax ever ships.

---

## 9. Reason text (pillar P4)

The chip reads:

```
enables your casting spells (noncreature, costing 3 or more)
```

Parenthetical rather than woven into the phrase: "enables your casting
noncreature spells costing 3 or more" reads as one long noun and buries the
restriction in the middle of it, and the bracket marks it as a narrowing, which
is what it is. It also keeps `apps/web/src/tags.ts` as the one place a tag's own
words are written.

The qualifier is printed **only when every wanter of the tag is qualified and
they agree.** Two failures, both silent, both printing the wider-but-still-true
sentence:

- some wanter is unqualified — Y'shtola and Guttersnipe in one deck genuinely
  want any spell, and printing her restriction would describe half the deck as
  the whole of it;
- the qualified wanters disagree — two commanders with different floors have no
  one restriction.

`enables` only. The payoff direction is not qualifier-aware; see §10.

---

## 10. What is knowingly not done

**The payoff direction.** `enables` reads the DECK's qualifiers against ONE
candidate, which the matcher has. `payoff` would read the CANDIDATE's qualifiers
against every card in the deck that supplies the tag, and `deck.produces` is a
weight rather than a list of cards. They could be carried — a deck is a hundred
cards and three scalars each — and it is deferred because the error is far
smaller and far less visible: `enables` is what puts Counterspell in the feed
under Y'shtola, which is the report this came from.

**`supertype:legendary` as a TAG, and this is the deferral worth reading.**

183 commander-legal cards key off a legendary permanent — "another legendary
creature you control", "target legendary creature", "search your library for a
legendary creature" — and **181 of them (99%) carry no tag mentioning it.**
Legendary is on 4,008 cards, 12.6% of the corpus, which is well inside the
breadth ADR-0046 accepts (it refused `Creature` at 55.9%; the widest live tag is
`artifact-etb` at 33.6%). Honouring it would add 183 × 4,008 = **733,464 pairs,
+3.5% of the corpus total.** The payoff class by ADR-0046's own templates is 124
distinct cards.

It is deferred, and the blocker is not a list:

> **Magic sets supertypes in LOWER CASE in rules text**, and the leading-capital
> match in `semantic-tokens.ts` is the entire precision mechanism of the subtype
> family — it is what makes "target Human" a reference and "the human cost" not
> one. The ingest's inertness filter (`subtypeLive`, "does any card want this")
> would therefore count **zero** wanters for `Legendary` and refuse the word even
> after the generator learned to read left of the em dash.

The full cost is: a second extraction pass over the left of the em dash in
`apps/ingest/src/semantic-vocabulary.ts` (which reads `parts[1]` and nothing
else, by construction); a third tag prefix beside `subtype:`/`ability:`; a
widened `SemanticTag` union and `SemanticVocabulary` interface; a new JSON key;
a bespoke case-insensitive matcher that abandons the casing invariant; and a
re-ingest.

**What shipped instead: `is:legendary`.** One predicate reading the FRONT of a
type line — Westvale Abbey is `Land // Legendary Creature — Demon`, and a card
whose back face is legendary is not a legendary card you can cast. The scorer
does not get the pair; the builder gets the filter. See ADR-0046's
found-and-not-done.

**The effect side (the produces direction), measured and refused.** 22,034
produce clauses were attributed the same way; 4,232 (19.2%) name a type, subtype
or colour in the effect's object.

- **card-type, 4,004 clauses — refused wholesale.** It decomposes as
  `damage|card-type` 1,339 ("deals 3 damage to target creature"),
  `plus1-counter|card-type` 1,034, `creature-death|card-type` 650. Every one is
  the effect's NATURAL OBJECT, not a restriction on it. "Deals 3 damage to
  target creature" does not restrict a damage spell; it *is* what a damage spell
  is. A card-type on the WANT side is a fact the model does not otherwise hold;
  on the PRODUCE side it is already said by `primaryRole` and by ADR-0058's
  answer scope. Honouring these would tag most of the format and rebuild ADR-0058
  inside the tag vocabulary.
- **subtype, 338 clauses — refused because it is already carried, 96% of the
  time, in the direction that scores.** Of 371 word-instances, 179 land in
  `wants`, 117 in `has`, 59 in `produces` and 16 nowhere. The `wants` landing
  looks like a direction inversion and is not: Nature's Lore and Three Visits
  carry `wants: [subtype:forest]`, Farseek carries all four, Wooded Foothills
  carries `subtype:mountain` and `subtype:forest` — and "wants Forests" is the
  right claim for a card that fetches one, because it needs the deck to hold
  them, and it pairs with `has: subtype:forest` on every Forest in the deck
  through the relation ADR-0046 already has. **The owner's "fetch a Forest"
  example was already carried and already prioritised.**

---

## 11. Consequences

- `SynergyProfile.wantQualifiers` is a new optional field (not a contract change
  per AGENTS.md R2). `DeckSynergy.qualifiedWants` is additive beside `wants`,
  which stays the honest total of what the deck wants.
- `synergyMatches` takes an optional `candidate` in its options. **Absent means
  "the caller did not ask", never "this candidate satisfies the qualifier"** —
  the answer is then the unqualified, over-inclusive one, which can waste a slot
  in the feed but can never report a real payoff as no use. Both production
  callers pass it and a test pins the fallback so it cannot go quiet.
- `Reason.qualifier` is a new optional wire field, rendered words rather than
  the structure, because it is a modifier on a phrase from `tags.ts`.
- Nothing to re-ingest and nothing to migrate.

> **AMENDED.** "Both production callers pass it" undercounted by two. There were
> four, and the two that were missed are the two that do not go through
> `synergyMatches` at all. See §12.3. The re-ingest line is also no longer true
> of the branch as a whole — §13 changes a stored column.

---

## 12. Amendment: the capture was wrong in the exclusionary direction

Two playtests, hours after this shipped. Three defects, of which the first makes
the model **worse than before the qualifier existed**.

### 12.1 The target clause, and the claim in §5 that is false

`parseObject` read the whole captured trigger-object phrase. In

> "Whenever you cast a spell **that targets this creature**"

the word `creature` describes the **target**, not the spell — and it became
`card-type: include ['creature']`. Every `spell-cast` supplier is an instant or
a sorcery by construction (§4), so the surviving set is exactly the 186
adventure and MDFC creature-halves: **the only suppliers that cannot trigger a
Heroic creature.** The filter was perfectly inverted.

Measured over the 31,782 commander-legal cards against the 7,211 `spell-cast`
suppliers:

| | before | after |
| --- | ---: | ---: |
| cards deriving a qualifier | 493 | 437 |
| pairs removed | 710,860 | 311,059 |
| of which contributed by the target clause | **383,446** | **0** |
| cards left with zero surviving suppliers | 0 | 0 |

Zero, not fewer. Striking the target clause and everything after it out of the
text by hand and re-deriving now gives the **identical** answer for all 86 cards
in the family, which is the check that says the words are not reaching the
qualifier at all rather than merely reaching it less often.

`Phalanx Leader` 186 → 7,211. `Battlewise Hoplite` 186 → 7,211.
`Vesuvan Duplimancy` 195 → 7,211, whose chip had read "creature or artifact"
about a card that cares about neither.

**Why §5's safety argument does not cover this.** The refusals in §5 are refusals
of a *stated* qualifier that cannot be evaluated, and dropping one always widens
the answer. This was not a refusal at all — it was **surplus words**, and surplus
words in a conjunction are exclusionary. The general form of the corrected rule:
*the qualifier may only read words that describe the spell that was cast.*

### 12.2 The other two boundaries in the same capture

- **A SECOND EVENT.** `Faldorn, Dread Wolf Herald` — "Whenever you cast a spell
  from exile **or a land you control enters from exile**" — is two triggers, and
  the capture ran to the first comma and swallowed both, deriving `land`. On a
  fresh Faldorn deck the API offered 1,797 candidates and **eleven** enabler
  rows, all MDFCs with a land back face, chipped *"enables your casting spells
  (land)"*; Reiterate, Comet Storm, Reverberate and Chaos Warp got no chip.
  Three cards in the corpus state one. The marker is a **verb**: a disjunct
  naming another kind of spell is a bare noun phrase, where a disjunct that is
  its own event has to say what happens. Scanned per disjunct, because "an
  instant or sorcery spell or activate an ability" (Unbound Flourishing) must
  end at the SECOND `or` — a search over everything after the first would find
  `activate` and cost the card its `sorcery`. `Appa, Steadfast Guardian` is the
  control: the same "from exile" trigger with the comma in the right place,
  deriving nothing before and nothing after.
- **A SERIAL COMMA.** `[^,.)\n]` ended the phrase inside "a spell that's white,
  blue, black, or red", so `Quirion Dryad` and `Questing Druid` derived `white`
  alone and were the only two cards the qualifier silenced to **zero** candidates
  on a real deck. The comma that ends a trigger is followed by a clause; a list's
  comma is followed by another item, and the difference read is the serial comma
  itself — at least one interior `word,`. That `+` is load-bearing: with `*` the
  phrase "a noncreature spell, and create a 1/1 white Spirit creature token"
  continues through the effect and the card claims to want white creature spells.

76 cards change in total and every one is in those three families. Y'shtola,
Kalamax (keeps `instant`, drops the ordinal), Mizzix (keeps `instant or
sorcery`) and Appa are untouched.

### 12.3 §11's caller count was wrong: there were four

The claim was "both production callers pass it; a test pins the fallback so it
cannot go quiet." `recommend.ts` and `cut.ts` go through `synergyMatches` and
were right. Two more make the same claim without it:

- **`apps/web/src/deckweb/model.ts`**, which built its Benefits edges with a raw
  string intersection and printed, verbatim: *"Pongify causes casting spells;
  Y'shtola, Night's Blessed benefits from it."* Pongify is mana value 1. Eight
  false edges into her and twenty-one into Brinelin ("costing 6 or more") out of
  26 in-deck suppliers — on the surface that states the claim most explicitly.
- **`App.tsx`'s "Synergises with" panel**, which makes it **twice**: once for
  what the previewed card supplies to a partner, once for what a partner
  supplies to it.

`synergyMatches` cannot serve either, and that is why they were written by hand:
it answers about a DECK, where `deck.wants` is a weight per tag, and both
surfaces need the answer for one named PAIR. The shared thing is therefore
smaller than the matcher — **`suppliedWants(supplied, wanter, { candidate })`**
in `qualifiers.ts`, generic over the tag type because the web carries `string[]`
off the wire. It keeps the same fallback: absent `candidate` means "the caller
did not ask", never "this supplier satisfies the qualifier".

**How a fifth is prevented.** A `no-restricted-syntax` block for `apps/web` bans
`.includes` / `.filter` / `.some` / `.every` over `synergyWants|Produces|Has`,
both spellings including `(card.synergyHas ?? []).filter(...)`. Verified by
writing all three shapes and watching eslint reject each — a rule that never
fires is not a guard. It is a NEW config block rather than an addition to the R1
one: flat config REPLACES a rule, so extending R1's `no-restricted-syntax` would
have deleted its `new Date()` selector, which is the trap that file already
documents for `no-restricted-globals`.

`Card.colors` is declared on the client type for the first time as part of this.
It has been on the wire since the batch route existed — that route sends the
whole domain card and applies no response schema — and only the declaration was
missing, which is the same class of error as the bug.

---

## 13. Amendment: one bogus wanter turns the qualifier off deck-wide

§9's rule is that a qualifier applies only when **every** wanter of a tag is
qualified, and that rule is right — a deck with Y'shtola *and* Jori En genuinely
wants any spell. What it means is that a single false wanter is not a rounding
error; it disables the feature for the whole deck. `Storm of Souls` entering a
Y'shtola deck took enablers costing under 3 from 0 back to **238**.

`Storm of Souls` wants `spell-cast` because the `WANTS` rule matched `\bstorm\b`
against **its own name**, spelled out in its own rules text by pre-2024
templating. 22 commander-legal cards matched on the bare word and **not one of
them carries the STORM keyword**: Cinder Storm, Command the Storm, Hail Storm,
Storm's Wrath, Tropical Storm, Comet Storm, Arrow Storm, Needle Storm, Wing
Storm, Storm Seeker, Storm of Steel, Lava Storm, Pigment Storm, Yamabushi's
Storm, Lightning Storm, Captain Lannery Storm, Storm the Vault, Storm Queen of
Wakanda, Storm Shaker of Skies, Storm of Souls — and two that are the same trap
one step out, Murmuration and Attempted Murder, which create "a 1/1 blue Bird
creature token with flying **named Storm Crow**".

**This corrects ADR-0038's price rather than contradicting its ruling.** That ADR
refused to substitute a card's own name out of the text and costed the refusal
at "twelve missed is cheaper than thirty broken", where twenty of the thirty were
"all cards named '… Storm' lose `spell-cast`". **Those twenty never wanted it.**
The loss was the bug, not the cost, and ADR-0038's ruling survives intact: the
fix here is narrower than the substitution it rejected — one alternative in one
rule — so the other thirty cards it protects are untouched.

The replacement is the one `ritual` already uses two hundred lines down in the
same file, and for the reason stated there: STORM is read by its reminder text,
`copy it for each spell cast before it this turn`. All 33 STORM-keyword cards in
the corpus still match; the reminder is printed on every one of them.

**Corpus effect: 22 cards lose the want, 0 gain it, 0 other tags move.**

The one true payoff the narrower rule no longer reaches is **Murmuration**, whose
other clause — "at the beginning of your end step, for each spell you've cast
this turn" — is a count rather than a trigger and is read by no rule in the
table. One card, named here so the next person does not have to find it twice.

**`synergy_wants` is a STORED column, computed at ingest in
`packages/clients/src/scryfall.ts`. This one needs a re-ingest**, unlike
everything in §7 and §12, which is derived at read time and live at deploy. Per
DEPLOYING.md, with the DIRECT (unpooled) connection string:

```
DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm --filter @roundtable/ingest start cards
```

**It was not run as part of this change.** Until it is, the 22 cards keep the
stored `spell-cast` want and §9's all-wanters rule keeps the qualifier switched
off in any deck holding one of them.
