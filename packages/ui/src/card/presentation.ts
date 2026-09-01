/**
 * What each zoom level draws, and how big it is (UI-01, doc 07 §7.1).
 *
 * Pure: no React, no DOM. The four representations differ in what they encode,
 * not merely in scale — so the encoding rules and the size budget belong in one
 * place that both the DOM primitives and the L0 canvas renderer read from.
 * Keeping them here is also what makes the DoD ("each meets its size and a11y
 * requirements") assertable rather than a claim.
 */

import type { CardSide, CardView, Color } from './types.js'

export type ZoomLevel = 0 | 1 | 2 | 3

/**
 * The size budget per level, in CSS pixels.
 *
 * `min`/`max` where doc 07 gives a range, so a test can catch a primitive that
 * has drifted out of the band rather than only catching an exact mismatch.
 */
export interface LevelSpec {
  readonly level: ZoomLevel
  readonly name: string
  /** The nominal width of one card at this level. */
  readonly width: number
  readonly minWidth: number
  readonly maxWidth: number
  /** Narrow-viewport width, from doc 08 §8.4's column counts at 360 px. */
  readonly mobileWidth: number
  /** Which image asset this level loads. `null` means it loads none. */
  readonly asset: 'artCrop' | 'normal' | null
  /** Roughly how many are on screen at once — the reason for the asset choice. */
  readonly onScreen: string
}

export const LEVELS: readonly LevelSpec[] = [
  {
    level: 0,
    name: 'Constellation',
    // A pip is a mark, not a card. Below 6 px it stops being clickable at all;
    // above 10 px a 5,000-card pool no longer fits a region.
    width: 8,
    minWidth: 6,
    maxWidth: 10,
    mobileWidth: 8,
    asset: null,
    onScreen: 'the whole pool, up to ~5,000',
  },
  {
    level: 1,
    name: 'Grid',
    width: 72,
    minWidth: 64,
    maxWidth: 96,
    // 360 px, less two 16 px edge bands, less three 8 px gaps, over 4 columns.
    mobileWidth: 76,
    asset: 'artCrop',
    onScreen: '60–120 tiles',
  },
  {
    level: 2,
    name: 'Card',
    width: 220,
    minWidth: 180,
    maxWidth: 280,
    // 360 px, less two 16 px edge bands, less one 8 px gap, over 2 columns.
    mobileWidth: 160,
    asset: 'normal',
    onScreen: '12–24 cards',
  },
  {
    level: 3,
    name: 'Detail',
    width: 340,
    minWidth: 280,
    maxWidth: 420,
    mobileWidth: 328,
    asset: 'normal',
    onScreen: 'one',
  },
]

export const levelSpec = (level: ZoomLevel): LevelSpec => {
  const found = LEVELS.find((l) => l.level === level)
  if (found === undefined) throw new Error(`no such zoom level: ${String(level)}`)
  return found
}

/** Magic's card aspect ratio, 63 × 88 mm. Art crops are 626 × 457 on Scryfall. */
export const CARD_ASPECT = 88 / 63
export const ART_CROP_ASPECT = 457 / 626

/**
 * The image URL a level draws for this card, or `null` when it draws none.
 *
 * One function rather than `card.imageUris?.artCrop` written out at each call
 * site, because `LevelSpec.asset` above is meant to be the rule for which asset
 * a level loads and a hand-written property access is a second copy of it. Doc
 * 07 §7.3 — "never load a full card image to render an L1 tile" — is then a
 * property of this file rather than a convention three components each have to
 * remember.
 *
 * `null` covers three different absences deliberately, because a caller can do
 * nothing different about any of them:
 *
 *   - the level draws no image at all (L0)
 *   - the card has no art on its default printing — 501 in the real corpus had
 *     none until the double-faced art fix in `packages/clients`, and the state
 *     itself outlives that count: a printing whose art has not been resolved is
 *     null on the wire by design (doc 10)
 *   - the URL came back as an empty string
 *
 * That last one is not hypothetical. The database layer stores absent art as
 * `NULL` but reads it back out as `''` to satisfy a type that says the field is
 * a string, so an empty string is a real spelling of "no art" in this codebase.
 * Passed through to an `<img>` it would resolve against the page URL and draw a
 * broken image exactly where the fallback panel was supposed to draw a name.
 *
 * `side` picks which PHYSICAL face to read (ADR-0027), and defaults to the
 * front so that every existing call site keeps its exact present meaning — the
 * front is the card, and nothing here moves it. Note what this function does
 * NOT answer: a null back is not "this card has one face". Ask `hasBackFace`
 * for that, which reads the KEY; this reads the URL, and the two are different
 * questions for a two-faced card whose art never resolved.
 */
export const imageFor = (
  card: CardView,
  level: ZoomLevel,
  side: CardSide = 'front',
): string | null => {
  const { asset } = levelSpec(level)
  if (asset === null) return null
  const url = side === 'back' ? card.backImageUris?.[asset] : card.imageUris?.[asset]
  return url === undefined || url === '' ? null : url
}

// ------------------------------------------------------------------ touch

/**
 * doc 08 §8.3: 44 × 44 px minimum, 8 px between adjacent targets.
 *
 * An L1 tile is 72 px and clears this on its own; the pips at L0 emphatically do
 * not, which is why `hitPadding` exists — the mark stays 8 px and the thing you
 * can hit around it grows to 44.
 */
export const HIT_TARGET_MIN = 44
export const HIT_GAP_MIN = 8

/** Padding, per side, that grows a mark of this size up to the touch minimum. */
export const hitPadding = (markSize: number): number => Math.max(0, (HIT_TARGET_MIN - markSize) / 2)

// ----------------------------------------------------------------- colour

export type PipEncoding = 'colorIdentity' | 'manaValue' | 'role' | 'comboDegree'

/**
 * Magic's five colours, plus the two cases the game itself treats as colours:
 * colourless, and "more than one" — which is gold on a real card frame.
 *
 * These are NOT free design choices. A blue card has to look blue; a palette
 * that reassigned them for contrast reasons would be unreadable to anyone who
 * plays the game. What that costs is stated in `PIP_CVD_NOTE`.
 */
export const IDENTITY_COLORS: Readonly<Record<string, string>> = {
  W: '#ede2c0',
  U: '#2f74c8',
  B: '#a274ae',
  R: '#d9603c',
  G: '#35a06b',
  /** Two or more colours. */
  M: '#d4af37',
  /** No colour identity at all — artifacts, most lands. */
  C: '#adadb8',
}

export const identityKey = (colorIdentity: readonly Color[]): string => {
  if (colorIdentity.length === 0) return 'C'
  if (colorIdentity.length > 1) return 'M'
  return colorIdentity[0] ?? 'C'
}

/**
 * What the palette validator says about these seven, and why it still ships.
 *
 * Run: `validate_palette.js "<the seven>" --mode dark --surface #131a2a
 * --pairs all`. All pairs, not adjacent ones, because any two pips can end up
 * next to each other in a constellation — there is no series order to lean on.
 *
 * PASS  normal-vision floor, worst pair 15.2 ΔE — this one was NOT free. The
 *       first draft had colourless at 13.9 against blue, and black at 1.87:1 on
 *       ink, which is a pip you cannot see. Black moved to a lighter purple and
 *       colourless to a cooler grey to fix both.
 * PASS  contrast, all seven at or above 3:1 on the ink ground.
 * WARN  CVD separation, worst pair 6.3 ΔE protan (black vs blue), and red vs
 *       green sits at 7.0 deutan. Both are inside the 6–8 band, which is legal
 *       ONLY with a second signal. The signals are listed below.
 * FAIL  lightness band and chroma floor, on white and colourless.
 *
 * The two FAILs are not defects and are not fixable: they say white is very
 * light and near-grey, and that colourless is grey. Both are the meaning of the
 * category. A palette that "fixed" them would be one where a white card is not
 * white, which no Magic player would read.
 *
 * The second signals the WARN obliges, which is the standing check on this:
 *
 *   - the encoding is switchable (`PipEncoding`), and the other three are all
 *     ordinal ramps rather than categorical hues
 *   - L0 carries a visually-hidden group summary (doc 07 §7.3), so the shape
 *     question a pip view answers is also answerable in text
 *   - nothing is ever *decided* at L0 — accepting a card happens at L1 and up,
 *     where the name is on screen
 *
 * A fourth is deliberately NOT claimed: there is no texture or shape variation
 * on pips, because at 8 px there is no room for one.
 */
export const PIP_CVD_NOTE =
  'Black/blue and red/green pips sit in the 6-8 CVD band; L0 is a shape view, not a decision surface.'

/** An ordinal ramp, light to dark, for the non-categorical pip encodings. */
export const RAMP: readonly string[] = [
  '#2b3556',
  '#3f5480',
  '#5477a8',
  '#7d9cc4',
  '#a9c1dc',
  '#d8e4f0',
]

export const rampStep = (value: number, max: number): string => {
  if (max <= 0) return RAMP[0] ?? '#2b3556'
  const clamped = Math.max(0, Math.min(value, max))
  const index = Math.round((clamped / max) * (RAMP.length - 1))
  return RAMP[index] ?? '#2b3556'
}
