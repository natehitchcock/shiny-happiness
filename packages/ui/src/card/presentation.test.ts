import { describe, expect, it } from 'vitest'
import {
  ART_CROP_ASPECT,
  CARD_ASPECT,
  HIT_GAP_MIN,
  HIT_TARGET_MIN,
  IDENTITY_COLORS,
  LEVELS,
  RAMP,
  hitPadding,
  identityKey,
  imageFor,
  levelSpec,
  rampStep,
} from './presentation.js'
import type { CardView } from './types.js'
import { contrast } from '../tokens.js'

/** The DoD for UI-01: "each meets its size ... requirements". */
describe('the size budget', () => {
  it('keeps every level inside its own band', () => {
    for (const level of LEVELS) {
      expect(level.width).toBeGreaterThanOrEqual(level.minWidth)
      expect(level.width).toBeLessThanOrEqual(level.maxWidth)
    }
  })

  it('holds L0 to the 6–10 px pip doc 07 §7.1 specifies', () => {
    const pip = levelSpec(0)
    expect(pip.minWidth).toBe(6)
    expect(pip.maxWidth).toBe(10)
  })

  it('grows strictly with the level', () => {
    // Semantic zoom that did not get bigger would not be zoom. This also catches
    // the copy-paste failure of giving two levels the same width.
    for (let i = 1; i < LEVELS.length; i += 1) {
      expect(LEVELS[i]!.width).toBeGreaterThan(LEVELS[i - 1]!.width)
    }
  })

  it('derives the mobile widths from doc 08 §8.4s column counts at 360 px', () => {
    // Recomputed here from the constraints rather than restated: 360 px wide,
    // 16 px kept clear at each edge (doc 08 §8.3), 8 px between columns.
    const usable = 360 - 16 * 2
    const columns = (n: number): number => (usable - HIT_GAP_MIN * (n - 1)) / n

    expect(levelSpec(1).mobileWidth).toBe(columns(4)) // "L1 grid: 4 columns at 360 px"
    expect(levelSpec(2).mobileWidth).toBe(columns(2)) // "L2: 2 columns"
    expect(levelSpec(3).mobileWidth).toBe(usable) // one card, full width
  })

  it('loads no image at L0 and never an art crop above L1', () => {
    // "Never load a full card image to render an L1 tile" (doc 07 §7.3), and its
    // converse: an art crop at L2 would be a cropped card.
    expect(levelSpec(0).asset).toBeNull()
    expect(levelSpec(1).asset).toBe('artCrop')
    expect(levelSpec(2).asset).toBe('normal')
    expect(levelSpec(3).asset).toBe('normal')
  })

  it('throws on a level that does not exist', () => {
    expect(() => levelSpec(7 as 0)).toThrow(/no such zoom level/)
  })

  it('uses the real card and art-crop proportions', () => {
    expect(CARD_ASPECT).toBeCloseTo(1.397, 2) // 88 / 63 mm
    expect(ART_CROP_ASPECT).toBeCloseTo(0.73, 2) // 457 / 626 px
  })
})

describe('which image a level draws', () => {
  const both: CardView = {
    oracleId: 'o1',
    name: 'Sol Ring',
    imageUris: { artCrop: 'art.jpg', normal: 'full.jpg' },
  }

  it('draws the art crop at L1 and the full card above it', () => {
    // The behavioural half of the rule `LevelSpec.asset` states as data, and the
    // reason this function exists: three components reading `imageUris.artCrop`
    // by hand are three chances to load a 745 px card face into a 72 px tile.
    expect(imageFor(both, 1)).toBe('art.jpg')
    expect(imageFor(both, 2)).toBe('full.jpg')
    expect(imageFor(both, 3)).toBe('full.jpg')
  })

  it('draws nothing at L0, however much art the card has', () => {
    // A pip is a mark. Fetching an image to draw one would be 5,000 requests
    // for something 8 px across.
    expect(imageFor(both, 0)).toBeNull()
  })

  it('reads a missing map as no art', () => {
    expect(imageFor({ oracleId: 'o1', name: 'Unresolved Import' }, 2)).toBeNull()
  })

  it('reads a missing asset as no art, even when the other one is there', () => {
    expect(imageFor({ oracleId: 'o1', name: 'X', imageUris: { normal: 'full.jpg' } }, 1)).toBeNull()
  })

  it('reads an empty string as no art, not as a URL', () => {
    /*
     * The database layer stores absent art as NULL and hands it back as `''`,
     * because `Printing.imageUris` is typed as strings. An empty string reaching
     * an `<img src>` resolves against the PAGE URL, so the browser fetches the
     * document again and draws a broken image — in the exact spot the readable
     * fallback panel was supposed to be.
     */
    expect(imageFor({ oracleId: 'o1', name: 'X', imageUris: { normal: '' } }, 2)).toBeNull()
    expect(imageFor({ oracleId: 'o1', name: 'X', imageUris: { artCrop: '' } }, 1)).toBeNull()
  })
})

describe('touch targets', () => {
  it('pads an 8 px pip out to the 44 px minimum', () => {
    // doc 08 §8.3. 8 + 2 * 18 = 44.
    expect(hitPadding(8)).toBe(18)
    expect(8 + hitPadding(8) * 2).toBe(HIT_TARGET_MIN)
  })

  it('pads nothing that already clears the minimum', () => {
    // A 72 px tile does not want 0 px of negative padding pulling it in.
    expect(hitPadding(72)).toBe(0)
    expect(hitPadding(HIT_TARGET_MIN)).toBe(0)
  })
})

describe('colour identity', () => {
  it('reads no colours as colourless and two as multicolour', () => {
    expect(identityKey([])).toBe('C')
    expect(identityKey(['U'])).toBe('U')
    expect(identityKey(['U', 'R'])).toBe('M')
    expect(identityKey(['W', 'U', 'B', 'R', 'G'])).toBe('M')
  })

  it('gives every pip at least 3:1 against the ink ground', () => {
    // A pip you cannot see is not a representation. This is the check that
    // caught the first draft: black mana at #4a4458 sat at 1.87:1.
    for (const [key, hex] of Object.entries(IDENTITY_COLORS)) {
      expect(contrast(hex, '#131a2a'), `${key} on ink`).toBeGreaterThanOrEqual(3)
    }
  })
})

describe('the ordinal ramp', () => {
  it('puts the bottom of the scale at the dark end and the top at the light', () => {
    expect(rampStep(0, 8)).toBe(RAMP[0])
    expect(rampStep(8, 8)).toBe(RAMP[RAMP.length - 1])
  })

  it('never runs off either end of the ramp', () => {
    expect(RAMP).toContain(rampStep(-5, 8))
    expect(RAMP).toContain(rampStep(500, 8))
  })

  it('does not divide by a zero range', () => {
    expect(rampStep(3, 0)).toBe(RAMP[0])
  })

  it('rises monotonically, so a bigger value is never a darker step', () => {
    const steps = [0, 1, 2, 3, 4, 5, 6, 7, 8].map((v) => RAMP.indexOf(rampStep(v, 8)))
    for (let i = 1; i < steps.length; i += 1) {
      expect(steps[i]!).toBeGreaterThanOrEqual(steps[i - 1]!)
    }
  })
})
