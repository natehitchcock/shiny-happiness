# 28. Sorting the suggestions without changing them

Date: 2026-08-31

## Status

Accepted.

> **Number 0028 was assigned to this work.** 0026 (the focus guarantee) and 0027
> are taken. The next agent should take 0029 and should not derive a free number
> by reading the directory — three pairs of agents have collided that way.

## Context

The request, in full:

> "also, add a sort filter that doesn't change the lists, just makes them sort
> asc or desc — so I can sort options by efficiency"

"Sort filter" is a sort **control**, and the clause after the dash is the
constraint the whole thing has to satisfy: *it must not change which cards are
in each list, only their order.*

The machinery already existed. `sortByColumns` sorts one group's rows by the
column chain, and it is applied **per group** — `items: [...sortByColumns(g.items,
…)]` — over `g.items`, which the server has already selected and cut to
`limitPerGroup`. So "does not change the lists" is not something the control has
to be careful about; it falls out of where the sort runs. The rows being
reordered are the rows already on the page.

Three things sit around it, all of them easy to break quietly:

- **P5 — grouping is the product's opinion; scoring only orders within a
  group.** A global "most efficient card anywhere" list dissolves the headings
  and is a different product.
- **The focus guarantee (ADR-0026).** Guaranteed rows are appended at the end
  *because* they sorted below their group's cut, and the client's merged combo
  heading halves its rows for density while rescuing exactly those rows from the
  discarded half.
- **The existing promise about columns.** "As a secondary sort, maintaining
  group ordering of previous sorts" — each sorting instruction the user adds
  breaks the ties of the ones already there.

## Decision

### 1. One control, extending the existing sort — not a second path

`sortByColumns` takes a `Sort` and the two hydrated maps. Its comparator gains
one step, after the column loop and before the server-index tie-break. There is
no second sorting function, no separate pass over the rows, and no state that
can disagree with the columns about what order the list is in.

Keys: `efficiency` (the case asked for), `impact` (its sibling — same shape,
same place on the row), `score`, `manaValue`, `price`, `name`. The last four are
in because they are numbers **already on the row**: a builder comparing two
suggestions reads the cost and the price off the same line, and reaching them
was four lines in `sortValue` rather than a second control. Nothing is offered
that the client would have to invent a new opinion to answer — the server has
already published its ranking as `score`, and a second one drawn from the same
data by a different method would be two rankings disagreeing in public.

`default` is a member of the key union rather than `SortKey | null`, so the
`<select>` has something to be and every `switch` has to answer for it.

### 2. Within groups. Never across them

The sort is applied inside `visibleGroups.map`, one group at a time, exactly as
the column sort already was. The groups are never reordered, merged, split, or
flattened. A row cannot move between headings.

The rejected alternative is the obvious one: a single list ordered by
efficiency. It is a coherent product and it is not this one. It would put a
`staple` above a `combo-3plus` because it costs less mana, which is the app
retracting the argument its headings exist to make (P5, doc 05 §5.3).

### 3. The chosen key breaks what the columns tie; it does not outrank them

Order of precedence: **columns, then the key, then the server's index.**

Rejected: putting the key first, on the reading that "sort by efficiency" means
the most efficient row must be on top no matter what. It loses to the rule that
already orders the columns among themselves — each instruction the user adds
breaks the ties of the ones before it — and demoting a column the moment a key
is picked would silently cancel an instruction the user gave and can still see
on screen.

The cost is small and bounded. A column's rank is binary, so the key still fully
orders each of the two blocks a column makes; and with no columns, which is the
ordinary case, the key **is** the primary sort.

### 4. Guaranteed rows sort with everything else

Under a chosen key an ADR-0026 row takes the place its own number earns. The
guarantee is about being **present**, not about occupying a particular end of
the list: pinning guaranteed rows would be the app re-asserting its ordering
after the user had overridden it.

They cannot be dropped by this, and the reason is the order of the memos rather
than a special case. `shownGroups` merges the combo groups, halves them, and
rescues the guaranteed rows from the discarded half. `visibleGroups` folds in
anything an expand fetched. **Then** the sort runs. It reorders whatever it is
handed and returns every row exactly once, so nothing upstream of it can be
undone by it. `sorting.test.tsx` pins this with a four-row combo group whose
guaranteed row is both below the cut and the most efficient of the four.

### 5. Unknown values sink in both directions

A row with no value for the key — metrics a build did not send, a card that has
not hydrated, a card with no price — goes to the bottom whichever way the sort
runs, keeping the order it arrived in.

Rejected: let unknowns be a `-Infinity` and reverse with everything else, which
is what falls out of a naive implementation. That makes "least efficient first"
open with the cards whose efficiency nobody knows — the strongest possible claim
from the weakest possible evidence. Sinking them both ways means the top of the
list is always rows that actually answered the question, whichever end of the
scale is being asked about.

**Zero is not unknown.** A land really does measure 0 efficiency — `cardEfficiency`
is total, and a noncreature with no rules text scores `0 / (mv + 1)` — so it
sorts as a 0 and lands at the bottom of "highest first", *above* the rows
nothing is known about. This is the same argument `columnRank` already makes for
a metric column with no values: a key with nothing behind it must contribute
nothing, because inventing an order from data we do not have looks exactly like
it worked.

The consequence, stated because it is real: the sort is **not an involution**.
Ascending is not the reverse of descending — the unknown tail stays put, and so
does the order of rows that tie.

### 6. The default stays the default, and is one click away

While `DEFAULT_SORT` holds, the top of each group is the app's recommendation
and nothing changes. The moment it does not, the line under the control says so:

> Your order: efficiency, highest first. Same suggestions in every group,
> reordered — these are the ones already on screen, not the whole card pool.

Two things are being said. The first is **whose** ordering is on screen, because
once the user sorts, the top row stopped being a recommendation and the
interface must not keep implying otherwise. The second is the **honest scope**:
the server cut each group before the client saw it, so "least efficient" means
the least efficient *of the suggestions shown*. The control must not read as
though it searches the pool, because it cannot.

The way back is `Recommended`, first in the select, plus an explicit
`Recommended order` button that appears only when there is something to go back
from. The button exists because "set the select back to the value it started at"
asks the reader to remember a value.

### 7. Client-only. Nothing is sent, nothing is stored

No request, no deck field, no `localStorage`. It changes nothing about what is
recommended or which group anything is in, so there is nothing for the wire to
carry — and a round trip would make a reorder feel like a query, and would let
the server's cut move under the user mid-gesture.

## Consequences

- `Recommendation` in `apps/web/src/api.ts` now declares `impact` and
  `efficiency`. Both have been on the wire since the metrics shipped —
  `recommend` sets them on every item, the route spreads the item whole, and the
  same route reads `item.impact.score` back to decide what an `impact>=6` column
  ticks. Declaring them is what lets the client sort by the same numbers the
  server filtered on. Additive and optional, so not a contract change (R2).
- `sortByColumns` keeps its name though it now does more than columns. Renaming
  it would touch every call site and every test for no behavioural gain, and
  other work is live in this function.
- R4: a native `<select>` and native buttons. The direction is a button
  **labelled with its state in words** — "Highest first", "A–Z" — never an
  arrow: a glyph is not a state a screen reader can read, and ▲/▼ is genuinely
  ambiguous even to a sighted reader about whether it shows the current order or
  the one a click would produce. Its accessible name says both halves. The state
  line is a `role="status"` region, present in both states rather than mounted
  on demand, because a live region inserted at the same moment its text appears
  is not reliably announced.
- Sorting by name, mana value or price re-runs as hydration lands, since those
  keys read the hydrated maps. A row sorts as unknown until its card arrives and
  then takes its place — which is visible, and correct.
