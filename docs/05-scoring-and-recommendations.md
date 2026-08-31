# 5. Grouping, scoring, and recommendations

Pure functions in `packages/domain/src/recommend/`. Deterministic: same deck +
same dataset snapshot = same output, always. This is a hard requirement, because
a recommendation engine you cannot reproduce is one you cannot debug or test.

## 5.1 The pipeline

```
                accepted set A (incl. commanders)
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
   eligibility          combo index        stats (own corpus
   filter               (Spellbook)        + own corpus)
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
                   annotate each candidate
              (comboDegree, nearCombos, synergy,
               inclusion, roleFit, bracketFlags)
                            │
                            ▼
                 ── ASSIGN TO GROUP ──   (P5: grouping first)
                            │
                            ▼
                 ── SCORE WITHIN GROUP ──
                            │
                            ▼
                    ordered CandidateGroup[]
```

**Grouping happens before scoring, and scoring only orders within a group.** There
is no global "top card" ranking anywhere in the product.

## 5.2 Eligibility filter

A card is a candidate iff all hold:

- `legalities.commander === 'legal'`
- `colorIdentity ⊆ deck.colorIdentity`
- not already `accepted`
- not `excluded` (P6 — permanently, for this deck)
- passes the active candidate query, if any — a Scryfall-style filter over card
  data *and* our own annotations (`t:instant mv<=2`, `combo>=2 role:ramp`). Full
  syntax and UI in [13-candidate-query.md](13-candidate-query.md)

Basic lands are excluded from candidate generation entirely; land count is handled
by the mana base tool, not by card-by-card suggestion.

## 5.3 Candidate groups

Groups are produced in this fixed order. A card appears in **exactly one** group —
the first it qualifies for — so the region has no duplicates and counts sum to the
pool size.

| # | Group | Membership | Why it exists |
| --- | --- | --- | --- |
| 1 | `combo-3plus` | `comboDegree ≥ 3` | The headline feature |
| 2 | `combo-2` | `comboDegree == 2` | Includes the two-separate-combos case (doc 02) |
| 3 | `combo-1` | `comboDegree == 1` | |
| 4 | `near-combo` | `comboDegree == 0 ∧ nearCombosAt1 ≥ 2` | "One card away, more than once" — surfaces *pairs* to add together |
| 5 | `fills-<role>` | Deficit in that role ≥ 1, card's `primaryRole` matches | Directly actionable; one group per deficient role |
| 6 | `top-<type>` | Top N by corpus inclusion for the commander, per card type | The "top ten sorceries" ask |
| 7 | `high-synergy` | Corpus synergy above threshold | Commander-specific, non-obvious cards |
| 8 | `staple` | High global inclusion, colour-legal | The long tail; collapsed by default |

Groups 1–4 need only Spellbook data. Groups 6–7 need corpus statistics, which do
not exist until the project has imported enough decks (ADR-0008). **If the stats source
is unavailable the app still works** — groups 6 and 7 are omitted with an inline
notice, and 1–5, 8 carry the experience. This is the degradation path from §4.3.

When a candidate query is active, group headers show the filtered count and each
group footers any cards the query withheld (`+3 more complete 3+ combos but don't
match your filter · show`). Filtering narrows the pool; it never flattens the
groups and never silently hides a high-degree card.

Group headers show a count and a one-line explanation. Empty groups are hidden,
except a deficit group with zero candidates, which is itself a finding worth
showing ("Ramp −3, no eligible candidates under your budget filter").

## 5.4 Composition targets

The "how many lands / ramp / interaction / creatures should I have" feature.
Targets are a function of `(bracket, archetype, average mana value)`.

```ts
type CompositionDimension =
  | { kind: 'role'; role: Role }
  | { kind: 'type'; type: CardType }

interface CompositionTarget {
  dimension: CompositionDimension
  min: number; ideal: number; max: number
}
```

**Archetype supplies the base vector** — an aggro deck and a control deck do not
want the same numbers, and a single universal table is wrong for every deck that
is not midrange. The nine archetypes and their vectors are
[14-archetypes.md](14-archetypes.md); the table below is the `midrange` row,
reproduced here because the modifiers that follow apply on top of whichever row
the archetype selects.

**Seed values** (`midrange`) — heuristics from established Commander deckbuilding
practice. There are no third-party averages to replace them with (ADR-0008); they
are refined from our own
corpus once `DATA-03` lands. A starting point, not a claim of optimality:

| Role | min | ideal | max |
| --- | --- | --- | --- |
| land | 33 | 36 | 39 |
| ramp | 8 | 11 | 14 |
| draw | 6 | 9 | 12 |
| spot-removal | 5 | 8 | 11 |
| board-wipe | 1 | 3 | 5 |
| wincon | 2 | 4 | 6 |

**`wincon` is in this table and in no archetype row.** Doc 14 §14.2 defines the
nine vectors over eight dimensions and `wincon` is not one of them, so
`compositionTargets` never emits a `wincon` target and there is no `fills-wincon`
group. Left as a known gap rather than papered over: adding the dimension changes
what nine archetypes offer and what `assessArchetype` measures, which is a change
worth making deliberately rather than to tidy a table.

Adjustments to apply as pure modifiers on top of the archetype row, each
individually testable:

- Low average mana value (< 2.8) → land ideal −1; high (> 3.5) → +1.
- Each ~2 modal double-faced land-back cards → land ideal −1.
- Each 2 cheap cantrip-ish rocks beyond the ramp ideal → land ideal −1.
- Bracket 4–5 → draw and interaction ideals +1 to +2; bracket 1 → −1.

The header shows `dimension current/ideal` with a deficit/surplus colour, and each
deficit opens the corresponding `fills-<dimension>` candidate group. That is the whole
loop: *see the gap → tap the gap → see cards that close it.*

Show targets as a **range with the ideal marked**, never a single number. A deck
at 34 lands is not broken and the UI must not say it is.

## 5.5 Core package generation

Core packages (doc 03) are generated offline, checked in, and versioned.

For each `(bracket, colorIdentity)` pair:

1. Take the deck corpus for that bracket and colour identity (MTGJSON official
   decklists plus our own imported decks,
   plus our own corpus weighted by volume).
2. Compute inclusion rate per card among decks whose colour identity *contains*
   the target — a mono-red staple is core for every deck containing red.
3. Keep cards above an inclusion threshold, tiered: `essential` (very high
   inclusion), `standard`, `optional`.
4. Drop anything carrying a `BracketFlag` disallowed at that bracket.
5. Cap package size by role so a core package cannot itself blow the composition
   targets — a core package that hands you 20 ramp spells is a bug.
6. Emit `packages/domain/src/core-packages/<bracket>-<colors>.json`, with the
   generation date, corpus size, and thresholds in the file.

Generated artifacts are committed so a build is reproducible and a human can
review a diff before it reaches users. A core package that changes silently under
users is a P6 violation.

## 5.6 Scoring — within a group only

```
score(X) = w_combo   · log2(1 + comboDegree(X))
         + w_near    · log2(1 + nearCombosAt1(X))
         + w_syn     · norm(synergyScore(X))
         + w_inc     · inclusionShare(X)
         + w_fill    · roleDeficitFit(X)
         + w_curve   · curveFit(X)
         + w_emph    · emphasisScore(X)
         − p_bracket · bracketRisk(X)
         − p_budget  · budgetOverrun(X)
```

Notes that matter:

- `log2(1 + degree)` keeps a single 9-combo card from dominating a group. Degree
  is already the *grouping* key, so its job in the score is tie-breaking, not
  ranking.
- `norm()` normalises across the current candidate pool, not globally, so scores
  stay comparable within a rendering.
- `curveFit` rewards cards at mana values where the deck is thin.
- `bracketRisk` is a **soft penalty** that reorders; it never filters. Doc 03: the
  user is allowed to cross their own line knowingly.
- Weights live in one checked-in config with defaults, are overridable per deck by
  a small set of user-facing sliders ("weight combos / statistics / filling gaps"),
  and are **never** tuned by silent A/B on live users without saying so.

Ties break by `edhrecRank`, then by name, so ordering is total and stable — no
list reshuffling between renders.

### Semantic emphasis

`emphasisScore` is the one term the builder writes with their own hands. A deck
stores a set of `SynergyTag`s it is ABOUT — picked from the commander's own tags
at the start screen, changed by clicking a chip afterwards, cleared by sending
an empty list — and every candidate carrying one of them gains
`sum(w) / (sum(w) + 4)`, on the same saturating curve as `synergyScore`. Weights
come from the matches `synergyMatches` already produced, so a tag matched as
`enables` still outranks the same tag matched as `theme`. A tag the deck does
not do at all floors at 1 (`EMPHASIS_FLOOR`), one accepted card's worth, so
emphasising something read off a card in the feed is not silently inert.

Three properties are load-bearing:

- **It is a separate additive term, not a multiplier inside `synergyScore`.**
  `synergyScore` also feeds the `high-synergy` group threshold in §5.3, and
  scaling it would let a user preference change which GROUP a card lands in.
  Grouping is the product's opinion; score only orders within it (P5). For the
  same reason it is not a raised `THEME_WEIGHT` — that is both inside
  `synergyScore` and blind to `enables` and `payoff` matches.
- **It never touches the composition targets of doc 16.** Those decide
  `s.deficit` and the `fills-<role>` groups, upstream of every line in the sum.
  A deck can want eighteen creatures AND be about opponent-discard.
- **It never filters.** An emphasis nothing supports returns the same
  suggestions it always did; `RecommendResult.emphasis` reports
  `supporting: 0` per tag so the absence is named rather than mimed.

`Reason` says which of the two claims it is making: a `keyword-synergy` reason
about an emphasised tag carries `emphasised: true`, so "benefits from your
sacrifice fodder" and "benefits from your EMPHASISED sacrifice fodder" are
distinguishable (§5.7, P4). Where a card has both, the emphasised match is the
one named — it is what moved the card.

## 5.7 Explanations (P4)

Every `Recommendation` carries ordered `reasons`. Rendered verbatim at L3:

> **Kiki-Jiki, Mirror Breaker**
> - Completes **3 combos** with cards you have accepted:
>   - *Kiki-Jiki + Zealous Conscripts* → infinite hasty creature copies
>   - *Kiki-Jiki + Zealous Conscripts + Goblin Bombardment* → infinite damage
>   - *Kiki-Jiki + Zealous Conscripts + Purphoros* → infinite damage
> - **61%** of Krenko decks in the corpus play it (synergy +0.44)
> - ⚠️ **Game Changer** — your target Bracket 3 allows 3, you already have 3

Note what that example demonstrates: three combos sharing a piece still count as
three. Degree counts distinct combos, not distinct partner cards (doc 02 §2.3).
Note also that every card named is red or colourless — a reason referencing a
card outside the deck's colour identity is a bug in the eligibility filter, not a
display bug.

Reasons are generated from the annotation record, not written by hand per card,
and the generator is unit-tested against fixture decks. If a reason cannot be
generated, the card is not recommended.

## 5.8 Performance budget

`comboDegree` over a ~30k-card pool against a 100-card accepted set, recomputed on
every accept, is the hot path.

- Precompute `oracleId → ComboId[]` and `ComboId → pieces` at ingest.
- On accept/exclude, do **not** recompute the whole pool: only candidates sharing
  a combo with the changed card can change degree. Walk
  `combosContaining(changedCard) → pieces → candidates` and patch. This is a small
  set — typically dozens.
- Full recompute only on deck load and commander change.
- Budget: full recompute < 200 ms server-side; incremental patch < 16 ms so it can
  run in the client between frames.
