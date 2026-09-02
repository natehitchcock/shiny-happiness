# ADR-0034 — Composition counts copies, not distinct cards

**Status:** accepted
**Date:** 2026-09-01
**Supersedes nothing. Extends:** [ADR-0024](0024-two-colour-charts-identity-and-generation.md), which fixed the same defect for the colour charts alone.

---

## Context

The report was four words long:

> "basic lands need to count towards your land count"

They do not, and the reason is one line. `countComposition` iterated
`acceptedSet(deck)`:

```ts
for (const oracleId of acceptedSet(deck)) { total += 1; ... }
```

`acceptedSet` returns a `ReadonlySet<OracleId>`. Every duplicate copy collapses
to one, so twenty Mountains were one land.

**The report names a symptom, not the defect.** It reads as a land bug because
Commander is singleton and basics are nearly the only card a deck runs in
multiples. The actual defect is that the composition panel counted DISTINCT
CARDS while calling the number a card count. Every field on `CompositionCounts`
was wrong on any deck with a repeat — `total`, `byRole`, `byType`,
`byDimension`, `manaCurve` and `averageManaValue` — and the cards affected
include Relentless Rats, Persistent Petitioners, Shadowborn Apostle, Dragon's
Approach, Slime Against Humanity and the Nazgûl as well as the basics.

Measured on the local database:

| deck | accepted entries | distinct ids | cards not counted |
| --- | --- | --- | --- |
| Yedora Sacrifice Engine | 85 | 66 | **19** |
| Kenrith, the Returned King | 45 | 38 | **7** |
| Kenrith colour check | 31 | 16 | **15** |
| Aristocrats web probe | 98 | 98 | 0 |

**This is the third sighting of one defect.** ADR-0024 found it in the colour
pie ("ten Mountains reported as one red source") and fixed it there by adding
`acceptedCopies` and pointing the colour charts at it — but left every other
caller on `acceptedSet`. `cut.ts`'s `lockedCurve` and `lockedComposition` found
it independently and count from `deck.entries`, each carrying a comment saying
`acceptedSet` "would collapse the duplicate copies the count is about". So the
gold "locked" overlay has been counting copies while the bar underneath it
counted distinct cards, and an overlay could exceed its own bar.

## Decision

**`countComposition` iterates `acceptedCopies(deck)`.** One entry per copy,
commanders included, a commander that also holds an accepted entry counted once.

`acceptedSet` and `acceptedCopies` both stay, and both stay correct.
`acceptedSet`'s docblock already states the rule this ADR is enforcing: a Set is
the right shape for combo lookups, because a combo either has its pieces or it
does not and a second Mountain adds nothing; it is the wrong shape for anything
that counts the deck. **The bug was never in either function. It was a caller
reaching for the wrong one.**

### Rejected alternatives

1. **Special-case basic lands** — count basics from entries, keep the Set for
   everything else. Fixes the reported sentence and leaves every "any number of"
   card still collapsing to one. The defect is the shape of the iteration, not
   the cards it was noticed on.
2. **Make `acceptedSet` return copies** and delete `acceptedCopies`. This breaks
   combo detection, which is the one caller for which a Set is genuinely right,
   and it removes the distinction that makes the mistake visible at the call
   site.
3. **Deduplicate the UI list instead of fixing the count.** See below; this was
   the state of the code and is what made the panel self-consistently wrong.

## Consequences

### What moved, measured on Yedora Sacrifice Engine (combo, bracket 3)

| | before | after |
| --- | --- | --- |
| deck total | 67 | **86** |
| `role:land` | 8 | **27** |
| land target (ideal / min) | 34 / 31 | 34 / 31 — *unchanged* |
| land deficit | −26 | **−7** |
| top Quickbuild gap | **land, short 23** | **ramp, short 6** |
| non-land spells (curve denominator) | 59 | 59 — *unchanged* |
| `manaCurve` | `4,7,15,13,12,4,2,2` | *unchanged* |
| `curveDeltas` | `0,0,0,0,-1,0,0,0` | *unchanged* |
| `averageManaValue` | 2.932 | *unchanged* |
| `assessArchetype` | combo, confidence 0.293 | combo, **confidence 0.431** |
| assessment drivers | land / ramp / spot-removal | **ramp / land** / spot-removal |
| cut hints | 77 | 77 — *unchanged* |

### The consequences, one at a time

**Curve targets and `curveDeltas` barely move, and that is correct.** Lands are
deliberately excluded from `manaCurve` — "a 36-land deck is not over-full at
zero" — so a basics-heavy deck's curve denominator is untouched even as its
total moves by 19. Yedora's curve and every one of its deltas are byte-identical
before and after. A deck running four Relentless Rats *does* move, and should.

**Composition targets do not move at all.** `archetype-targets.ts` states ideals
as absolute counts against a 99-card budget, not as a share of the deck's actual
size. The only path from counts to targets is `averageManaValue`, which feeds
the land modifier — and it is averaged over non-lands, so basics cannot move it.
Yedora's land target is 34/31 before and after.

**`fills-deficit` and the deficit numbers on suggestion rows are the payoff.**
This is the surface the user was looking at. Yedora's land shortfall goes from
23 cards to 4, and the deck's largest gap stops being land and becomes ramp. The
panel was telling a builder with 27 lands to add 23 more.

**Archetype assessment keeps its verdict and gains confidence.** All three
measured decks assess the same archetype before and after, but Yedora's
confidence rises from 0.29 to 0.43 and `land` drops from first driver to second:
the land role was a phantom outlier and is no longer one.

**The cut indicator is unchanged on real decks.** `suggestCuts` flags a
dimension only when it is above `target.max`, and no measured deck crosses that.
It now *can*: a 45-land deck is finally over its land maximum and its lands
become cuttable, which is the honest reading and was previously unreachable.

**Quickbuild's handover threshold can flip, and correctly.** `handoverSize` is
the largest ideal (typically 34–36) and is compared against the deck's `total`.
A deck of 30 distinct cards plus 8 basics used to read 30 and follow the
build order; it now reads 38 and switches to largest-first. It really does hold
38 cards. No measured deck changed regime, but the arithmetic allows it.

**The bracket barometers are unaffected, and audited rather than assumed.**
`bracketFindings` receives `[...accepted]`. Every card class it counts — Game
Changers, tutors, extra turns, mass land denial — is singleton-restricted, so
the Set and the copies list give identical answers. Left on `acceptedSet`
deliberately; it is the cheaper shape and the correct one for a membership
question. This is a latent trap only if a future barometer ever counts a class
that includes basics.

### The UI had to change with it, or it would have inverted the bug

`cardsInDimension` and `cardsInBucket` in `apps/web/src/App.tsx` list the cards
behind one bar, and they were passed `acceptedIds` — a deduplicated `Set` —
with a comment explaining that the list must dedupe *because the bar does*. That
comment was correct when it was written. The moment the bar counted copies it
became the mirror-image defect: a bar reading 30 above a list of one Mountain,
and `countCaveat` printing "the 29 not listed are cards this page has not
loaded", which is a fabricated explanation for a real disagreement. It was
reproduced by mutation before being fixed.

So the client now builds `acceptedCopyIds` alongside `acceptedIds` and keeps
both, mirroring the domain's own pair. `acceptedIds` stays a Set because its
other two readers — `nameMatchStatus` and the preview's "works with your deck"
pass — ask a membership question.

Drawn literally, thirty copies are thirty identical lines under one hover panel,
sharing one React key. **Counting and drawing are therefore separated:**
`groupCopies` collapses repeats for display only — `Mountain ×30`, one line —
while `cards.length` stays the copy count that `countCaveat` checks against the
bar. Grouping inside `cardsInDimension` was rejected, because that shortens the
number the caveat reads and puts the false "not loaded" message straight back.

### Found, not fixed

**`suggestCuts` emits one hint per accepted ENTRY, so a duplicated card gets a
duplicate cut hint** — 19 of Yedora's 77 hints name a card already named. This
is **pre-existing and unrelated**: the function walks `deck.entries` and never
read the collapsed counts, so it is byte-identical before and after this change
(verified by running it against the real deck under both count readings). Left
alone because it is a different defect in a file this change does not otherwise
touch, and fixing it means deciding what "cut this card" means when you hold
twenty of it — a product question, not an arithmetic one.

**No fixture in the repository contained a duplicate card.** The full suite —
2149 tests — passed unchanged after the count was inverted. The existing
composition fixture used `mountain-1` and `mountain-2`, two distinct oracle ids,
which count identically under both readings; that is why this survived. Every
test added here uses a real repeat of one id, and each was mutation-checked.
