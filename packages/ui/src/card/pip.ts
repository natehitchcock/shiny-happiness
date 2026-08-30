/**
 * L0 — the pip. The one representation that is not a DOM node.
 *
 * 5,000 elements is not a viable DOM (doc 07 §7.3), so a pip is a mark drawn
 * imperatively. That makes the *primitive* here a colour rule plus a draw call,
 * and it makes the accessibility path a separate, equal output rather than an
 * afterthought: `pipSummary` is what a screen reader gets where a sighted user
 * gets the constellation, and it has to answer the same question.
 *
 * `drawPip` takes a structural subset of `CanvasRenderingContext2D` rather than
 * the real thing, so the drawing is testable against a recording double without
 * pulling in a native canvas.
 */

import { IDENTITY_COLORS, identityKey, levelSpec, rampStep } from './presentation.js'
import type { PipEncoding } from './presentation.js'
import type { CardView } from './types.js'

/** The scale each non-categorical encoding is read against. */
export interface PipScale {
  /** Highest mana value in the pool; the ramp's top step. */
  readonly maxManaValue: number
  /** Highest combo degree in the pool. */
  readonly maxComboDegree: number
  /** Roles in a fixed order, so a role's colour does not move when the pool does. */
  readonly roleOrder: readonly string[]
}

/**
 * Pillar-adjacent rule, and the reason `roleOrder` is a parameter: colour
 * follows the entity, never its rank. Filtering the pool down must not repaint
 * the survivors, which is exactly what an index-into-the-current-list would do.
 */
export const pipColor = (card: CardView, encoding: PipEncoding, scale: PipScale): string => {
  switch (encoding) {
    case 'colorIdentity':
      return IDENTITY_COLORS[identityKey(card.colorIdentity ?? [])] ?? IDENTITY_COLORS.C!
    case 'manaValue':
      return rampStep(card.manaValue ?? 0, scale.maxManaValue)
    case 'comboDegree':
      return rampStep(card.comboDegree ?? 0, scale.maxComboDegree)
    case 'role': {
      const index = scale.roleOrder.indexOf(card.primaryRole ?? '')
      // An unknown role is drawn at the bottom of the ramp rather than skipped.
      // A pip that renders nothing is a card the user cannot see they own.
      return index < 0 ? rampStep(0, 1) : rampStep(index, Math.max(1, scale.roleOrder.length - 1))
    }
  }
}

/** The subset of the 2D context a pip needs. */
export interface PipTarget {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  beginPath: () => void
  arc: (x: number, y: number, r: number, start: number, end: number) => void
  fill: () => void
  stroke: () => void
}

export interface PipDraw {
  readonly x: number
  readonly y: number
  readonly color: string
  /** Diameter. Defaults to the L0 spec width. */
  readonly size?: number
  /** In the deck / accepted. Drawn with a ring, not a different hue. */
  readonly ringed?: boolean
}

export const drawPip = (ctx: PipTarget, pip: PipDraw): void => {
  const size = pip.size ?? levelSpec(0).width
  const radius = size / 2
  ctx.beginPath()
  ctx.arc(pip.x, pip.y, radius, 0, Math.PI * 2)
  ctx.fillStyle = pip.color
  ctx.fill()
  if (pip.ringed === true) {
    // A ring rather than a second hue: the pool is already spending all seven
    // categorical slots on colour identity, and "is it mine" has to survive
    // whichever encoding is selected.
    ctx.strokeStyle = '#ede6d8'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
}

/**
 * The text a screen reader gets instead of the canvas.
 *
 * Not a list of 5,000 names — that is not a summary, it is the same problem in
 * another modality. L0 answers shape questions, so this answers shape questions:
 * how many, and how they are distributed along whatever is currently encoded.
 */
export const pipSummary = (
  groupLabel: string,
  cards: readonly CardView[],
  encoding: PipEncoding,
): string => {
  if (cards.length === 0) return `${groupLabel}: empty.`
  const counts = new Map<string, number>()
  for (const card of cards) {
    const key = bucketOf(card, encoding)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([key, n]) => `${String(n)} ${key}`)
  const noun = cards.length === 1 ? 'card' : 'cards'
  return `${groupLabel}: ${String(cards.length)} ${noun} — ${parts.join(', ')}.`
}

const IDENTITY_WORDS: Readonly<Record<string, string>> = {
  W: 'white',
  U: 'blue',
  B: 'black',
  R: 'red',
  G: 'green',
  M: 'multicolour',
  C: 'colourless',
}

const bucketOf = (card: CardView, encoding: PipEncoding): string => {
  switch (encoding) {
    case 'colorIdentity':
      return IDENTITY_WORDS[identityKey(card.colorIdentity ?? [])] ?? 'colourless'
    case 'manaValue':
      return `at mana value ${String(card.manaValue ?? 0)}`
    case 'comboDegree': {
      const degree = card.comboDegree ?? 0
      if (degree === 0) return 'in no combos'
      return `in ${String(degree)} combo${degree === 1 ? '' : 's'}`
    }
    case 'role':
      return card.primaryRole ?? 'unclassified'
  }
}
