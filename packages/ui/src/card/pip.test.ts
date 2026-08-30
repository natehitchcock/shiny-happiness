import { describe, expect, it, vi } from 'vitest'
import { drawPip, pipColor, pipSummary } from './pip.js'
import type { PipScale, PipTarget } from './pip.js'
import { IDENTITY_COLORS, RAMP } from './presentation.js'
import type { CardView } from './types.js'

const scale: PipScale = {
  maxManaValue: 8,
  maxComboDegree: 4,
  roleOrder: ['ramp', 'draw', 'removal', 'wincon'],
}

const card = (over: Partial<CardView> = {}): CardView => ({
  oracleId: 'o1',
  name: 'Test Card',
  ...over,
})

describe('pipColor', () => {
  it('uses the game colour for a colour-identity pip', () => {
    expect(pipColor(card({ colorIdentity: ['R'] }), 'colorIdentity', scale)).toBe(IDENTITY_COLORS.R)
    expect(pipColor(card({ colorIdentity: ['U', 'G'] }), 'colorIdentity', scale)).toBe(
      IDENTITY_COLORS.M,
    )
  })

  it('does not repaint a card when the pool it is in changes', () => {
    // Colour follows the entity, never its rank. `roleOrder` is a fixed list for
    // exactly this reason: an index into the *current* pool would give "removal"
    // a different colour the moment a filter removed every ramp card.
    const removal = card({ primaryRole: 'removal' })
    const filtered: PipScale = { ...scale, roleOrder: ['ramp', 'draw', 'removal', 'wincon'] }
    expect(pipColor(removal, 'role', filtered)).toBe(pipColor(removal, 'role', scale))
  })

  it('still colours a role it has never heard of', () => {
    // A pip that rendered nothing would be a card the user cannot see they own.
    const unknown = pipColor(card({ primaryRole: 'stax' }), 'role', scale)
    expect(RAMP).toContain(unknown)
  })

  it('treats a missing mana value as zero rather than throwing', () => {
    expect(pipColor(card(), 'manaValue', scale)).toBe(RAMP[0])
  })

  it('separates a high combo degree from a low one', () => {
    const low = pipColor(card({ comboDegree: 0 }), 'comboDegree', scale)
    const high = pipColor(card({ comboDegree: 4 }), 'comboDegree', scale)
    expect(low).not.toBe(high)
  })
})

const target = (): PipTarget & { calls: string[] } => {
  const calls: string[] = []
  return {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    beginPath: vi.fn(() => calls.push('beginPath')),
    arc: vi.fn((x: number, y: number, r: number) =>
      calls.push(`arc ${String(x)},${String(y)} r${String(r)}`),
    ),
    fill: vi.fn(() => calls.push('fill')),
    stroke: vi.fn(() => calls.push('stroke')),
  }
}

describe('drawPip', () => {
  it('draws a filled circle at the level-0 diameter by default', () => {
    const ctx = target()
    drawPip(ctx, { x: 10, y: 20, color: '#ff0000' })
    expect(ctx.calls).toEqual(['beginPath', 'arc 10,20 r4', 'fill'])
    expect(ctx.fillStyle).toBe('#ff0000')
  })

  it('rings an accepted card instead of recolouring it', () => {
    // "Is it mine" has to survive whichever encoding is selected, and all seven
    // categorical slots are already spent on colour identity.
    const ctx = target()
    drawPip(ctx, { x: 0, y: 0, color: '#ff0000', ringed: true })
    expect(ctx.calls).toContain('stroke')
    expect(ctx.fillStyle).toBe('#ff0000')
  })

  it('does not stroke an ordinary pip', () => {
    const ctx = target()
    drawPip(ctx, { x: 0, y: 0, color: '#ff0000' })
    expect(ctx.calls).not.toContain('stroke')
  })
})

describe('pipSummary — the parallel accessibility path', () => {
  const pool: CardView[] = [
    card({ oracleId: 'a', name: 'A', colorIdentity: ['R'] }),
    card({ oracleId: 'b', name: 'B', colorIdentity: ['R'] }),
    card({ oracleId: 'c', name: 'C', colorIdentity: [] }),
  ]

  it('answers the shape question, not the membership question', () => {
    // L0 exists to answer "is my curve top-heavy, where are the clusters". A
    // summary that listed 5,000 names would be the same problem in another
    // modality, so the names must NOT appear.
    const text = pipSummary('Ramp', pool, 'colorIdentity')
    expect(text).toContain('3 cards')
    expect(text).toContain('2 red')
    expect(text).toContain('1 colourless')
    expect(text).not.toContain('A')
  })

  it('orders buckets by size, so the shape leads', () => {
    const text = pipSummary('Ramp', pool, 'colorIdentity')
    expect(text.indexOf('2 red')).toBeLessThan(text.indexOf('1 colourless'))
  })

  it('says a group is empty rather than producing a dangling sentence', () => {
    expect(pipSummary('Ramp', [], 'colorIdentity')).toBe('Ramp: empty.')
  })

  it('describes combo degree in words, since the ramp is invisible in text', () => {
    const text = pipSummary(
      'Combos',
      [card({ comboDegree: 2 }), card({ oracleId: 'z', name: 'Z', comboDegree: 0 })],
      'comboDegree',
    )
    expect(text).toContain('1 in 2 combos')
    expect(text).toContain('1 in no combos')
  })

  it('says "combo" singular when there is exactly one', () => {
    const text = pipSummary('Combos', [card({ comboDegree: 1 })], 'comboDegree')
    // Screen-reader copy is read aloud; "1 cards, 1 in 1 combos" is the kind
    // of thing that only ever ships because nobody listened to it.
    expect(text).toBe('Combos: 1 card — 1 in 1 combo.')
  })
})
