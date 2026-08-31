# 26. A focus guarantees its top three in every category, by extending the list

Date: 2026-08-31

## Status

Accepted.

> **Number 0026 was assigned to this work.** 0024 (two-colour charts) and 0025
> (impact and efficiency as query fields) are taken, both dated within a day of
> this one. The next agent should take 0027 and should not derive a free number
> by reading the directory — two pairs of agents have collided that way.

## Context

Semantic emphasis shipped an hour before this. A builder picks the synergy tags
their deck is *about*, and `emphasisScore` adds a term to every candidate that
supports one of them (doc 05 §5.6). It is a **scoring** feature and nothing
else, and that is the gap.

Each candidate group ends with a cut:

```ts
items: members.slice(0, limit).map(toRecommendation)   // limit = limitPerGroup ?? 60
```

Scoring reorders *within* a group. It cannot reach past that slice. So a card
supporting the builder's declared focus can still sort below the cut and never
appear in that category at all — the builder said what the deck is about, and
the category answered with nothing about it. The client makes this sharper than
the domain's default suggests: the workspace asks for `limitPerGroup: 8`, not
60, so eight rows is the real width of the promise.

The user's request:

> "when a user selects a focus, make sure to include the top 3 matches for that
> focus in the query results for each category"

Four constraints sit around it, all of them load-bearing and all of them easy to
break silently:

- **Emphasis reorders and never filters.** Verified in a browser on a real
  Tergrid deck and stated to the user in three places in the interface.
- **P5 — grouping is the product's opinion; scoring only orders within a
  group.** A guaranteed card must go into a group it already belongs to.
- **P4 — every recommendation carries non-empty `reasons`**, and a reason has to
  name what actually put the card there.
- **P6 — an excluded card is never re-suggested.** The guarantee reaches past
  the cut, and a builder's rejection lives on the other side of it.

## Decision

### 1. The guarantee EXTENDS the list; it never displaces

A group's `items` may now exceed `limitPerGroup` by up to three. This is a
change in what the response means and is the reason this document exists.

The alternative — hold the list at exactly `limit` and swap three cards out —
was rejected outright. It would make emphasis *remove* suggestions. That is the
one thing the feature promises not to do, it is written into
`semantic-emphasis.ts`, it is pinned by `apps/api`'s own "never removes a
suggestion" test, and it is said to the user in three places. A focus that
quietly deletes three cards from a category to show three others is a filter
wearing a ranking's clothes.

`total` is unchanged. It counts the group's members, and the guarantee did not
find any new ones — it showed some of the ones already counted.

### 2. "Top 3" means the focus as a whole, not three per emphasised tag

A builder with four tags gets three extra rows per category, not twelve.

Per-tag was rejected on two grounds. **Proportion**: twelve guaranteed rows in a
category the client renders eight rows of makes the guarantee larger than the
thing it is a guarantee about, and each additional tag would dilute the ordering
the score just computed. **Coherence**: `emphasisScore` sums every emphasised
match onto one saturating term, so the scorer already treats a focus as a single
thing; a per-tag guarantee would have the ordering and the guarantee holding two
different opinions about what a focus is.

The cost is real and is accepted rather than hidden: a weakly-supported tag can
be shut out of all three slots by a strongly-supported one, which is this same
defect one level down. Two things bound it. `RecommendResult.emphasis` already
reports `supporting` per tag, so a builder can see that a tag reaches cards even
when none of them took a slot; and emphasising that tag on its own gives it all
three.

### 3. The three are the group's own top three among supporters

Ranked by the score the group is already sorted by, restricted to cards with a
non-empty `emphasised` match — not by `emphasisScore` alone.

The score already carries the emphasis term, so these are the cards the category
would lead with if it showed only supporters: one ranking, and it is the one on
screen. Ranking by emphasis alone would put a card that does nothing but carry
the tag above one that carries the tag *and* closes the gap the category is
named after, and it would require a second ordering that appears nowhere.

Supporters already above the cut count towards the three. A well-supported focus
therefore adds nothing at all, which is the common case.

### 4. They sit at the end, which is also their natural position

Not pinned to the top. These cards are here precisely because they sorted below
`limit`, so "appended" and "where the score put them" are the same place.

Pinning was rejected: a card the group ranks 40th is not the first thing that
category has to say, and hoisting it over nine cards that beat it makes a claim
on the builder's attention the app's own ranking does not support. The guarantee
decides what is **present**; the score decides what **leads** (P5).

### 5. A guaranteed row says so, on the reason that already names the focus

`Reason` of kind `keyword-synergy` gains an optional `guaranteed?: boolean`,
beside the existing `emphasised?: boolean`.

It is a second claim, not a restatement. `emphasised: true` is true of every
supporter in the list including the ones that outscored everything;
`guaranteed: true` says the thing the reader cannot otherwise work out — this
card scores below the cut and is on the page anyway. Without it the row reads as
the ranking having gone wrong. The interface renders it as *"top 3 here for your
emphasised opponent discard"*, where `here` is load-bearing: the promise is per
category, not across the deck.

A reason kind of its own was rejected — it would put one relationship on screen
twice, which is how a row full of reasons stops being read.

The flag must be on the wire rather than inferred from position: the client
re-sorts group rows by column and merges the three `combo-N` groups into one
heading, so "last in the list" does not survive the trip.

### 6. Fewer than three supporters means fewer than three rows

Never padded. Answering a question about the focus with cards that have nothing
to do with it is worse than answering it with one card.

### 7. The guarantee reaches past the CUT, never past the FILTER

It runs over the group's members, which are already past eligibility and already
past the query filter. So:

- an **excluded** card cannot be reached — it never enters the candidate set at
  all (P6);
- a card **withheld by the query** cannot be reached — the query filters, and
  that is its whole job. A guarantee that reached past the search box would make
  the search box a lie.

### 8. The client honours it

The workspace merges `combo-1`, `combo-2` and `combo-3plus` into one heading and
then **halves** its rows for density. That halving would throw away exactly the
guaranteed rows, since they are lowest-scoring by construction. It now keeps
them and halves everything else. A server-side guarantee the client silently
trims is this same defect one layer up.

## Consequences

- `items.length <= limitPerGroup` no longer holds. It is now
  `items.length <= limitPerGroup + 3`. Doc 10 §10.4 says so.
- The user-facing copy changed. "It **only** reorders your suggestions" was true
  and is not any more — a focus now also keeps cards. The half that had to
  survive intact did: nothing is ever hidden. Four strings changed (start
  screen, the tag chip's hint both ways, and both states of the Focus panel).
- With no focus set, `emphasisMatches` returns `[]` for every candidate, so the
  guarantee returns nothing and the output is byte-identical to what it was
  before. That falls out of the data rather than from a `hasEmphasis` guard,
  deliberately: a guard would be a branch no test could distinguish from its own
  removal.
- Cost is one extra pass over each group's members past the cut, only when a
  deck has a focus. No new input to `recommend`.
