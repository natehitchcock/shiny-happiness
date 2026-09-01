import { describe, expect, it } from 'vitest'
import { faceName, faceNames, flipLabel, flipTo, hasBackFace, shownFaceLabel } from './flip.js'
import { imageFor } from './presentation.js'
import type { CardView } from './types.js'

/**
 * The three states of ADR-0027, as fixtures.
 *
 * A suite built only from two-faced cards cannot detect the first state and a
 * suite built only from resolved art cannot detect the third, so all three are
 * named here and every behavioural test below is run against the ones it can
 * distinguish.
 */
const oneFace = (): CardView => ({
  oracleId: 'sol',
  name: 'Sol Ring',
  typeLine: 'Artifact',
  imageUris: { artCrop: 'sol-art.jpg', normal: 'sol.jpg' },
})

const twoFacesResolved = (): CardView => ({
  oracleId: 'delver',
  name: 'Delver of Secrets // Insectile Aberration',
  typeLine: 'Creature — Human Wizard',
  imageUris: { artCrop: 'front-art.jpg', normal: 'front.jpg' },
  backImageUris: { artCrop: 'back-art.jpg', normal: 'back.jpg' },
})

/** Two physical faces, no picture of either — the state the CHECK exists for. */
const twoFacesUnresolved = (): CardView => ({
  oracleId: 'unresolved',
  name: 'Delver of Secrets // Insectile Aberration',
  typeLine: 'Creature — Human Wizard',
  imageUris: { artCrop: '', normal: '' },
  backImageUris: { artCrop: '', normal: '' },
})

describe('hasBackFace — absence means one physical face', () => {
  it('is false for a card with one face', () => {
    expect(hasBackFace(oneFace())).toBe(false)
  })

  it('is true when the back art resolved', () => {
    expect(hasBackFace(twoFacesResolved())).toBe(true)
  })

  it('is true when there is a back face and no picture of it', () => {
    // The whole point of the encoding. A `transform` card whose art failed to
    // resolve still HAS another side, and collapsing it into "one face" is the
    // failure the database CHECK constraint was added to make unspellable.
    expect(hasBackFace(twoFacesUnresolved())).toBe(true)
  })

  it('is true even for a present pair holding no members at all', () => {
    // What the wire's `back: { artCrop: null, normal: null }` maps to once the
    // nulls are dropped: an empty object is still a PRESENT key.
    expect(hasBackFace({ oracleId: 'x', name: 'X', backImageUris: {} })).toBe(true)
  })
})

describe('faceNames — Scryfall names a two-faced card A // B', () => {
  it('splits the printed name on the face separator', () => {
    expect(faceNames('Delver of Secrets // Insectile Aberration')).toEqual([
      'Delver of Secrets',
      'Insectile Aberration',
    ])
  })

  it('reports no second name for a card that has only one', () => {
    expect(faceNames('Sol Ring')).toEqual(['Sol Ring', null])
  })

  it('does not split on a slash pair that is not the separator', () => {
    // ` // ` with its spaces, not `//`: a card whose name contained a bare
    // double slash would otherwise be cut in half.
    expect(faceNames('Borrowing 100,000 Arrows')).toEqual(['Borrowing 100,000 Arrows', null])
  })
})

describe('faceName — what the shown side is called', () => {
  it('names the front half of a two-faced card', () => {
    expect(faceName(twoFacesResolved(), 'front')).toBe('Delver of Secrets')
  })

  it('names the back half', () => {
    expect(faceName(twoFacesResolved(), 'back')).toBe('Insectile Aberration')
  })

  it('falls back to a phrase rather than to an empty string', () => {
    // A card that claims a back face without a `//` in its name is not a shape
    // the corpus has, and an empty `alt` or an unnamed button is worse than a
    // generic phrase — it is a control with no accessible name at all.
    expect(faceName({ oracleId: 'x', name: 'X', backImageUris: {} }, 'back')).toBe('the back face')
  })

  it('gives the whole name for a single-faced card, unchanged', () => {
    expect(faceName(oneFace(), 'front')).toBe('Sol Ring')
  })

  it('does NOT split a split card, whose one picture shows both halves', () => {
    /*
     * Caught in a browser, on the card ADR-0027 §3 names as the counter-example.
     * `Fire // Ice` has a `//` in its name and two entries in `oracleTextFaces`
     * and is one piece of cardboard; its image shows Fire AND Ice, so an `alt`
     * of "Fire" names half of what is on screen. The split is gated on there
     * being a second PHYSICAL face, which is the same gate the control uses.
     */
    const fireIce: CardView = {
      oracleId: 'fi',
      name: 'Fire // Ice',
      imageUris: { normal: 'fire-ice.jpg' },
    }
    expect(faceName(fireIce, 'front')).toBe('Fire // Ice')
  })
})

describe('flipLabel — R4: the control says which face it will show', () => {
  it('names the destination face, not the current one', () => {
    // A bare glyph, or "Flip", tells a screen-reader user nothing about what
    // pressing it does. The label names where it goes.
    expect(flipLabel(twoFacesResolved(), 'front')).toBe('Show the back face: Insectile Aberration')
  })

  it('names the way back', () => {
    expect(flipLabel(twoFacesResolved(), 'back')).toBe('Show the front face: Delver of Secrets')
  })

  it('says which face is on screen now, for the live region', () => {
    expect(shownFaceLabel(twoFacesResolved(), 'back')).toBe(
      'Showing the back face: Insectile Aberration',
    )
    expect(shownFaceLabel(twoFacesResolved(), 'front')).toBe(
      'Showing the front face: Delver of Secrets',
    )
  })
})

describe('flipTo', () => {
  it('goes both ways', () => {
    expect(flipTo('front')).toBe('back')
    expect(flipTo('back')).toBe('front')
  })
})

describe('imageFor — the side is a parameter, the front is the default', () => {
  it('reads the front when no side is asked for, exactly as before', () => {
    expect(imageFor(twoFacesResolved(), 3)).toBe('front.jpg')
    expect(imageFor(twoFacesResolved(), 1)).toBe('front-art.jpg')
  })

  it('reads the back when the back is asked for', () => {
    expect(imageFor(twoFacesResolved(), 3, 'back')).toBe('back.jpg')
    expect(imageFor(twoFacesResolved(), 1, 'back')).toBe('back-art.jpg')
  })

  it('honours the level asset rule on the back too', () => {
    // L0 draws no image at all; asking for its back must not smuggle one in.
    expect(imageFor(twoFacesResolved(), 0, 'back')).toBeNull()
  })

  it('reads an unresolved back as no art, never as an empty src', () => {
    expect(imageFor(twoFacesUnresolved(), 3, 'back')).toBeNull()
    expect(imageFor(twoFacesUnresolved(), 3, 'front')).toBeNull()
  })

  it('reads the back of a single-faced card as no art', () => {
    expect(imageFor(oneFace(), 3, 'back')).toBeNull()
  })
})
