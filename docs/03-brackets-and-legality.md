# 3. Brackets, Game Changers, and legality

## 3.1 Baseline Commander legality

Enforced by the domain layer, not the UI:

- Exactly 100 cards including the commander(s).
- Singleton, except basic lands and cards that say otherwise (Relentless Rats,
  Shadowborn Apostle, Persistent Petitioners, Nazgûl, Dragon's Approach…). Keep
  this as a checked-in exception list keyed by oracle id, not a text regex.
- The commander is a legendary creature, or a card that says it may be your
  commander. Two commanders are allowed via Partner / Partner with / Friends
  forever / Choose a Background / Doctor's companion — each with its own pairing
  rule. Model these as a `PartnerRule` discriminated union; do not collapse them.
- **Color identity**: every card's `colorIdentity` must be a subset of the
  commander(s)' combined color identity. Colour identity includes mana symbols in
  rules text and colour indicators, not just the mana cost. Scryfall's
  `color_identity` field already accounts for this — use it, do not recompute.
- Banned list: use Scryfall `legalities.commander`, refreshed with card data.

## 3.2 Commander Brackets

Wizards' bracket system classifies decks 1–5 by power and expected play pattern.
The app treats the target bracket as a **first-class deck property** that drives
core packages, composition targets and candidate filtering.

| Bracket | Name | Character |
| --- | --- | --- |
| 1 | Exhibition | Ultra-casual, theme-first, winning is secondary |
| 2 | Core | Precon level; the default social expectation |
| 3 | Upgraded | Beyond precon; strong cards, still not optimised |
| 4 | Optimized | High power, no self-imposed restrictions |
| 5 | cEDH | Competitive, metagame-driven, tuned to win |

Brackets 1–3 carry restrictions in addition to power level — broadly, limits on
**Game Changers** (a curated WotC list of high-impact cards), on mass land denial,
on chained extra turns, and on two-card infinite combos. Bracket 4 and 5 lift the
restrictions.

> **Do not hardcode the specific numeric allowances or the Game Changers list
> contents from memory.** Both are maintained by Wizards and have been revised
> since introduction. Task `DATA-05` in the work breakdown owns fetching the
> current official list and allowances into
> `packages/domain/src/brackets/rules.data.json`, with the source URL and a
> retrieval date in the file. Every bracket rule in code reads from that file.

### Modelling

```ts
type Bracket = 1 | 2 | 3 | 4 | 5

interface BracketRules {
  bracket: Bracket
  gameChangersAllowed: number | 'unlimited'
  massLandDenial: 'forbidden' | 'discouraged' | 'allowed'
  extraTurnChaining: 'forbidden' | 'discouraged' | 'allowed'
  twoCardInfinites: 'forbidden' | 'discouraged' | 'allowed'
  tutorDensity: 'low' | 'moderate' | 'unrestricted'
}

type BracketFlag =
  | 'game-changer'
  | 'mass-land-denial'
  | 'extra-turn'
  | 'two-card-infinite'
  | 'over-budget'
```

### How brackets affect the UI

Bracket violations are **surfaced, never silently enforced**. The user picked the
bracket; they are allowed to knowingly cross the line, and social formats are
negotiated at the table, not by software.

- A candidate carrying a `BracketFlag` disallowed at the target bracket shows a
  warning badge at L2 and a full explanation at L3.
- Accepting it is permitted. The header's bracket chip switches to a warning state
  showing the overage: `Bracket 3 · 4/3 Game Changers`.
- A "Bracket check" panel lists every current violation with a one-tap fix
  (exclude the offending card, or raise the target bracket).
- `deckCombos(A)` (doc 02) is scanned for two-card infinites: any combo where
  `|pieces| == 2` and `produces` includes an infinite result.

This is the correct behaviour for a rules framework that is explicitly a
conversation aid rather than a ban list.

## 3.3 Core packages

Each bracket has, per colour identity, a **core package**: cards that are close to
automatic inclusions at that power level. Selecting a bracket offers to add its
core package to the Accepted region as a single collapsible `Core` group.

Core packages are **generated, not hand-written** — see
[05-scoring-and-recommendations.md](05-scoring-and-recommendations.md) §5.5. The
generation input is aggregate inclusion statistics per colour identity and bracket;
the output is a versioned artifact checked into the repo so builds are
reproducible and reviewable.

Interaction rules:

- Adding a core package never overwrites `locked` or `manual` entries.
- Every core card is individually removable (drag out, or tap → Remove). Removal
  sets `excluded` per P6.
- Changing bracket recomputes the core group only. Manual, recommended and locked
  entries survive untouched, and the UI states plainly what changed:
  *"Bracket 2 → 3: +9 core cards, −4 no longer core (kept: 2 you locked)."*
- A card can be simultaneously core-eligible and already manually added. It stays
  one entry; its `origin` is not downgraded from `manual`.
