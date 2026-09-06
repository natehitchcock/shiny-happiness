# ADR-0069 — A tiebreak that decides every row is the sort, and the ranking happens before the cut

**Status:** accepted
**Date:** 2026-09-06
**Relates to:** [ADR-0067](0067-a-name-is-the-wrong-question-for-someone-who-has-not-chosen.md),
which built Route 1 and chose the name over `edhrec_rank` as its tiebreak (§5);
[ADR-0068](0068-looking-is-not-choosing-and-a-deck-is-mostly-not-its-theme.md),
which widened the offer and is why a common pick is now easy to reach;
[ADR-0066](0066-mana-and-taxes-are-rules-not-blind-spots.md) and
[doc 22](../22-impact-reference.md), which are the impact model this now ranks
by; and [ADR-0063](0063-the-cost-is-round-trips-not-scoring.md), whose
round-trip price is what the cost argument in §4 is weighed against.
**Changes:** the ordering rule in `packages/domain/src/commander-entry.ts`, the
query in `packages/db/src/repositories/commanders.ts`, the handler in
`apps/api/src/routes/commanders.ts`, and the ordering guarantee in
[doc 10 §10.2a](../10-api-contract.md). No schema change, no migration, no
re-ingest, and no change to the response's shape.

---

## 1. The defect: five Aangs

Route 1 asks what the deck is about and answers with the commanders that carry
it, "best first". Since the carrier list started drawing five with the rest
behind an expander, the first five are what the reader sees.

**"Best" meant alphabetical.** The query ordered by
`cardinality(ARRAY(… INTERSECT …))` — how many of the picks the commander
carries — and then by `name`. That is the right first term and it does nothing
at all for the commonest case: **pick one semantic and every carrier matches one
of one**, so every row ties on the first term and the NAME decides the entire
list.

Measured against the live corpus (31,782 commander-legal cards, 3,411
commanders, Scryfall's oracle export of 2026-09-06), picking `creature-etb` —
645 carriers — returned:

```
Aang, Airbending Master
Aang, at the Crossroads // Aang, Destined Savior
Aang, Swift Savior // Aang and La, Ocean's Fury
Aang, the Last Airbender
Aatchik, Emerald Radian
```

Four Aangs and an Aatchik, offered as the best commanders for a theme 645
commanders carry. At sixty rendered rows this was a curiosity at the top of a
scroll; at five it is the whole answer, and the answer is "the A's".

**The tiebreak was not wrong for being alphabetical. It was wrong for being the
sort.** A tiebreak is supposed to add nothing, which is exactly right when it
settles the occasional pair and exactly wrong when it settles all 645.

## 2. Decision: match count, then impact, then name

```
ORDER BY matches DESC, cardImpact(card).score DESC, name ASC
```

**The first term is unchanged, and it still wins.** Two-of-two leads one-of-two
whatever either card goes on to do. The list answers "which commanders carry
what I picked", so how many picks were carried is the sort and everything under
it is a tiebreak. A commander scoring 18.48 on one pick does not climb over a
commander scoring 0 on both.

**The new second term is what the card DOES**, from `cardImpact` in
`packages/domain/src/impact.ts` — `breadth × persistence × stakes × severity ×
symmetry`, read from `oracleText`, `typeLine` and `manaCost` and described in
full in [doc 22](../22-impact-reference.md). It is a property of the card's own
text, which is the same kind of thing the list is already asking about.

**Nothing is stored and nothing is re-ingested.** The three fields impact reads
are already on every row the query returns.

**The name still breaks a genuine impact tie**, and it has to. Impact is a
product of five constants off a small ladder, so exact ties are ordinary rather
than rare — every card with no rules text scores exactly 0, and any two cards
whose winning clause lands on the same five rungs score identically. Without a
final term the order of two equal cards would be whatever order Postgres
happened to return them in, and a list that reorders itself between two
identical requests is worse than one ordered by the alphabet.

After the change, the same pick returns:

| commander | impact |
| --- | ---: |
| Elrond of the White Council | 19.152 |
| Haytham Kenway | 19.152 |
| Nihiloor | 19.152 |
| Iroh, Tea Master | 18.48 |
| Kitt Kanto, Mayhem Diva | 18.48 |

Measured through the shipped route against that corpus, not predicted.

## 3. `edhrec_rank` was refused again, and for ADR-0067's reason

ADR-0067 §5 chose the name over popularity deliberately: Route 2's draw uses
`edhrec_rank` because a random hand has to stay recognisable, and Route 1 must
not, because a popularity tiebreak answers "what is popular" inside a list whose
heading says "what is this about". **That decision stands and this ADR does not
reopen it.** Popularity was not measured, not tried, and not fallen back on when
the alphabet failed.

The failure being fixed here is not that the tiebreak added nothing. It is that
it was doing all of the work while adding nothing. Impact is admitted for the
same reason popularity is refused: it is a fact about the card rather than about
its audience.

## 4. The trap, and what it costs to avoid it

**`cardImpact` cannot be expressed in SQL.** It strips reminder text, normalises
self-reference, splits into ability lines and scores each line as a five-axis
tuple. So the ordering cannot live in the query, which leaves two shapes:

1. Keep the SQL `LIMIT 60` ordered by matches then name, fetch that page, and
   re-sort it by impact in the route.
2. Have SQL only narrow, rank the whole matching set in the domain, and cut
   afterwards.

**The first is the same defect with a smaller symptom, and it is the trap this
ADR exists to name.** Re-sorting the alphabetically first sixty gives the
impact-best of the A's. Run against the real 645 carriers, that shape returns:

```
Aatchik, Emerald Radian          15.96
Acererak the Archlich            15.96
Azor, the Lawbringer             15.96
Atraxa, Grand Unifier            13.68
Ajani, Nacatl Pariah // …        13.44
```

Five A's again, now with plausible-looking scores beside them — which is why it
would have shipped. **The ranking must happen before any limit is applied**, and
the regression test in `apps/api/src/commander-entry.test.ts` asserts the
absence of the alphabetically-first rows rather than the presence of the best
one, because only the absence distinguishes the two shapes.

### The measurement

Taken on the corpus above, with the impact classifier and the route as shipped.

| quantity | measured |
| --- | ---: |
| commander-legal commanders (the hard ceiling on any matching set) | 3,411 |
| …of which carry any `produces`/`wants` semantic at all | 3,104 |
| carriers of `creature-etb` | 645 |
| carriers of the WIDEST tag in the corpus (`token`) | 786 |
| `creature-etb`'s carriers as rows | 348 KiB |
| the same rows, impact's four columns only | 274 KiB |
| `cardImpact` over one card | ~8.2 µs |
| `cardImpact` over all 3,411 commanders | 27.95 ms |
| rank `creature-etb` — match, score the carriers, sort | **6.5 ms** |
| rank `token`, the widest pick there is | **7.3 ms** |
| whole request through the route, database stubbed | **8.2 ms** |

**The matching set is bounded by the corpus, not by the request.** There is no
pick, and no combination of picks, that can make this set larger than 3,104
rows; ranking every one of them at once — all 317 tags picked together, which no
screen can produce — is 53 ms.

**348 KiB is not a read this codebase considers expensive.** `findEligibleCards`
moves 12.1 MB for a five-colour deck (ADR-0017), and one database round trip
from the measured machine is ~36 ms (ADR-0063). The count query that used to run
beside the page query is gone — `total` is now the length of what was ranked —
so this endpoint makes **one round trip where it made two**, which more than pays
for the extra rows.

## 5. What was refused

**A stored `impact` column and a migration.** It would make the ordering
expressible in SQL and it is a bigger decision than this defect: a stored score
is a second copy of a model that ADR-0066 changed substantially five days ago,
and doc 22 already records two baked data files that went stale when it did. The
measurement above says it buys 6.5 ms. Not built, and deliberately not built
quietly.

**Caching the commander pool per snapshot in `corpus-cache.ts`.** The matching
set depends only on the corpus and the picked tags, so the pool has the shape
that file's four existing entries have, and impact would be computed once per
snapshot rather than per request. It was evaluated and dropped as more machinery
than the defect justifies: the win is a few milliseconds and a round trip on a
screen that issues one request per pick, against a new cache entry, a new
invalidation surface, and 1.7 MB held. If this endpoint ever shows up in a
measurement the way ADR-0063's table showed up, the option is still here.

**Selecting only the four columns impact reads and hydrating the survivors.** It
saves 21% of the bytes — impact reads `oracle_text`, which is most of the row —
and costs a second round trip at ~36 ms to fetch the page's full cards. That is
paying 36 ms to save 74 KiB.

**Keeping the SQL `ORDER BY` as a "close enough" pre-filter.** An order that is
right about the first term and arbitrary about the second is exactly what
produced five Aangs; leaving it in place would leave a cut that could be
reintroduced by anyone who added a `LIMIT` back for a good-looking reason.
`commandersBySemantics` now takes no `limit` at all, so there is nothing to
re-tune and nothing to accidentally trust.

## 6. Consequences

- **The endpoint's ordering guarantee changed**, and doc 10 §10.2a says so. The
  response shape did not: `items`, `matches`, `total`, `images` and
  `datasetSnapshotId` are unchanged, and `limit` still means what it meant.
- `RankedCommander` gains a readonly `impact`, so a caller can show or check the
  number the order was decided by rather than recomputing it and getting a
  second opinion.
- `commandersBySemantics` returns `readonly Card[]` and no longer takes
  `options.limit` or reports a total. Its only caller is the route.
- `rankScoredBySemanticMatches` and `scoreCommanderImpact` are exported beside
  `rankBySemanticMatches`, so a caller ranking one pool against several sets of
  picks can score it once. They are the same rule, not a second one, and a test
  asserts the two paths agree.
- **Art is fetched for the page only.** The route now holds the whole matching
  set for a moment, and building an image map over all 645 of them to render
  five would have been a new cost introduced by the fix.

## 7. Testing, and what this worktree could not verify

**Added, domain (`packages/domain/src/commander-entry.test.ts`, runs anywhere):**
equal match counts order by impact and not by name; the impact each row was
ranked by is reported; a higher match count still beats a higher impact; a
genuine impact tie still breaks by name; popularity still cannot get in through
the new tiebreak; the impact-best carrier is found however late its name sorts,
over sixty alphabetically-earlier ones; and the pre-scored path ranks by the
score it was handed rather than recomputing it. Every fixture text's score is
asserted against the shipped classifier, so a fixture cannot drift into agreeing
with the ranking for the wrong reason.

**Added, API contract (`apps/api/src/commander-entry.test.ts`):** a second
database and a twelve-card corpus of stated impacts — a separate database
because the existing corpus is shared with the quickdraw suite, whose fixed-seed
assertions are a deterministic function of the pool and would have been redealt
by twelve new rows. It asserts the order for equal match counts, the name tie,
match count beating impact, `total` counting the whole set rather than the page,
art fetched for the page only, and — the one that matters — that **a page of
three contains no alphabetically-first row at all**, which is only true if the
whole matching set was ranked before anything was cut.

**NOT VERIFIED HERE.** This worktree has no `.env.local`, so the nine PostgreSQL
suites cannot run and were skipped under `LW_ALLOW_NO_DB=1` — including
`apps/api/src/commander-entry.test.ts`, where most of the new coverage lives.
The one test in that file that needs no database (the fixture scores) does run
and passes. The acceptance measurement in §1, §2 and §4 was taken by pulling
Scryfall's oracle bulk export through `packages/clients`' own `skipReason` and
`toCard` with `can_be_commander` from `fetchCommanderOracleIds` — which
reproduced the 31,782 / 3,411 populations exactly — and driving the shipped
route over it with the database stubbed. **No browser check was made**; the five
Aangs were found in one, and the fix should be confirmed in one.
