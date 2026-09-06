# ADR-0067 — A name is the wrong question for someone who has not chosen, and membership is not aboutness

**Status:** accepted
**Date:** 2026-09-05
**Relates to:** [ADR-0046](0046-subtypes-and-keywords-are-synergy-tags.md) (the
613-tag vocabulary these thresholds are applied to),
[ADR-0048](0048-membership-is-a-third-direction.md) (which added `has`, and is
the direction §3 refuses here — not a reversal of it, a different question),
[ADR-0065](0065-a-list-of-613-is-four-lists-and-each-one-is-alphabetical.md)
(the three categories and their order, reused unchanged),
[ADR-0064](0064-a-small-read-is-not-a-cheap-one.md) (why both new corpus reads
are cached the moment they exist), and
[ADR-0021](0021-card-art-from-scryfalls-cdn.md) (why neither route draws art in
its list).
**Changes:** three new `GET` endpoints under `/api/v1/commanders` (doc 10
§10.2a), two new pure modules in `packages/domain`, one new repository file, two
new cached reads, and two new sections on the start screen. **Additive
throughout** — no migration, no change to any existing wire shape, no change to
`POST /decks`, and the commander name search is untouched.

---

## 1. The defect

There is exactly one way to start a deck, and it only works for someone who
already knows the answer.

`Start` in `apps/web/src/App.tsx` is a text box labelled `Commander` that runs
`searchCards(\`${query} is:commander\`)`. It is a good search. It is also a
search, which means it asks the builder to **name the thing they came here to
find**. A reader who knows they want Krenko types Krenko. A reader who knows they
want "a deck about sacrificing my own creatures" has nothing to type, and the
screen has nothing to say to them: the results list is empty until a name goes
in, and "" is not a name.

That is the whole defect. It is not that the search is bad; it is that a product
whose pitch is "build around combos and synergies" opens with a control that can
only be operated by someone who has already finished the step it is meant to
help with.

## 2. Decision

Two more doors, **beside** the search and never instead of it. Both end at the
same place the search ends — `chosen`, then the card face, the focus prompt, the
archetype and bracket, and `POST /decks` — so neither route is a second way to
build a deck. They are two more ways to answer one question.

**Route 1 — start from semantics.** Offer eight of the qualifying tags, take one
or more, show the commanders that carry them ranked by how many of the picks each
one matches. A redraw offers eight others.

**Route 2 — quickdraw.** Deal three commanders: two from `edhrec_rank <= 5000`
and one from the whole legal pool, with the wildcard marked. A reroll deals three
more.

## 3. `has` is excluded, and the product reason comes first

A tag qualifies for Route 1 when at least **20** commander-legal commanders carry
it and at least **150** commander-legal cards support it, **counting `produces`
and `wants` and never `has`.**

### 3.1 `has` is identity, not aboutness

Route 1 asks what the deck is *about*. `synergyHas` does not answer that
question, because it is not that kind of claim: ADR-0048 defines it as
membership derived from the type line and the keywords, so **every commander is a
Legendary Creature with subtypes and every one of them carries something**.

Counted, it makes `subtype:human` a "semantic" on **1,409** commanders and
`ability:flying` on **674** — not because a deck is about being Human or about
flying, but because those commanders *are* Human and *have* flying. Including
`has` takes the qualifying set from 48 tags to **99**, and most of the 51 it adds
are noise of exactly that kind: an offer that says nothing about what the deck
would do, in a list whose entire purpose is to say what the deck would do.

This is not a reversal of ADR-0048. Membership is a real direction and the
commander prompt under a *chosen* commander still reads all three of them —
Morophon, the Boundless is `subtype:shapeshifter` and `ability:changeling` and
nothing else, and telling that reader "no semantics derived" was the defect
ADR-0048 fixed. The difference is the question being asked. "What is this
commander?" wants membership. "What could a deck be about?" does not.

### 3.2 There is no `synergy_has` column, and there cannot cheaply be one

`0003_synergy.up.sql` stores `synergy_produces` and `synergy_wants` with a GIN
index on each. `has` is **derived per row** by `toCard`, from `type_line` and
`keywords`, precisely because ADR-0048 measured it as cheaper to compute than to
ship — 13.0 ms for the whole 31,782-card pool against 1.98 MiB of column.

That trade is right for a deck-scoped read and wrong for this one. A Route 1
query filtering on `has` could use neither index, so it would **scan all 31,782
rows deriving membership in process** — on the start screen, before a deck
exists, with no colour identity to narrow by. ADR-0064 exists to say what that
kind of read costs.

**The product reason is first because it is the one that survives.** If a
`synergy_has` column were added tomorrow, §3.1 would still be true and this
decision would not change.

### 3.3 Tribal themes survive this, and this paragraph exists because a reader will assume otherwise

Dropping `has` does **not** drop the tribes. The 48 qualifying tags split **24
mechanics, 11 keyword, 13 type** — Elves and Dragons are in there.

They arrive through the other door. A subtype qualifies because enough cards
*care about* the tribe and enough commanders *want* it — not because a lot of
cards *are* it. That is the right sense of the word for this screen: an Elf deck
is one whose commander pays off Elves, and Lathril qualifies while a vanilla 2/2
Elf Warrior does not. Thirteen of the 48 are `type` tags, and that is where they
are.

## 4. The thresholds sit on a plateau, not a cliff

The evidence they are not overfitted:

| commanders | supporting | qualifying tags |
| ---: | ---: | ---: |
| 15 | 150 | 49 |
| **20** | **150** | **48** |
| 25 | 150 | 47 |
| 30 | 150 | 42 |

Moving the commander floor by a third in either direction moves the offer by one
or two tags. A threshold that behaved like a cliff would have to be defended card
by card and would be a number somebody liked; this one is a shelf, and 20 was
taken from the middle of it.

Measured against the live corpus, all of which is quoted rather than re-derived
in code:

| fact | value |
| --- | ---: |
| commander-legal cards | 31,782 |
| commander-legal commanders | 3,411 |
| commanders with an `edhrec_rank` | 3,411 (all) |
| commanders under rank 2000 / 3000 / 5000 | 216 / 393 / 791 |
| commanders with ≥1 `produces`/`wants` semantic | 3,104 |
| commanders with none | **307** |
| qualifying tags at 20/150, produces+wants | **48** (24 / 11 / 13) |

**Eight of the 48 per draw.** Enough that the offer is a menu rather than a
suggestion, few enough to read before scrolling, and small enough against 48 that
a redraw is genuinely a different eight.

**The 307 never surface in Route 1.** They carry nothing to match, so an overlap
query cannot reach them and `rankBySemanticMatches` drops a zero-match card
rather than ranking it last. A zero-match tail would be those 307 plus every
commander that is about something else, listed under a heading that says these
carry the chosen semantics.

## 5. Route 2 uses popularity and Route 1 refuses it

Deliberate, and the two rules answer different questions.

**Route 1's ranking has no rank in it.** Commanders are ordered by how many of
the picks they match, and ties break **by name**. Alphabetical is the order that
adds nothing, which is what a tiebreak should do. Breaking those ties by
`edhrec_rank` would quietly answer "what is popular" inside a list whose heading
says "what is this about" — and the builder who came to Route 1 is the one
looking for something they have not already seen a hundred times.

**Route 2's draw does use it, because a draw has to be recognisable.** There are
3,411 legal commanders and only **216** under rank 2000. A uniform draw of three
is almost always three cards nobody has heard of, and a hand nobody recognises is
not an invitation — it is a wall. So two of the three come from the **791**
commanders at rank 5000 or better and the third comes from anywhere.

5000 was chosen off the same distribution: 216 under 2000 and 393 under 3000 are
narrow enough that a reroll deals the same few dozen faces over and over. 791 is
wide enough for a reroll to be a genuinely different hand.

**The wildcard is drawn from the whole pool, not from the pool minus the 791.**
"One card from everywhere" is the honest description; excluding the top would
make the wildcard slot systematically obscure rather than uniformly random. What
it may not be is a duplicate of a card already in the hand, so exactly the two
already dealt are removed and nothing else is.

## 6. Where the randomness lives, and why the tests are not flaky

**In one place, and it is a browser.** Each draw is one `crypto.randomUUID()` at
the click. Every layer under it — the API route, the SQL, the sampler — is a pure
function of that string.

`ORDER BY random()` is the obvious way to write the quickdraw endpoint and is not
what was built, because an endpoint whose answer nobody can predict is one no
contract test can assert. The usual escape is to mock the generator, which tests
everything except the sampling — the only part that is new.

So:

- **`seed` is a REQUIRED parameter on `/commanders/quickdraw`**, not optional
  with a server-side fallback. An optional seed is two code paths of which only
  the seeded one is ever tested, and the untested one is the one that ships.
- **`sampleWithSeed` lives in `packages/domain`** (`seeded-random.ts`), which R1
  already forbids `Math.random()` in. The rule that usually forces a caller to
  pass a number here forces the whole feature into a shape that is testable.
- **Route 1 does not sample server-side at all.** 48 tags is about fifteen
  kilobytes, so the endpoint serves the qualifying set whole and the client draws
  its eight. A redraw then costs no round trip, and the endpoint stays a
  deterministic function of the corpus.

The tests **pin the entropy, not the sampler**. `apps/web/src/start-entry.test.tsx`
replaces `crypto.randomUUID` with a counter and then runs the real sampler over
real offers: seed 1 gives a fixed eight, seed 2 gives a different eight, and
remounting at seed 1 gives the first eight back. `apps/api/src/commander-entry.test.ts`
passes a seed and asserts the exact hand. Nothing under test is stubbed.

### 6.1 The database suite has to be in the list, by name

`apps/api/src/commander-entry.test.ts` is added to the **literal
`DATABASE_SUITES` array in `vitest.config.ts`**, and this is worth a line
because the failure is not local. A database suite left out of that list runs in
the parallel project, where its `CREATE DATABASE` queues against the same cluster
as the others while its own hook timeout counts down; the symptom is a hook
timeout in a *different* file, moving between runs, and a teardown that never
reaches its `DROP`. The list is deliberately literal rather than a glob so that
adding a suite is a decision somebody makes rather than a filename pattern.

`LW_ALLOW_NO_DB` is read in exactly one place — `packages/db/src/database-required.test.ts`
— and it does not exempt anything from that list. It only makes a run that
skipped the database suites say so out loud instead of going green.

## 7. What was refused

**Colour identity as a filter.** There is no deck yet, so there is no identity to
filter by. The commander the builder picks is what will decide it, and filtering
before that would be the tool answering a question it has not been asked.

**Replacing the search.** Both routes vanish once a commander is chosen and
neither has its own archetype picker, bracket picker or focus prompt. A reader
who arrives knowing the name still meets the box that answers them, first.

**Art in either list.** ADR-0021 keeps the commander search results as text
because they are a dense list read by name, and both new lists are the same kind
of list. Art still earns its space at the moment the choice is made — the chosen
commander's card face, which both routes feed exactly as the search does. The
routes do send an `images` map, because that face needs it.

**Shuffling the quickdraw hand.** The wildcard is last and is marked as one, so
position and label agree. Hiding it in the middle would make the label the only
way to find it — a surprise nobody asked for, paid for by every reader having to
check three rows to find the one they were told about.

**Padding a short hand.** If the pool cannot yield a third distinct commander,
`wildcard` is `null` and `items` is two long. A third familiar card wearing the
wildcard's label would be a claim about where a card came from that is not true.

**Ranking in SQL.** The repository narrows and cuts; the rule that decides
two-of-two leads one-of-two is in `packages/domain` and is the only implementation
of it. Migration 0010 makes the same argument about `can_be_commander`: two
implementations of one rule are eventually two answers.

**Filtering the census by the thresholds in SQL.** `semanticCensus` returns every
tag with its two counts and `qualifyingSemantics` decides. Half a rule in a query
string is half a rule no unit test can see.

**Silently dropping an unknown tag.** `?tags=landfall,not-a-real-tag` is a `400`,
not a search for `landfall`. A quietly narrowed filter answers a different
question while looking like a success — the failure `/cards/search`'s
`additionalProperties: false` was added for.

## 8. Accessibility (R4, P1)

- Both routes are `<section>`s with `aria-labelledby`, so each is a landmark a
  reader can jump to and each is named by the heading it already shows.
- Every offered semantic is a `<button>` with `aria-pressed`, a stable accessible
  name that does not flip with the state, and the ✦/✧ glyph pair the emphasis
  toggles already use. **Never colour alone:** the glyph changes shape, the state
  is announced, and the brass border is the third signal.
- The offer's accessible name carries the counts behind it — "40 commanders, 400
  cards" — so the evidence for the offer is available without a hover.
- Both result sets are real `<ul>`/`<li>` lists with accessible names, so the
  number of items is announceable rather than inferred from a scrollbar.
- The match count is rendered twice: once visually as `2/2`, and once as
  screen-reader text, "Matches 2 of 2". The ordering rule is the point of the
  list and it must not be visible only as an order.
- **The wildcard's mark is words** — "Wildcard — drawn from every legal
  commander" — plus a glyph. The brass tint is decoration on top of a label that
  is already readable and already in the list item's text.
- A redraw and a reroll each announce into an always-mounted
  `role="status" aria-live="polite"` region: "8 new semantics offered", "Three new
  commanders dealt". Always mounted, for the reason the workspace's is — a live
  region that appears together with its message is routinely missed.

## 9. Consequences

- Two more cached corpus reads. `semanticCensus` is the most expensive single
  read in `corpus-cache.ts` by CPU — one pass over 31,782 rows unnested into
  ~108,000 (tag, card) pairs — and the cheapest by payload, and it is the first
  thing the application does for a visitor with no commander. Cached per
  snapshot, it is paid once per ingest. `commanderDrawPools` is 3,411 uuids and
  is cached because a reroll is a button people click idly.
- `ELIGIBLE_COLUMNS`, `CardRow` and a new `cardsFromRows` are exported from
  `repositories/cards.ts` so the commander reads produce cards through `toCard`
  rather than mapping rows by hand. `toCard` itself stays private: it is the one
  place `synergyHas` is derived and the one place a NULL `can_be_commander` stays
  distinct from `false`.
- `imagesFor` is exported from `routes/cards.ts` so both new routes state absent
  art on exactly the same terms rather than growing a second answer to it.
- Six existing suites that mount the start screen gained default stubs for the
  two reads the routes make on mount. That is the cost of loading the offer
  eagerly, and it was paid rather than avoided: hiding Route 1 behind a click
  would mean the reader who does not know what to type has to know to click.

## 10. What this worktree could not verify

**No `DATABASE_URL`.** `.env.local` is gitignored and lives only in the main
checkout, so the eight Postgres suites did not run here — `apps/api/src/api.test.ts`,
`api-02`, `api-06`, **`commander-entry` (the new one)**,
`recommendations.perf`, `apps/ingest/src/scryfall-ingest.test.ts`,
`packages/db/src/db.test.ts` and `database-required`. The run was made with
`LW_ALLOW_NO_DB=1`, which says out loud that it proves less.

So the three endpoints are written, typechecked, linted and covered by a suite
that has never executed. **Every corpus figure in this document is quoted from
the measurement pass, not re-derived here.** The fixture counts asserted in
`commander-entry.test.ts` (28 landfall commanders, 23 elf, 203 supporting) are
arithmetic over fixtures written in the same file and are the first thing to
check if that suite fails on a machine that can run it.
