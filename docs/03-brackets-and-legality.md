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

Brackets 1–3 carry restrictions in addition to power level. The one Wizards still
publishes as a per-bracket number is the limit on **Game Changers** (a curated
WotC list of high-impact cards): brackets 1 and 2 allow none, bracket 3 allows up
to three, brackets 4 and 5 are unlimited.

> **Do not hardcode the specific numeric allowances or the Game Changers list
> contents from memory.** Both are maintained by Wizards and have been revised
> since introduction. The allowances live in
> `packages/domain/src/brackets/rules.data.json` with the source URL, the
> retrieval date and the quoted wording; the Game Changers list is not in that
> file at all — it is read from the corpus, where Scryfall's `game_changer`
> boolean carries it. See [ADR-0018](adr/0018-bracket-rules-and-game-changers.md).

**The other three barometers have no current per-bracket value, and the tutor
restriction was withdrawn outright** in the October 2025 bracket update. Wizards
replaced them with a prose expectation of how many turns a game should last
(bracket 1 "at least nine turns before you win or lose", 2 "eight", 3 "six",
4 "four", 5 "could end on any turn"), which states no permitted/forbidden
verdict. They are `null` in the data file and in the type, and `null` means "the
format publishes no rule here" — not "allowed". Modelling the turn counts is a
design question that has not been taken up.

### Modelling

```ts
type Bracket = 1 | 2 | 3 | 4 | 5

type BracketPermission = 'forbidden' | 'discouraged' | 'allowed'

interface BracketRules {
  bracket: Bracket
  gameChangersAllowed: number | 'unlimited'
  // Null: Wizards publishes no current per-bracket value (ADR-0018).
  massLandDenial: BracketPermission | null
  extraTurnChaining: BracketPermission | null
  twoCardInfinites: BracketPermission | null
  tutorDensity: 'low' | 'moderate' | 'unrestricted' | null
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

**Implemented so far:** the Game Changers count. `/decks/:id/analysis` returns
`bracket.violations` for a deck over its target's allowance, `bracket.gameChangers`
naming the cards, and `bracket.rules` carrying the source URL, the retrieval date
and the target bracket's published entry — the one allowance and the four nulls.
`bracket.assessed` stays `null` — one barometer of five is not a verdict — and the
`unavailable` entry says so. The mass-land-denial, extra-turn and two-card-infinite
checks above wait on Wizards publishing a rule to check against.

**And it is on screen.** The masthead chip carries the arithmetic in every state,
not only the failing one — `BRACKET 3 · 4/3 GAME CHANGERS`, rust-bordered and
marked when over — because a chip that appeared only on a violation would make
its own absence read as the pass this system cannot give. It opens a **Bracket
check** panel in the analysis rail which states the allowance, expands the count
into the card names (each opening the card), lists the four barometers BY NAME
against "no published rule", quotes the server's own account of why no bracket is
assessed, and links the source URL with the date it was read. Nothing in it
renders a tick, a "passes" or an assessed bracket; `apps/web/src/bracket.test.tsx`
pins that as a property rather than trusting it.

The four barometer rows are drawn from `bracket.rules.targetBracket`'s nulls, not
from a list in the client: a barometer Wizards later publishes would appear on its
own, and it would read "*value*, not checked here" — because this app has no check
for it, and a rule shown without that qualifier implies the deck was measured
against it.

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
