# 2. Domain model

Everything in this document lives in `packages/domain` as pure TypeScript types
and pure functions. No IO, no fetch, no database access. See [AGENTS.md](../AGENTS.md).

## 2.1 Card identity: oracle, not printing

A Commander deck cares about *oracle identity* — "Sol Ring", not "Sol Ring, Commander
2021 printing, foil". Two cards with the same `oracleId` are the same card for
singleton legality, combo matching and recommendation purposes.

```ts
type OracleId = string & { readonly __brand: 'OracleId' }   // Scryfall oracle_id (UUID)
type PrintingId = string & { readonly __brand: 'PrintingId' } // Scryfall id (UUID)

interface Card {
  oracleId: OracleId
  name: string
  manaCost: string | null       // "{2}{R}"
  manaValue: number             // Scryfall cmc
  colorIdentity: Color[]        // W U B R G — governs deck legality
  typeLine: string
  oracleText: string
  keywords: string[]
  legalities: { commander: Legality }
  edhrecRank: number | null     // lower = more played overall
  defaultPrinting: PrintingId   // for imagery
  roles: Role[]                 // derived, see 2.4
}

type Color = 'W' | 'U' | 'B' | 'R' | 'G'
type Legality = 'legal' | 'not_legal' | 'banned' | 'restricted'
```

`Printing` (art, set, collector number, image URIs, prices) is a **separate**
entity keyed by `PrintingId`. The deck references oracle identity; the UI resolves
a printing only when it needs pixels or a price. Agents must not embed image URLs
in `Card`.

## 2.2 Deck

```ts
interface Deck {
  id: DeckId
  name: string
  commanders: OracleId[]          // 1, or 2 for Partner / Background / Friends forever
  targetBracket: Bracket          // 1..5, see doc 03
  archetype: ArchetypeKey         // the deck's plan, see doc 14
  archetypeSecondary: ArchetypeKey | null   // hybrid; targets blend 70/30
  colorIdentity: Color[]          // derived from commanders; cached
  entries: DeckEntry[]
  budget: BudgetConstraint | null
  createdAt: string
  updatedAt: string
}

interface DeckEntry {
  oracleId: OracleId
  zone: Zone
  origin: Origin
  locked: boolean                 // user pinned it; automation may not remove it
  roleOverride: Role[] | null     // user disagrees with derived roles
  addedAt: string
}

type Zone   = 'accepted' | 'excluded'
type Origin = 'core' | 'manual' | 'recommended' | 'imported'
```

### Card states — the full lattice

A card, relative to a given deck, is in exactly one state:

| State | Meaning | How it got there |
| --- | --- | --- |
| `accepted/core` | In the deck, came from a bracket core package | Auto-added on bracket selection |
| `accepted/manual` | In the deck, user searched for it | User action |
| `accepted/recommended` | In the deck, user accepted a suggestion | User action |
| `accepted/imported` | In the deck, came from a decklist import | Import |
| `excluded` | Explicitly rejected; **never suggested again** for this deck | User dragged out / swiped away |
| *(absent)* | Not in the deck, eligible to be suggested | Default |

**P6 rule:** dragging a `core` card out of the Accepted region moves it to
`excluded`, not to absent. Re-running the core package must not re-add it. The UI
shows excluded core cards in a collapsed "Removed from core (3)" affordance so the
decision is reversible but not accidental.

`locked` is orthogonal to state: a locked accepted card is immune to bulk
operations (bracket change, "clear recommendations", core repackaging).

## 2.3 Combos

Sourced from Commander Spellbook — see [04-data-sources.md](04-data-sources.md).

```ts
interface Combo {
  id: ComboId
  pieces: OracleId[]              // all cards required
  prerequisites: string           // "All permanents on battlefield, Krenko untapped"
  steps: string[]
  produces: ComboResult[]         // 'infinite-mana', 'infinite-damage', 'win-the-game', ...
  colorIdentity: Color[]
  bracketImpact: BracketImpact    // see doc 03
}
```

### Combo degree — the precise definition

This is the core ranking primitive and the definition the user asked for. It must
be implemented exactly as written.

Let `A` be the set of oracle ids in the deck's **accepted** zone, *including the
commander(s)*. Let `X` be a candidate card not in `A`.

For a combo `C` with piece set `pieces(C)`:

- `C` is **completed by X** iff `X ∈ pieces(C)` **and** `pieces(C) \ {X} ⊆ A`.
  That is: adding X turns C from unavailable into available, using only cards you
  already have.
- `C` is **near X at distance d** iff `X ∈ pieces(C)` and
  `d = |pieces(C) \ (A ∪ {X})|` and `d ≥ 1`.

Then:

```
comboDegree(X, A)   = |{ C : C is completed by X }|
nearCombos(X, A, d) = |{ C : C is near X at distance d }|
```

**The distinctness rule the user specified:** these are counted over *distinct
combos*, not distinct partner cards. A card X that forms one combo with the
commander and a separate, unrelated combo with another accepted card has
`comboDegree(X) = 2`. Overlap of participating cards between the two combos is
irrelevant. Two different Spellbook entries are two combos even if they share
pieces.

**Consequences to implement deliberately:**

- Degree is a function of the *current* accepted set, so it is recomputed on every
  accept/exclude. It is not a property of the card. Cache keyed on
  `hash(A) × cardId`, invalidated on any zone change.
- Adding a card can *raise* the degree of other candidates (it becomes a new
  partner). The candidate region must re-group, not just re-sort, after an accept.
  This re-grouping is the single most important feedback loop in the app; it must
  be visibly animated, not a silent list swap.
- Degree 0 is normal and fine. Most good cards complete zero combos.
- `nearCombos(X, A, 1)` — "one card away" — is surfaced as a secondary signal,
  because it identifies the *pair* of cards you should add together.

### Combo degree for the deck as a whole

`deckCombos(A) = |{ C : pieces(C) ⊆ A }|` — combos fully assembled in the deck.
Displayed in the header. Relevant to bracket compliance (doc 03).

## 2.4 Roles

Roles are the vocabulary for composition targets and for the "fills a gap"
candidate group.

```ts
type Role =
  | 'land' | 'ramp' | 'draw' | 'tutor'
  | 'spot-removal' | 'board-wipe' | 'graveyard-hate' | 'protection'
  | 'recursion' | 'wincon' | 'synergy' | 'stax'
  // added for archetype targets — see doc 14 and ADR-0005
  | 'sac-outlet' | 'token-maker' | 'anthem' | 'equipment' | 'aura' | 'evasion'
```

Role assignment is **derived and imperfect**. The pipeline, in precedence order:

1. **User override** (`roleOverride` on the deck entry) — always wins.
2. **Curated overrides table** — a checked-in list for cards the heuristics get
   wrong. Expected to hold a few hundred entries.
3. **Oracle-text heuristics** — regex/keyword rules over `oracleText` and
   `typeLine` (e.g. `/^Add \{/m` → `ramp`; `/[Dd]estroy target/` → `spot-removal`).

A card may hold several roles (Cultivate is `ramp` + `land`-fetch; Beast Within is
`spot-removal`). Composition counting must therefore either allow double-counting
or assign a primary role — **decision: assign a `primaryRole` for counting, keep
the full set for filtering.** The primary role is the first match in a fixed
precedence order defined in `packages/domain/src/roles/precedence.ts`.

Rule 3 will be wrong often enough to matter. Treat the curated table as a
first-class, growing artifact, and expose "this card's role is wrong" as a
one-tap correction in the UI that both fixes the deck and files a data issue.

## 2.5 Recommendation

The output of the candidate engine. Never persisted as truth — always recomputed.

```ts
interface Recommendation {
  oracleId: OracleId
  group: CandidateGroupKey     // which bucket it was placed in
  score: number                // ordering *within* the group only
  comboDegree: number
  nearCombosAt1: number
  completedCombos: ComboId[]   // for the explanation panel
  edhrecSynergy: number | null
  edhrecInclusion: number | null // 0..1, share of decks for this commander
  fillsRoleDeficit: Role | null
  bracketFlags: BracketFlag[]  // e.g. 'game-changer', 'two-card-infinite'
  reasons: Reason[]            // P4 — human-readable, ordered by weight
}
```

`reasons` is required, not optional. A recommendation produced without reasons is
a bug, and the type should make that impossible to express.
