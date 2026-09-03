import type { BracketFlag } from './bracket.js'
import type { CompositionDimension, TargetSource } from './composition.js'
import type { CardEfficiency } from './efficiency.js'
import type { FixingReach } from './fixing.js'
import type { CardImpact } from './impact.js'
import type { ComboId, OracleId } from './ids.js'
import type { SynergyTag } from './synergy.js'
import type { Role } from './role.js'

/**
 * Candidate groups, in the fixed order of doc 05 §5.3. A card appears in exactly
 * one — the first it qualifies for — so counts sum to the pool size.
 *
 * `staple` AND `staple-land` ARE THE CURATED LIST (ADR-0044), not a threshold
 * over a statistic. `staple` used to be the catch-all: with `stats: null` in
 * production every eligible card with nothing else to say landed in it, under
 * the heading "Staples", at the BOTTOM of the page. The catch-all is now called
 * `other`, which is what it always was, and the name `staple` means what it
 * says for the first time.
 *
 * That rename is the one contract change here. It is a rename rather than a
 * third key because two groups both rendering as "Staples", one curated at the
 * top and one holding the whole colour identity at the bottom, is worse for the
 * builder than either arrangement alone. The API validates no group key
 * (`schemas.ts` takes an array of plain strings), so a client asking for the
 * old key gets an empty selection rather than an error — see doc 10.
 */
export type CandidateGroupKey =
  | 'staple'
  | 'staple-land'
  | 'combo-3plus'
  | 'combo-2'
  | 'combo-1'
  | 'near-combo'
  | `fills-${string}`
  | `top-${string}`
  | 'high-synergy'
  | 'other'

/**
 * Why a card was suggested (pillar P4). Rendered verbatim at zoom L3.
 *
 * Structured rather than pre-rendered strings so the UI can localise, reorder and
 * link the pieces — and so a reason can be asserted in a test.
 */
export type Reason =
  | { readonly kind: 'completes-combos'; readonly combos: readonly ComboId[] }
  | { readonly kind: 'near-combo'; readonly combos: readonly ComboId[]; readonly distance: number }
  /**
   * How often the deck corpus plays this card with this commander.
   *
   * Named for the statistic, not its supplier: EDHREC is not queried (ADR-0008),
   * and the corpus is the project's own imported decks. `null` synergy means the
   * corpus is too small to say, which the UI must show as absence rather than as
   * zero.
   */
  | { readonly kind: 'corpus-inclusion'; readonly share: number; readonly synergy: number | null }
  | {
      readonly kind: 'fills-deficit'
      readonly dimension: CompositionDimension
      readonly deficit: number
      /**
       * Whose target this gap is measured against (doc 16).
       *
       * "Fills a ramp gap" and "fills the ramp target you set" are different
       * claims, and pillar P4 says a recommendation must make the one that is
       * true: a card suggested because the builder typed 14 ramp is being
       * suggested on the builder's own authority, not the archetype's, and a
       * reason that hides that is a reason the user cannot audit. Optional, so
       * a reader that predates doc 16 renders exactly what it did before
       * (AGENTS.md R2); absent reads as `archetype`.
       */
      readonly source?: TargetSource
    }
  /**
   * What this land taps for, relative to the deck's colours.
   *
   * A new member rather than a change to an existing one, so readers that do
   * not know it simply do not render it (AGENTS.md R2). It exists because
   * `fills-deficit` says "you need lands" for all 436 of them and cannot say
   * why THIS one — which for a land is the only interesting question.
   */
  | {
      readonly kind: 'mana-fixing'
      /** How many of the deck's colours it can reach. Zero means colourless only. */
      readonly coloursCovered: number
      /** The deck's colour count, so the reason reads "2 of 3". */
      readonly of: number
      /**
       * HOW it reaches them, so the sentence is true of the card (P4).
       *
       * Every cost-gated land rendered "taps for 5 of your 5 colours" and it is
       * false on all of them: Baldur's Gate taps for {C} and wants {2} and a
       * board of Gates, The Grey Havens reads colours off legendary creatures
       * in your GRAVEYARD, Mirrex works only on the turn it entered, and a
       * fetchland taps for nothing at all. The count alone cannot distinguish
       * them, so it cannot be trusted to phrase the claim.
       *
       * Optional, so a reader that predates it renders exactly what it rendered
       * before (AGENTS.md R2); absent reads as `taps`, which is what the old
       * sentence already assumed.
       */
      readonly reach?: FixingReach
    }
  | {
      readonly kind: 'curve-fit'
      readonly manaValue: number
      /** Optional, so this is not a contract break (AGENTS.md R2). */
      readonly direction?: 'short' | 'over' | 'balanced'
      /** Cards short at this mana value; negative means over-full. */
      readonly delta?: number
    }
  | { readonly kind: 'top-by-type'; readonly type: string; readonly rank: number }
  | {
      readonly kind: 'keyword-synergy'
      readonly tag: SynergyTag
      /** `enables` = provides what the deck wants; `payoff` = the reverse. */
      readonly direction: 'enables' | 'payoff' | 'theme'
      /** The cards it pairs with, so the reason is interrogable (pillar P4). */
      readonly withOracleIds: readonly OracleId[]
      /**
       * Whether this tag is one the builder EMPHASISED (`semantic-emphasis.ts`).
       *
       * Pillar P4 is why this exists rather than being left implicit. "Benefits
       * from your sacrifice fodder" and "benefits from your EMPHASISED sacrifice
       * fodder" are two different claims: the first says the deck happens to do
       * this, the second says the card rose because the builder asked for it,
       * and a card that moved up the list for the second reason must be able to
       * say so or the reason is not the reason.
       *
       * A new optional field on the existing member rather than a new member:
       * `tag`, `direction` and `withOracleIds` all mean exactly what they
       * already meant, and a second reason kind carrying the same three fields
       * would put the same relationship on screen twice. Optional, so a reader
       * that predates it renders the true-but-weaker sentence it renders today
       * rather than nothing at all (AGENTS.md R2).
       *
       * Absent and `false` are the same thing; only `true` is ever written.
       */
      readonly emphasised?: boolean
      /**
       * Whether this row is on the page only because of the focus guarantee
       * (ADR-0026): one of the top three supporters of the deck's emphasis in
       * this category, which the group's `limitPerGroup` cut would otherwise
       * have dropped.
       *
       * A SECOND CLAIM, not a restatement of `emphasised`. `emphasised: true`
       * says the card relates to a tag the builder picked, and is true of every
       * supporter in the list including the ones that outscored everything.
       * This says something the reader cannot otherwise work out: this card
       * scores below the cut and is being shown anyway, because a category that
       * showed the builder nothing about their own focus was the defect. Pillar
       * P4 asks the reason to name what put the card here, and for these rows
       * the honest answer is the guarantee rather than the score.
       *
       * It also has to be on the wire rather than inferred from position: the
       * client re-sorts group rows by column and merges the three `combo-N`
       * groups into one, so "last in the list" does not survive the trip, and
       * the merge's own density trim needs to know which rows it may not drop.
       *
       * On the existing member for the same reason `emphasised` is: the
       * relationship being described is the same one, and a second reason kind
       * carrying the same tag would put it on screen twice. Optional, so a
       * reader that predates it renders the emphasis sentence it renders today
       * (AGENTS.md R2). Only `true` is ever written.
       */
      readonly guaranteed?: boolean
    }
  | { readonly kind: 'bracket-warning'; readonly flag: BracketFlag; readonly detail: string }

/**
 * A recommendation. Never persisted as truth — always recomputed against the
 * current accepted set and dataset snapshot.
 *
 * `reasons` is a non-empty tuple by construction: a recommendation the user
 * cannot interrogate is a bug, and the type makes it unrepresentable (P4,
 * AGENTS.md §8).
 */
export interface Recommendation {
  readonly oracleId: OracleId
  readonly group: CandidateGroupKey
  /** Orders *within* a group only. There is no global ranking (P5). */
  readonly score: number
  readonly comboDegree: number
  readonly nearCombosAt1: number
  readonly completedCombos: readonly ComboId[]
  /** Both null whenever no corpus statistics exist — the normal case at launch
   * (ADR-0008). Recommendations stand on combos, roles and archetype instead. */
  readonly synergyScore: number | null
  readonly inclusionShare: number | null
  readonly fillsRoleDeficit: Role | null
  readonly bracketFlags: readonly BracketFlag[]
  readonly reasons: readonly [Reason, ...Reason[]]
  /**
   * How much this card does, and how much of it you get for the mana (doc 18).
   *
   * BESIDE `reasons`, NOT INSIDE IT, and the argument is pillar P4 rather than
   * convenience. A `Reason` answers "why was this card suggested to me, in this
   * deck, right now"; both of these are card-intrinsic and true of the card in
   * every deck that has ever existed, so as reasons they would be filler. Worse,
   * `reasons` is a non-empty tuple BY CONSTRUCTION and that type is the
   * guarantee behind "a recommendation the user cannot interrogate is a bug"
   * (AGENTS.md §8) — a reason every card qualifies for would satisfy the type
   * while hollowing out the guarantee, letting a card be suggested for no
   * deck-relative reason at all and still typecheck as explained. P4 also asks
   * for reasons a user can act on, and "this is a high-impact card" has no
   * setting behind it and nothing to change.
   *
   * Optional so adding them is additive (AGENTS.md R2). Absent means "this
   * build did not compute them", never "this card has none" — every card has
   * both, `cardImpact` and `cardEfficiency` are total.
   */
  readonly impact?: CardImpact
  readonly efficiency?: CardEfficiency
}
