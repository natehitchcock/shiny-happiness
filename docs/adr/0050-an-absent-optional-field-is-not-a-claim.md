# 50. An absent optional field is not a claim, and must not be rendered as one

Date: 2026-09-02

## Status

Accepted.

> **Number 0050 was assigned to this work.** Do not derive a free number by
> reading the directory — agents have collided that way twice, and 0039, 0042
> and 0049 are missing from the sequence for exactly that reason. The next
> agent should be told its number.

## Context

A combo-deck playtest found four client-side defects. Two of them were the same
mistake wearing different clothes, in two different files, found in one
afternoon:

```tsx
// packages/ui/src/card/Detail.tsx
export const Detail = ({ combos = [], ... }) => (
  ...
  {combos.length === 0
    ? <p>Not part of any combo we know about.</p>
    : <ul>...</ul>}
)
```

`Detail` was rendered by Quickbuild with **no `combos` prop at all**. The
default turned "I was not told" into `[]`, and the branch turned `[]` into a
printed negative finding. So every card in the Quickbuild panel read:

> **WHY THIS IS HERE** · completes 1 combo
> **COMBOS** · Not part of any combo we know about.

One inch apart, and on cards where the denial was flatly false — Vandalblast,
Sol Ring, Swords to Plowshares, all of them one card from a real combo.

The defect is not the wrong default. It is that **three states were collapsed
into two**:

| state | means | honest rendering |
| --- | --- | --- |
| a non-empty list | here is what we found | show it |
| `[]` | we looked and found nothing | say so — it is a finding |
| absent | nobody asked | say nothing |

A default value can only ever map the third onto one of the first two. There is
no value that means "no answer", so a default is always a fabricated answer.

This is not a React idiom problem. The same shape is already all over this
codebase in places where it was got *right*, each time by someone noticing it
separately:

- `Recommendation.impact` — "Absent means *this build did not compute them*,
  never *this card scores zero*", which is why `sortValue` returns `null` and
  sinks the row rather than sorting it as a 0 it never claimed.
- `CardDetail.references` — absent means a server from before the field shipped,
  and the preview draws plain rules text rather than "this card names nothing".
- `emptinessOf` in the workspace — a heading with no rows had one badge saying
  SATISFIED for four different situations, the worst of which was *the request
  failed*: with the API down, every heading claimed the deck's every need was
  met, at the exact moment the app knew nothing at all.

That last one is the same bug at a larger scale, and it shipped. The rule is
worth writing down rather than rediscovering a fourth time.

## Decision

### 1. An optional field's absence is rendered as silence, never as a negative

If a component was not given a value, it says nothing about that value. It does
not print a default, an empty state, a zero, or a "none found" sentence.

Concretely, for `Detail`: `combos` loses its `= []` default and the whole
Combos section — heading included — is omitted when the prop is absent. `[]`
still prints "Not part of any combo we know about", because a caller that
passed an empty list has made a claim and the claim is worth showing.

### 2. Where absence IS a defect, say so loudly — and that is the exception

`Detail`'s `reasons` sits ten lines above `combos` and does the opposite: an
empty or missing list renders "No reasons were supplied for this suggestion.
That is a bug." That is correct and stays.

The two are not inconsistent, and the difference is the whole rule. **P4
guarantees every recommendation carries non-empty `reasons`**, so an absent
`reasons` is a broken guarantee, and quietly omitting the section would hide
exactly the defect the pillar exists to catch. **Nothing guarantees a caller
knows a card's combos.** Absence there is ignorance, not a defect, and the
honest rendering of ignorance is silence.

So: a field with a guarantee behind it may shout about its own absence. A field
without one may not speak at all.

### 3. A caller does not supply a list it cannot vouch for

The other half of the fix, and the half that would otherwise come back. It would
have been easy to make Quickbuild pass `item.combos` and call the matter
closed — but a `Recommendation` carries only the **completed** combos, every
piece already in the deck. An empty list from that source says nothing about the
near misses, which is the claim most of those cards are on the page for. Passing
it would have re-created the same false sentence for exactly the cards the
playtest complained about.

Quickbuild therefore passes nothing, and the card's combo standing is still on
screen twice: `reasons` states it in words and `ComboBadge` in a number — and
`ComboBadge` already returns `null` at degree 0 and near 0, which is this same
decision, made correctly, in a component nobody had to fix.

### 4. A count and the rows under it must reconcile on the page

The generalisation, recorded here because the same playtest produced two
instances of it and doc 05 §5.3 and doc 19 §19.2 now carry the specifics.

A number printed over a list is a claim about that list. Either the list matches
it, or the difference is named where the reader is looking — never left as an
arithmetic discrepancy the reader is expected to absorb. The two instances:

- "Completes combos **131**" over twelve rows, with twelve more in the client's
  own hands and no way to reach them (doc 05 §5.3).
- "**5** staple lands you don't have yet" over an empty panel, because the
  heading counted one response and the body drew another (doc 19 §19.2).

## Consequences

- `Detail`'s Combos section disappears entirely for a caller that passes no
  `combos`. That is Quickbuild today and nothing else: the workspace preview has
  its own combo rendering and the L3 gallery passes `[]` deliberately, as its
  empty-state fixture.
- A caller that genuinely wants "we checked, there are none" must pass `[]`
  explicitly. This is the intended cost — the claim now requires someone to make
  it.
- `Detail.test.tsx` pins all three states separately. The mutation that restores
  `combos = []` fails exactly one test and no others, which is the property that
  makes the rule enforceable rather than merely written down.
- This does not license removing empty states generally. A group heading with no
  rows is still **kept** and drawn collapsed, because there the app *does* know
  the answer and "you have enough removal" is a result worth seeing. The rule is
  about not knowing, not about being empty.
