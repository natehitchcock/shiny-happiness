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
 * SEED VALUES. Established deckbuilding heuristics, to be REPLACED by percentiles
 * derived from EDHREC averages and our own corpus once DATA-03 and ING-05 land.
 * They are a starting point, not a claim of optimality, and the UI presents them
 * as a range with an ideal marked rather than as a number to hit.
 */

type Ideals = Partial<Record<Role, number>> & { readonly creature?: number }

const IDEALS: Record<ArchetypeKey, Ideals> = {
  aggro: { land: 34, ramp: 9, draw: 8, 'spot-removal': 7, 'board-wipe': 1, tutor: 2, protection: 4, creature: 32 },
  midrange: { land: 36, ramp: 11, draw: 9, 'spot-removal': 8, 'board-wipe': 3, tutor: 3, protection: 4, creature: 26 },
  control: { land: 37, ramp: 11, draw: 12, 'spot-removal': 12, 'board-wipe': 5, tutor: 3, protection: 5, creature: 14 },
  combo: { land: 34, ramp: 13, draw: 10, 'spot-removal': 6, 'board-wipe': 1, tutor: 8, protection: 7, creature: 20 },
  ramp: { land: 38, ramp: 17, draw: 9, 'spot-removal': 6, 'board-wipe': 3, tutor: 3, protection: 4, creature: 22 },
  aristocrats: {
    land: 35, ramp: 10, draw: 9, 'spot-removal': 7, 'board-wipe': 2, tutor: 4, protection: 4, creature: 30,
    'sac-outlet': 5, recursion: 7,
  },
  voltron: {
    land: 36, ramp: 10, draw: 8, 'spot-removal': 8, 'board-wipe': 2, tutor: 5, protection: 10, creature: 12,
    equipment: 8, aura: 4, evasion: 6,
  },
  tokens: {
    land: 35, ramp: 10, draw: 9, 'spot-removal': 7, 'board-wipe': 2, tutor: 3, protection: 5, creature: 24,
    'token-maker': 14, anthem: 6,
  },
  stax: {
    land: 35, ramp: 12, draw: 8, 'spot-removal': 8, 'board-wipe': 3, tutor: 5, protection: 5, creature: 16,
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

const dimensionsOf = (ideals: Ideals): Map<string, { dim: CompositionDimension; ideal: number }> => {
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
    for (const [key, entry] of primary) {
      if (!other.has(key)) primary.set(key, { ...entry, ideal: Math.round(entry.ideal) })
    }
  }

  const targets = new Map([...primary].map(([k, v]) => [k, v.ideal]))

  // ---- Curve modifier (doc 05 §5.4) ----
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
export const assessArchetype = (
  counts: ReadonlyMap<string, number>,
): ArchetypeAssessment => {
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
