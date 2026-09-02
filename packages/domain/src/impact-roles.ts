import type { Role } from './role.js'
import bands from './impact/by-role.data.json' with { type: 'json' }

/**
 * What impact looks like FOR EACH ROLE (doc 18 §18.12).
 *
 * THE PROBLEM THIS SOLVES. `impact` is a property of the card and is not
 * comparable across roles. Measured on the corpus: Sol Ring 0.68, Command Tower
 * 0.68, a basic Forest 0, Wrath of God 6.12, Craterhoof Behemoth 6.0. A
 * builder shown "6.12 of 18.48" with no other context reasonably concludes that
 * anything under 6 is a bad card — and that conclusion condemns their entire
 * mana base. The number is right; the missing half is *compared to what*.
 *
 * So: compared to the other cards that do the same job. A ramp card's 0.68 is
 * the median ramp card. A board wipe's 6.12 is the bottom of the middle half of
 * board wipes. Same number, opposite readings, and only the role tells them
 * apart.
 *
 * DESCRIPTIVE, NOT PRESCRIPTIVE, and that distinction is load-bearing.
 * doc 18 §18.9 declined to give the model bands, and `metrics.ts` rejected
 * letter grades because "every cutoff would be the renderer's opinion". Neither
 * decision is being overturned here. Nothing in this file says what a card
 * SHOULD score; it says what cards in that role DO score, sourced, with the
 * cutoffs printed beside any verdict drawn from them. The only cutoffs are the
 * corpus's own quartiles, so a reader who disagrees is disagreeing with a
 * measurement rather than with a taste.
 *
 * Rejected: computing this live. It needs all 31,782 commander-legal cards and
 * a sort per role, this package is PURE and has no database (AGENTS.md R1), and
 * the client has no corpus at all. Baked, regenerated, and dated — exactly the
 * arrangement `efficiency/baseline.data.json` already establishes for a number
 * that is measured rather than invented.
 */

export interface RoleImpactBand {
  /** Commander-legal cards holding this role. */
  readonly n: number
  readonly q1: number
  readonly median: number
  readonly q3: number
  /**
   * How many of them the model reads as naming nothing to affect
   * (`breadth: 'none'`).
   *
   * The blindness doc 18 §18.2 accepts rather than patches, counted per role.
   * 896 of 1,194 lands and 961 of 1,401 ramp cards land here; 0 of 3,273 spot
   * removal spells do. That ratio is the difference between "this card is low
   * for its role" and "this metric cannot see this kind of card", and a reader
   * cannot tell those apart from the band alone.
   */
  readonly noCountableEffect: number
}

/**
 * The measured bands this build ships with, keyed by role name.
 *
 * GENERATED from the corpus by `pnpm --filter @roundtable/ingest impact-roles`.
 * The file carries the date it was generated and the corpus size, so a reader
 * can check it rather than trust it.
 *
 * STALE AS SHIPPED, and knowingly (doc 18 §18.13). The reach-and-stakes audit
 * changed which tier 2,369 cards land in, and these quartiles are quartiles OF
 * THAT MODEL — so they describe the model as it was on 2026-08-31. Regenerating
 * needs a corpus database, which this change did not have, and the numbers
 * below are the file's own rather than a guess at what it will say.
 *
 * Measured, the drift is small: `q1` is unchanged for every one of the eighteen
 * roles the file holds and the largest single move is `board-wipe`'s median,
 * 7.2 to 6.12. No role crosses `roleImpactIsMostlyUnreadable`'s half-way line
 * in either direction, so no card's caveat changes.
 *
 * The more pressing reason to run it is unrelated to that pass: ADR-0037 added
 * `counterspell` and `bounce`, and this file has no band for either. That
 * degrades correctly — `roleImpactBand` returns `null` and the pane omits the
 * comparison line — but a counterspell currently gets no placement at all.
 *
 * Typed as a record over `string` rather than `Role`: the file is data, and a
 * regeneration against a corpus that never derived some role must read as an
 * absent key rather than fail to typecheck. `roleImpactBand` is where that
 * absence becomes `null`.
 */
export const IMPACT_ROLE_BANDS: Readonly<Record<string, RoleImpactBand>> = bands.roles

/** The date the shipped bands were measured, `YYYY-MM-DD`. */
export const IMPACT_ROLE_BANDS_GENERATED_AT: string = bands.generatedAt

/** Commander-legal cards the shipped bands were measured over. */
export const IMPACT_ROLE_BANDS_CORPUS: number = bands.corpus.commanderLegal

/** The band for a role, or `null` when the corpus measured no cards in it. */
export const roleImpactBand = (role: Role): RoleImpactBand | null => IMPACT_ROLE_BANDS[role] ?? null

/**
 * Where a score sits in its role's band.
 *
 * Named for the quartile it lands in rather than graded. "Bottom quarter of
 * ramp cards" is a description a reader can check against the two numbers
 * printed beside it; "D-" is a verdict they cannot.
 */
export type RoleImpactPlacement = 'bottom-quarter' | 'middle-half' | 'top-quarter'

/**
 * `score < q1` and `score > q3` — strict on both sides, so a card sitting
 * exactly ON a quartile is inside the middle half.
 *
 * Not an arbitrary tie-break. Quartiles land on real card scores constantly here
 * because the model produces a few dozen distinct values, not a continuum: Wrath
 * of God is exactly the board-wipe q1 and Sol Ring is exactly the ramp median.
 * Calling the format's archetypal wrath "bottom quarter" by a hair would be the
 * interface losing an argument it started.
 */
export const impactRolePlacement = (score: number, band: RoleImpactBand): RoleImpactPlacement => {
  if (score < band.q1) return 'bottom-quarter'
  if (score > band.q3) return 'top-quarter'
  return 'middle-half'
}

/**
 * Is this role one the model mostly cannot read?
 *
 * True when MORE THAN HALF the cards in it name nothing the model can count.
 * Not a tuned threshold — it is the point at which "most cards in this role"
 * becomes a true sentence, and the copy that depends on it says exactly that.
 * Below it the model has read the majority of the role and its band is a
 * measurement of those cards; above it the band is largely a measurement of
 * silence, which a reader must be told rather than left to infer from a low
 * number.
 *
 * Measured: land 896/1,194, ramp 961/1,401, tutor 169/224, aura 1,019/1,235 are
 * over the line; board wipes 70/502 and spot removal 0/3,273 are not.
 */
export const roleImpactIsMostlyUnreadable = (band: RoleImpactBand): boolean =>
  band.noCountableEffect * 2 > band.n
