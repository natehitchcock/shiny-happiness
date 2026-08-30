import type { ArchetypeKey } from './archetype.js'
import type { Bracket } from './bracket.js'
import type { CardType } from './card.js'
import {
  dimensionKey,
  roleDimension,
  typeDimension,
  type CompositionDimension,
  type CompositionTarget,
} from './composition.js'
import type { Role } from './role.js'

/**
 * Archetype target vectors (doc 14 §14.2, DOM-09).
 *
 * Established deckbuilding heuristics. These are the SOURCE OF TRUTH, not a
 * placeholder: EDHREC is not queried (ADR-0008), so there are no third-party
 * averages to replace them with, and there will not be. That is why every row
 * below carries its reasoning — a reader has to be able to tell which numbers
 * were argued for and which were typed to fill the line.
 *
 * They are not a claim of optimality, and the UI presents them as a range with an
 * ideal marked rather than as a number to hit. Doc 16 scopes letting a builder
 * override them per deck; until that ships these presets are the only answer the
 * app has, which raises rather than lowers the bar on justifying them.
 *
 * THREE CONSTRAINTS BIND EVERY ROW.
 *
 * 1. ROLE COUNTS DO NOT OVERLAP. Counting uses `primaryRole`, so each card lands
 *    in exactly one role dimension. `land + Σ roles` is therefore a real budget
 *    against 99, and the remainder is the deck's unroled threats and payoffs. A
 *    row that spends 97 of 99 is not "ambitious", it is arithmetically
 *    impossible to build — and it also makes the archetype unreachable by
 *    `assessArchetype`, since no deck can sit near a vector no deck can be.
 *    Voltron was that row.
 *
 * 2. THE BRACKET MODIFIER ADDS UP TO 4 CARDS ON TOP. Bracket 5 adds +2 draw and
 *    +2 removal, so a row needs at least that much headroom before it is
 *    over-subscribed at the bracket its archetype most often plays at.
 *
 * 3. LANDS ARE THE NEUTRAL-CURVE NUMBER, NOT THE ARCHETYPE'S OWN. The curve
 *    modifier below subtracts a land under 2.8 average mana value and adds one
 *    over 3.5. If the base already priced in the archetype's own cheap curve,
 *    that would be the same correction applied twice. So the base here is the
 *    count for a deck of this archetype sitting at a NEUTRAL curve, and the
 *    archetype's own shape in `curve.ts` then moves it. Two rows are built
 *    knowing they will move: aggro (own curve ~2.7) settles at 34, control (own
 *    curve ~3.8) settles at 37. Both are one lower and one higher than the base
 *    reads, and both were previously getting the shift on top of a base that had
 *    already been shifted.
 *
 * The other useful cross-check is `land + ramp` — the deck's mana sources. Most
 * archetypes sit between 43 and 48, and where a row leaves that range it should
 * be because the archetype trades one for the other, not because both were
 * raised.
 */

type Ideals = Partial<Record<Role, number>> & { readonly creature?: number }

const IDEALS: Record<ArchetypeKey, Ideals> = {
  /**
   * 66 of 99 spent, 43 mana sources. Fewest lands and fewest sources of any
   * archetype, which is correct twice over: the curve is the cheapest here so
   * fewer lands cast it, and flooding is worse for aggro than for anyone else
   * because there is nothing expensive to spend the surplus on. The 33 unroled
   * slots are the threats, which is the largest threat count in the table and
   * the point of the deck. One board wipe, because a deck that commits the board
   * hardest is the deck a wipe hurts most.
   *
   * Land 35 rather than 34: this is the neutral-curve number, and the aggro
   * curve takes it to 34.
   */
  aggro: {
    land: 35,
    ramp: 9,
    draw: 8,
    'spot-removal': 7,
    'board-wipe': 1,
    tutor: 2,
    protection: 4,
    creature: 32,
  },
  /**
   * The base row, reproduced in doc 05 §5.4 because the bracket and curve
   * modifiers are documented against it. 74 of 99, 47 sources, and every number
   * sits at the median of its column — which is what "midrange" means and why
   * it is the least-wrong default (doc 14 §14.3). Left unchanged: it is the
   * reference every other row is stated relative to, and moving the reference
   * moves nine rows at once.
   */
  midrange: {
    land: 36,
    ramp: 11,
    draw: 9,
    'spot-removal': 8,
    'board-wipe': 3,
    tutor: 3,
    protection: 4,
    creature: 26,
  },
  /**
   * 84 of 99 — the roles ARE the deck, which is why only 15 slots are left for
   * anything else and why the creature count is the lowest but one. Draw and
   * removal at 12 each, and 5 wipes, because control answers threats it did not
   * choose and must therefore hold more answers than there are problems it
   * expects. 47 sources.
   *
   * Land 36 rather than 37: neutral-curve number, and the control curve (~3.8)
   * takes it to 37. It was previously settling at 38, which with 11 ramp is more
   * mana than a deck holding 15 non-role cards can use.
   */
  control: {
    land: 36,
    ramp: 11,
    draw: 12,
    'spot-removal': 12,
    'board-wipe': 5,
    tutor: 3,
    protection: 5,
    creature: 14,
  },
  /**
   * Trades lands for rocks: fewest lands of any row but 13 ramp, for 47 sources
   * — the same total as midrange, reached differently, because a rock is also a
   * combo piece and a land is not. 8 tutors is the largest number in the table
   * and is the archetype's actual definition: a combo deck is a deck that can
   * find its combo. 7 protection follows from it — assembling a two-card win and
   * then losing to one removal spell is the failure mode, so the protection
   * count tracks the tutor count rather than the threat count.
   */
  combo: {
    land: 34,
    ramp: 13,
    draw: 10,
    'spot-removal': 6,
    'board-wipe': 1,
    tutor: 8,
    protection: 7,
    creature: 20,
  },
  /**
   * The most ramp, which is the archetype's identity — but 15 rather than 17,
   * and 37 lands rather than 38. Ramp's identity is the most RAMP, not the most
   * mana sources; at 38+17 the row asked for 55 of 99 cards to produce mana,
   * leaving 19 slots for the payoffs that are the entire reason to produce it. A
   * deck that ramps into nothing has not built a ramp deck. 52 sources still
   * leads the table comfortably.
   */
  ramp: {
    land: 37,
    ramp: 15,
    draw: 9,
    'spot-removal': 6,
    'board-wipe': 3,
    tutor: 3,
    protection: 4,
    creature: 22,
  },
  /**
   * 84 of 99. `sac-outlet` 5 rather than more because outlets are redundant with
   * each other — the second one is insurance, the fifth is a dead draw — while
   * `recursion` 7 is not, since each rebuy is another loop of the engine.
   *
   * 3 board wipes, up from 2, and the only row where a wipe is raised: a
   * symmetric wipe is asymmetric in an aristocrats deck's favour, because its
   * creatures dying is the payoff rather than the cost. It is the one archetype
   * for which that is true, so it is the one row that should say so.
   */
  aristocrats: {
    land: 35,
    ramp: 10,
    draw: 9,
    'spot-removal': 7,
    'board-wipe': 3,
    tutor: 4,
    protection: 4,
    creature: 30,
    'sac-outlet': 5,
    recursion: 7,
  },
  /**
   * Was the broken row: 97 of 99, leaving two slots and going over 99 outright
   * at bracket 4 or 5. It had been written as though roles overlapped, and they
   * do not.
   *
   * `evasion` 6 → 3 is most of the fix. Evasion sits below equipment, aura,
   * anthem and protection in `ROLE_PRECEDENCE`, so nearly every evasion-granting
   * card in a real voltron deck is counted somewhere else — Whispersilk Cloak is
   * protection, Rogue's Passage is a land. A target of 6 was asking for six
   * cards whose ONLY role is evasion, and the corpus does not hold many.
   *
   * `protection` 10 → 7 and `equipment` 8 → 7 for the same reason: Swiftfoot
   * Boots and Lightning Greaves count as protection, not equipment, so the two
   * columns draw from one physical pool. 14 gear-and-guard cards is what the
   * deck plays; 18 was the same cards counted twice. 5 tutors stays — a voltron
   * deck tutors for a specific sword, which is closer to combo than to midrange.
   */
  voltron: {
    land: 36,
    ramp: 10,
    draw: 8,
    'spot-removal': 8,
    'board-wipe': 2,
    tutor: 5,
    protection: 7,
    creature: 12,
    equipment: 7,
    aura: 3,
    evasion: 3,
  },
  /**
   * The fullest row after voltron, because a go-wide deck's board IS its spell
   * count. 14 token-makers is the floor for that plan and is not reduced. The
   * headroom came from three cheaper places: `anthem` 6 → 5, since five anthems
   * is more than a board needs to be lethal; `protection` 5 → 4, since what a
   * tokens deck wants is two or three wipe-proofing cards rather than five; and
   * `draw` 9 → 8, because a go-wide deck's card advantage is the board — every
   * token is a card the opponent has to answer — so it sits with aggro and
   * voltron on that axis rather than with midrange.
   */
  tokens: {
    land: 35,
    ramp: 10,
    draw: 8,
    'spot-removal': 7,
    'board-wipe': 2,
    tutor: 3,
    protection: 4,
    creature: 24,
    'token-maker': 14,
    anthem: 5,
  },
  /**
   * 88 of 99, and 47 sources with 12 ramp — the highest ramp outside ramp and
   * combo, deliberately, because stax only works if the deck breaking parity is
   * the one that set the parity. A prison piece that taxes you as much as the
   * table is a piece you should not be playing.
   *
   * 12 stax pieces because a lock is cumulative: no single piece stops a
   * Commander table, and the archetype needs enough of them to draw two or three
   * early.
   *
   * 8 draw is the least defensible number in this table and is left where it
   * was. A deck that wins slowly under a lock needs card advantage, which argues
   * up; but a stax deck's advantage is usually the lock itself denying everyone
   * else, which argues down. Both readings are honest and nothing here settles
   * between them, so the seed value stands rather than being moved on a coin
   * flip.
   */
  stax: {
    land: 35,
    ramp: 12,
    draw: 8,
    'spot-removal': 8,
    'board-wipe': 3,
    tutor: 5,
    protection: 5,
    creature: 16,
    stax: 12,
  },
}

/**
 * Half-width of the acceptable band around an ideal. A deck at 34 lands is not
 * broken and the UI must not say it is, so every target is a range.
 */
const band = (dimension: CompositionDimension, ideal: number): number => {
  if (dimension.kind === 'type') return 6 // creature counts vary far more than role counts
  if (dimension.role === 'land') return 3
  return ideal <= 6 ? 2 : 3
}

const toTarget = (dimension: CompositionDimension, ideal: number): CompositionTarget => {
  const width = band(dimension, ideal)
  return {
    dimension,
    ideal,
    min: Math.max(0, ideal - width),
    max: ideal + width,
  }
}

const dimensionsOf = (
  ideals: Ideals,
): Map<string, { dim: CompositionDimension; ideal: number }> => {
  const out = new Map<string, { dim: CompositionDimension; ideal: number }>()
  for (const [key, value] of Object.entries(ideals)) {
    if (value === undefined) continue
    const dim: CompositionDimension =
      key === 'creature' ? typeDimension('creature' as CardType) : roleDimension(key as Role)
    out.set(dimensionKey(dim), { dim, ideal: value })
  }
  return out
}

export interface TargetOptions {
  readonly bracket: Bracket
  /** The deck's current average mana value, for the curve modifier. */
  readonly averageManaValue?: number
  /** Cards whose back face is a land — each ~2 of them is worth about one land. */
  readonly modalLandBacks?: number
}

/**
 * Targets for a deck.
 *
 * Primary archetype supplies the base vector; a secondary blends 70/30 toward the
 * primary and rounds to whole cards, because you cannot play 10.7 ramp spells.
 * Bracket and curve modifiers apply on top — they are orthogonal to archetype
 * (doc 14 §14.2).
 */
export const compositionTargets = (
  archetype: ArchetypeKey,
  secondary: ArchetypeKey | null,
  options: TargetOptions,
): readonly CompositionTarget[] => {
  const primary = dimensionsOf(IDEALS[archetype])

  if (secondary !== null && secondary !== archetype) {
    const other = dimensionsOf(IDEALS[secondary])
    for (const [key, { dim, ideal }] of other) {
      const base = primary.get(key)
      // A dimension only the secondary names still counts, at its 30% weight.
      const blended = base === undefined ? ideal * 0.3 : base.ideal * 0.7 + ideal * 0.3
      primary.set(key, { dim, ideal: Math.round(blended) })
    }
    // A dimension only the PRIMARY names keeps its full weight. That is the
    // documented 70/30 rule (doc 14 §14.1) read literally, and it means a
    // hybrid's role budget can only grow: the primary's specialist roles stay
    // whole and the secondary's arrive on top. Two role-dense archetypes
    // therefore blend to the fullest vector in the table, which is why the tests
    // assert the 99-card budget over every ordered pair and not only over the
    // nine pure rows.
    for (const [key, entry] of primary) {
      if (!other.has(key)) primary.set(key, { ...entry, ideal: Math.round(entry.ideal) })
    }
  }

  const targets = new Map([...primary].map(([k, v]) => [k, v.ideal]))

  // ---- Curve modifier (doc 05 §5.4) ----
  // Reads the deck's ACTUAL average mana value, not the archetype's target one,
  // which is what makes it orthogonal to the row above: the row is the count at a
  // neutral curve and this corrects for how far the built deck sits from neutral.
  // The base land numbers are chosen on that reading — see the note on IDEALS —
  // so an archetype whose own curve is cheap is shifted once, here, and not
  // again in the table.
  const landKey = dimensionKey(roleDimension('land'))
  const mv = options.averageManaValue
  const lands = targets.get(landKey)
  if (lands !== undefined) {
    let adjusted = lands
    if (mv !== undefined) {
      if (mv < 2.8) adjusted -= 1
      else if (mv > 3.5) adjusted += 1
    }
    // Each ~2 modal double-faced land-backs is worth about one land slot.
    adjusted -= Math.floor((options.modalLandBacks ?? 0) / 2)
    targets.set(landKey, Math.max(0, adjusted))
  }

  // ---- Bracket modifier (doc 05 §5.4) ----
  const bump = (key: string, delta: number) => {
    const current = targets.get(key)
    if (current !== undefined) targets.set(key, Math.max(0, current + delta))
  }
  if (options.bracket >= 4) {
    const delta = options.bracket === 5 ? 2 : 1
    bump(dimensionKey(roleDimension('draw')), delta)
    bump(dimensionKey(roleDimension('spot-removal')), delta)
  } else if (options.bracket === 1) {
    bump(dimensionKey(roleDimension('draw')), -1)
    bump(dimensionKey(roleDimension('spot-removal')), -1)
  }

  return [...primary].map(([key, { dim }]) => toTarget(dim, targets.get(key) ?? 0))
}

// ---------------------------------------------------------------------------
// Assessment (doc 14 §14.5)
// ---------------------------------------------------------------------------

export interface ArchetypeAssessment {
  readonly assessed: ArchetypeKey
  readonly confidence: number
  readonly distances: Readonly<Record<ArchetypeKey, number>>
  /** The dimensions that most drove the verdict — shown to explain it. */
  readonly drivers: readonly CompositionDimension[]
}

/**
 * What the deck actually looks like, regardless of what it was declared as.
 *
 * Nearest archetype by normalised Euclidean distance over the shared dimensions.
 * Deterministic and explainable: the user can be shown which dimensions decided
 * it. Reported as information — never auto-applied. The user's stated plan is the
 * plan, and a tool that silently rewrites your intent is one you stop trusting.
 */
export const assessArchetype = (counts: ReadonlyMap<string, number>): ArchetypeAssessment => {
  const distances = {} as Record<ArchetypeKey, number>
  let best: ArchetypeKey = 'midrange'
  let bestDistance = Number.POSITIVE_INFINITY
  let bestDrivers: CompositionDimension[] = []

  for (const key of Object.keys(IDEALS) as ArchetypeKey[]) {
    const ideals = dimensionsOf(IDEALS[key])
    let sum = 0
    let n = 0
    const contributions: { dim: CompositionDimension; weight: number }[] = []

    for (const [dimKey, { dim, ideal }] of ideals) {
      const actual = counts.get(dimKey) ?? 0
      // Normalise by the ideal so a 4-card miss on board wipes weighs like a
      // 4-card miss on lands would not.
      const scale = Math.max(ideal, 1)
      const delta = (actual - ideal) / scale
      sum += delta * delta
      n += 1
      contributions.push({ dim, weight: delta * delta })
    }

    const distance = n === 0 ? Number.POSITIVE_INFINITY : Math.sqrt(sum / n)
    distances[key] = distance
    if (distance < bestDistance) {
      bestDistance = distance
      best = key
      bestDrivers = contributions
        .sort((a, b) => b.weight - a.weight)
        .slice(0, 3)
        .map((c) => c.dim)
    }
  }

  // Confidence is the margin over the runner-up: a deck sitting between two
  // archetypes should not be reported as confidently either.
  const ordered = Object.values(distances).sort((a, b) => a - b)
  const runnerUp = ordered[1] ?? bestDistance
  const confidence =
    runnerUp === 0 ? 0 : Math.max(0, Math.min(1, (runnerUp - bestDistance) / runnerUp))

  return { assessed: best, confidence, distances, drivers: bestDrivers }
}
