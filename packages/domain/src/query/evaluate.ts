import type { Card, Color } from '../card.js'
import type { BracketFlag } from '../bracket.js'
import type { OracleId } from '../ids.js'
import type { Role } from '../role.js'
import { assertNever } from '../assert-never.js'
import { normaliseTag, type ComparisonOp, type QueryNode } from './ast.js'

/**
 * Evaluating a query against an annotated candidate (doc 13 §13.3).
 *
 * A pure predicate over a card that has ALREADY been annotated, which is why
 * `combo>=2` needs no special casing here — the degree is just another field.
 */

export interface AnnotatedCandidate {
  readonly card: Card
  readonly comboDegree: number
  readonly nearCombosAt1: number
  readonly roles: readonly Role[]
  readonly bracketFlags: readonly BracketFlag[]
  readonly priceUsd: number | null
  readonly rarity: string | null
  readonly setCode: string | null
  readonly power: number | null
  readonly toughness: number | null
  readonly reserved: boolean
  readonly group: string | null
  /**
   * `cardImpact(card).score` — the number, not the breakdown.
   *
   * ANNOTATED, NOT COMPUTED HERE, and that is a rule rather than a preference.
   * `cardImpact` is a text classifier over the oracle text; running it inside
   * the predicate would run it once per card PER TERM, and it would put a
   * classifier inside a function whose whole contract is that the annotation
   * already happened. The caller computes it once and hands it over, exactly as
   * it does for `comboDegree`.
   *
   * It is the SAME NUMBER the client draws — `Recommendation.impact.score` —
   * carried across unrounded and unrescaled. Both scores arrive already
   * quantised to three decimals by `impact.ts` and `efficiency.ts`, so the
   * value here and the value on the wire are bit-identical and a row can never
   * contradict its own cell. Rejected: re-rounding to a display precision, both
   * because no renderer has picked one yet and because choosing here would bake
   * in a disagreement the moment a renderer chose differently. Whoever builds
   * the metric column must draw `score` itself; if it ever rounds for display,
   * that rounding belongs in `impact.ts` where BOTH sides read it.
   */
  readonly impact: number
  /** `cardEfficiency(card).score`. Same rule, same reasoning, smaller scale. */
  readonly efficiency: number
}

const RARITY_ORDER: Readonly<Record<string, number>> = {
  common: 0,
  uncommon: 1,
  rare: 2,
  mythic: 3,
  special: 4,
  bonus: 5,
}

const compareNumbers = (actual: number, op: ComparisonOp, expected: number): boolean => {
  switch (op) {
    case ':':
    case '=':
      return actual === expected
    case '!=':
      return actual !== expected
    case '<':
      return actual < expected
    case '<=':
      return actual <= expected
    case '>':
      return actual > expected
    case '>=':
      return actual >= expected
  }
}

const compareColors = (actual: readonly Color[], op: ComparisonOp, value: string): boolean => {
  const lower = value.toLowerCase()
  if (lower === 'colorless' || lower === 'colourless') return actual.length === 0
  if (lower === 'multicolor' || lower === 'multicolour') return actual.length > 1
  const wanted = new Set(
    lower
      .replace(/c/g, '')
      .toUpperCase()
      .split('')
      .filter((c): c is Color => 'WUBRG'.includes(c)),
  )
  const have = new Set(actual)
  const subset = [...wanted].every((c) => have.has(c))
  const superset = [...have].every((c) => wanted.has(c))
  switch (op) {
    case ':':
    case '>=':
      return subset // "contains at least these"
    case '=':
      return subset && superset
    case '!=':
      return !(subset && superset)
    case '<=':
      return superset // "no colours beyond these"
    case '<':
      return superset && have.size < wanted.size
    case '>':
      return subset && have.size > wanted.size
  }
}

const contains = (haystack: string, needle: string): boolean =>
  haystack.toLowerCase().includes(needle.toLowerCase())

const evaluateIs = (candidate: AnnotatedCandidate, predicate: string): boolean => {
  const { card } = candidate
  switch (predicate.toLowerCase()) {
    case 'permanent':
      return card.types.some((t) =>
        ['creature', 'artifact', 'enchantment', 'planeswalker', 'land', 'battle'].includes(t),
      )
    case 'spell':
      return !card.types.includes('land')
    case 'creature':
      return card.types.includes('creature')
    case 'commander':
      // `=== true`, so a card whose eligibility was never derived does not match
      // — the same direction `is:gamechanger` takes. The alternative, treating
      // "not known" as "yes", would put Sol Ring back in the commander picker.
      return card.canBeCommander === true
    case 'land':
      return card.types.includes('land')
    case 'vanilla':
      return card.oracleText.trim() === ''
    case 'reserved':
      return candidate.reserved
    case 'gamechanger':
      return candidate.bracketFlags.includes('game-changer')
    case 'modal':
    case 'dfc':
      return card.typeLine.includes('//') || card.name.includes('//')
    case 'split':
      return card.name.includes('//')
    case 'adventure':
      return card.typeLine.includes('Adventure')
    case 'reprint':
    case 'firstprint':
      // Printing-level; not decidable from oracle identity alone. Never matches
      // rather than silently matching everything.
      return false
    default:
      return false
  }
}

const evaluateTerm = (
  candidate: AnnotatedCandidate,
  node: Extract<QueryNode, { kind: 'term' }>,
): boolean => {
  const { card } = candidate
  const { field, op, value } = node

  switch (field) {
    case 'name':
      return contains(card.name, value)
    case 'type':
      return contains(card.typeLine, value)
    case 'oracle':
      return contains(card.oracleText, value)
    case 'keyword':
      return card.keywords.some((k) => k.toLowerCase() === value.toLowerCase())
    case 'color':
      return compareColors(card.colors, op, value)
    case 'identity':
      return compareColors(card.colorIdentity, op, value)
    case 'manaValue':
      return compareNumbers(card.manaValue, op, Number(value))
    case 'power':
      return candidate.power !== null && compareNumbers(candidate.power, op, Number(value))
    case 'toughness':
      return candidate.toughness !== null && compareNumbers(candidate.toughness, op, Number(value))
    case 'price':
      return candidate.priceUsd !== null && compareNumbers(candidate.priceUsd, op, Number(value))
    case 'combo':
      return compareNumbers(candidate.comboDegree, op, Number(value))
    case 'near':
      return compareNumbers(candidate.nearCombosAt1, op, Number(value))
    /*
     * The two card-intrinsic metrics (doc 18). Unlike `price`, `power` and
     * `toughness` these are never null — `cardImpact` and `cardEfficiency` are
     * total, and a card with no rules text scores a real 0 rather than an
     * absent one — so there is no "no data" branch to get wrong and `impact=0`
     * is an answerable question about vanilla creatures.
     */
    case 'impact':
      return compareNumbers(candidate.impact, op, Number(value))
    case 'efficiency':
      return compareNumbers(candidate.efficiency, op, Number(value))
    case 'role':
      return candidate.roles.some((r) => r === value.toLowerCase())
    case 'flag':
      return candidate.bracketFlags.some((f) => f === value.toLowerCase())
    case 'group':
      return candidate.group !== null && candidate.group.toLowerCase() === value.toLowerCase()
    case 'set':
      return candidate.setCode !== null && candidate.setCode.toLowerCase() === value.toLowerCase()
    case 'rarity': {
      if (candidate.rarity === null) return false
      const actual = RARITY_ORDER[candidate.rarity.toLowerCase()]
      const expected = RARITY_ORDER[value.toLowerCase()]
      if (actual === undefined || expected === undefined) return false
      return compareNumbers(actual, op, expected)
    }
    /*
     * The mechanical synergy tags, which are on the card already.
     *
     * `produces` and `wants` are the two halves the UI draws as steel and brass
     * chips; `tag` asks the question without caring which side, which is what
     * someone typing the name of an effect usually means.
     */
    case 'produces':
      return candidate.card.synergyProduces.some((t) => t === normaliseTag(value))
    case 'wants':
      return candidate.card.synergyWants.some((t) => t === normaliseTag(value))
    case 'tag': {
      const tag = normaliseTag(value)
      return (
        candidate.card.synergyProduces.some((t) => t === tag) ||
        candidate.card.synergyWants.some((t) => t === tag)
      )
    }
    case 'is':
      return evaluateIs(candidate, value)
  }
}

export const matchesQuery = (node: QueryNode | null, candidate: AnnotatedCandidate): boolean => {
  if (node === null) return true
  switch (node.kind) {
    case 'term':
      return evaluateTerm(candidate, node)
    case 'not':
      return !matchesQuery(node.child, candidate)
    case 'and':
      return node.children.every((child) => matchesQuery(child, candidate))
    case 'or':
      return node.children.some((child) => matchesQuery(child, candidate))
    default:
      return assertNever(node, 'matchesQuery')
  }
}

/** Oracle ids a query keeps, preserving input order. */
export const filterCandidates = (
  node: QueryNode | null,
  candidates: readonly AnnotatedCandidate[],
): readonly OracleId[] =>
  candidates.filter((c) => matchesQuery(node, c)).map((c) => c.card.oracleId)
