# 25. Impact and efficiency are query fields, and the filter compares the number the column shows

Date: 2026-08-31

## Status

Accepted.

> **Number 0024 is taken by this ADR.** 0023 is damage/life loss, 0022 the
> synergy subject split, both dated within days. The next agent should take
> 0025.

## Context

A user asked one question:

> "how do I add a filter for the new computed value and impact columns?"

The answer was *you can't*, and that is the bug this ADR closes.

[Doc 18](../18-card-impact-and-efficiency.md) added two card-intrinsic metrics —
`impact` (breadth × persistence × stakes, discounted for symmetry) and
`efficiency` (surplus stat points per mana) — that ride on every recommendation
item and on card detail. They were deliberately **not** part of the candidate
query language, and the reasoning was written down in `App.tsx`:

> A metric is not a query and the server does not evaluate it — its values ride
> on the recommendation itself — so sending its name would be asking the parser
> to read `impact` as a filter.

That was correct while the metrics were display-only. It stops being correct the
moment a builder can see `6.12` on a row and has no way to say "the ones like
that". A number you can read and cannot ask about is a worse affordance than no
number at all: it invites a question the interface then refuses.

## Decision

### 1. `impact` and `efficiency` are numeric fields of the query language

Aliases `imp` and `eff`, canonical spellings `impact` and `efficiency`.

The alias/canonical split follows the file rather than inventing a convention.
The abbreviated canonicals — `t`, `o`, `kw`, `c`, `id`, `mv`, `pow`, `tou`, `r` —
are the ones Scryfall taught users. Every field **this project invented** —
`combo`, `near`, `price`, `role`, `group`, `tag` — canonicalises to the whole
word, because the chip row and `describeQuery`'s screen-reader prose are what
read it back. `imp`/`eff` are for typing; `impact`/`efficiency` are for reading.

They are the first `NUMERIC_FIELDS` members whose values are fractional.
Nothing had to change for that: the validator's pattern already accepted a
decimal part, so `eff>=1.5` and `impact>=6.12` parse as ordinary terms.

### 2. The filter compares the RAW score, not a display-rounded one

This is the decision with consequences, and it is the one the question was
really about — a filter that disagrees with the number on screen is worse than
no filter.

`cardImpact` and `cardEfficiency` already quantise to three decimals at source,
and `impact.ts` says why:

> Rounded to three places so the value is stable across platforms and can be
> compared for equality in a test. Float multiplication of four constants is
> otherwise 7.199999999999999 on the wire.

So there is exactly one number per card per metric. `AnnotatedCandidate.impact`
carries it across unrounded and unrescaled, and it is bit-identical to
`Recommendation.impact.score` — the value a column draws. `impact>=6.12` keeps
Wrath of God and `impact>6.12` does not, which is pinned by test at the
boundary.

**Rejected: re-rounding in the predicate to a display precision.** No renderer
has picked one yet (see §5), so choosing here would be inventing a precision;
and the moment a renderer chose differently, the filter and the column would
disagree with nothing to catch it. The constraint that falls out, recorded here
because it binds whoever builds the metric column: **the column must draw
`score` itself, and if it ever rounds for display, that rounding belongs in
`impact.ts` where both sides read it.**

Also rejected: **normalising either metric to a common 0–10 scale.** Impact runs
0–18.48 and efficiency is a small ratio; they are on different scales because
they measure different things. Rescaling would make every threshold on screen a
translation exercise.

(`impact.ts`'s docblock says "roughly 0–13". Measured against a real mono-red
pool of 1,448 candidates the maximum is **18.48** — the model's exact ceiling,
breadth 6.0 × persistence 2.2 × stakes 1.4 — and 93 rows score above 13. The UI
copy and doc 13 say 0–18; the docblock in `impact.ts` is left alone because that
file belongs to another task this cycle, and it is listed below.)

### 3. `DeckColumn`'s query/metric union survives, with a new justification

The union stays. The two kinds answer different questions about the same number:

| column | shows | question |
| --- | --- | --- |
| `{kind:'query', query:'impact>=6'}` | a tick | which of these clear my bar |
| `{kind:'metric', metric:'impact'}` | a number | how do these compare |

Neither subsumes the other. A query column cannot show a value; a metric column
has no threshold to tick against. And you need the number column to discover
where your threshold should be — collapsing them would ask a builder to name a
cutoff before seeing the distribution, which is backwards.

`queryColumnsOf` still strips metric columns, but **the old reason is now false
and has been rewritten rather than left to mislead**. The server *can* read
`impact`. What is still true is that a metric column names a number to draw
rather than a question to ask: `metric:'impact'` has no operator and no value,
so the nearest thing to send is the bare word `impact`, which parses as a name
substring search and would tick every card called *Impact Tremors*.

`columnKey`'s `metric:` prefix becomes **more** load-bearing, not less: `impact`
is now a legal thing to type as well as a metric name, so one deck can hold both
`impact>=6` and the impact metric column, and the two must key apart.

### 4. This is the contract change (AGENTS.md R2)

`AnnotatedCandidate` gains two **required** `number` fields. Adding an optional
field would not need an ADR; these are required, and that is deliberate.

Optional would mean the predicate has to decide what absent means. Both answers
are bad: treating absent as 0 silently drops every card out of `impact>=6`, and
treating it as matching gives a wrong answer that looks right — the failure mode
the parser's unknown-field rule exists to prevent. Required makes every
construction site a compile error until it supplies a real number.

There are **three** construction sites, not the two a grep for the type name
finds:

| site | source of the number |
| --- | --- |
| `packages/domain/src/recommend.ts` | `cardImpact(card).score` over the eligible pool |
| `apps/api/src/routes/cards.ts` | the same two calls the card-detail route makes |
| `apps/api/src/routes/recommendations.ts` | **`item.impact.score` — read off the row** |

The third is an inline object literal, structurally typed, and it is the one
that matters most: it is the column-evaluation path, so a column of `impact>=6`
ticks exactly the rows whose own cell says 6 or more **by construction**, not by
two implementations happening to agree.

### 5. `/cards/search` answers them; it does not refuse them

`UNSUPPORTED_FIELDS` refuses `combo`, `near`, `flag` and `group` because they are
computed against a deck's accepted set and are meaningless without one. Impact
and efficiency are properties of the card (doc 18 §18.2), so refusing them would
refuse a question the endpoint can answer — over the whole corpus, with no deck
at all.

### 6. Discoverability: a field reference beside the filter box

The placeholder holds three examples and the language has twenty-four fields.
Everything past `t:` and `mv<=3` was discoverable only by reading doc 13.

That was survivable while every field named something visible on a card. It is
not survivable for `impact` and `efficiency`, which are numbers this app
invented and which nothing on screen advertised as askable.

So the filter bar gains a `?` that opens the field list, one **example** per
field rather than a definition — `impact>=6` can be copied into the box; "how
much a card does, 0–13" still has to be translated into syntax. Built on the
existing `Hint`, which already carries the button, focus ring, tap-to-pin and
Escape that R4 requires; a `title` would be invisible on every touch device.
The placeholder spends one of its three slots on `impact>=6`.

## Consequences

- **`packages/domain` stays pure (R1).** The metrics are computed by the
  annotating caller and handed over. `evaluate.ts` remains "a pure predicate
  over a card that has ALREADY been annotated" — running a text classifier
  inside it would run once per card *per term* and would be a layering
  violation.

- **`recommend` no longer annotates when there is no query.** `matchesQuery(null, …)`
  is true for everything, so the annotation was always discarded on the
  unfiltered path — free when it was a dozen field copies, not free now that it
  runs the impact classifier twice per card over a pool that is the whole colour
  identity. The unfiltered path is the common one and is now **cheaper than
  before this change**. The filtered path pays roughly 6 µs a card.

  Rejected: walking the AST first and computing the metrics only when `impact`
  or `efficiency` appear. It would save that on most queries and would leave a
  zero sitting in a field that reads as a real score — one refactor away from
  filtering against a number nobody computed.

- **Nothing needs re-ingesting.** Both metrics are pure functions of columns the
  corpus already stores (doc 18 §18.11).

- **Doc 13's field table and worked examples are updated in the same commit**
  (AGENTS.md §10).

### Found, and deliberately not done

- **Nothing renders a metric column yet.** Doc 11 §11.0 already says so — "the
  UI half is not built" — and this ADR does not build it. `App.tsx`'s `Column`
  union is still a seam that nothing constructs a `metric` from. The
  consequence for this change is stated in §2: the filter compares the number
  the recommendation carries, which is the number a column will draw when one
  exists, so the two cannot be made to disagree by a later renderer that reads
  `score` — only by one that rounds without moving the rounding into
  `impact.ts`.

- **`UNSUPPORTED_FIELDS` still claims `power` and `toughness` are "not stored on
  the oracle row".** They are — `packages/db` stores `power`/`toughness` as text
  plus `power_num`/`toughness_num`, and `Card` carries them. `asCandidate` still
  passes `null` for both, so `pow>=4` is refused on a corpus that could answer
  it. Out of scope here and named so the next reader does not have to
  rediscover it.

- **`impact.ts`'s "Roughly 0–13" understates the scale**, per the measurement
  above. One comment, one file, and that file is another task's this cycle —
  the honest range is 0–18.48 and it should be corrected there so the model and
  the interface agree.

- **One candidate is counted in `query.total` but matches no query at all.**
  Measured in the browser against a real Krenko pool: `impact>=6` matches 1,040
  and `-impact>=6` matches 3,959, summing to 4,999 against a total of 5,000.
  It is **not** metric-specific and it predates this change — `mv>=0` returns
  4,999/5,000, and so does `-name:zzzqqqxx`, a name filter that is true of every
  card. So one card has `group !== null` and `matchesFilter === false` whatever
  is asked of it. `matched`/`total` are computed from one `scratch` array in
  `recommend.ts`, so the two counts should partition it exactly. Worth a look;
  out of scope here, and named so the next reader does not attribute it to the
  metric fields.

- **The `formatQuery` round-trip table was passing vacuously.** An input that
  fails to parse yields a null AST and formats to `''`, and `'' === ''` is
  idempotent. Found by mutation: deleting `impact` from `NUMERIC_FIELDS` left
  every case in that table green. The table now also asserts the formatted text
  is non-empty and the input parsed clean, which protects all twelve cases, not
  only the new ones.
