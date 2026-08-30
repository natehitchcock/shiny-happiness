/**
 * Design tokens (FOUND-02).
 *
 * The values live here as data, and `tokens.css` declares the same values as
 * custom properties. Data first so they can be ASSERTED — a palette whose
 * contrast nobody checks is a palette that drifts, and doc 08 §8.x requires
 * legibility rather than hoping for it.
 *
 * The visual language: the ground is a play mat rather than a dashboard, deep
 * ink blue rather than neutral grey, because this is a table you sit at for an
 * hour and card faces should read as parchment against it. Brass is reserved for
 * things the user has EARNED or DECIDED — combo degree, and a locked card — so
 * it means something wherever it appears.
 */

export interface ColorToken {
  readonly name: string
  readonly value: string
  readonly role: 'surface' | 'ink' | 'accent' | 'status'
  readonly comment: string
}

export const COLORS: readonly ColorToken[] = [
  {
    name: 'ink',
    value: '#131a2a',
    role: 'surface',
    comment: 'The table. Every other colour is judged against this.',
  },
  { name: 'ink-2', value: '#1b2540', role: 'surface', comment: 'A raised surface: rows, sheets.' },
  { name: 'ink-3', value: '#253052', role: 'surface', comment: 'Hover, and empty meter track.' },
  { name: 'rule', value: '#2f3c63', role: 'surface', comment: 'Borders and dividers.' },
  {
    name: 'parchment',
    value: '#ede6d8',
    role: 'ink',
    comment: 'Body text. Warm, so card names read as card faces.',
  },
  {
    name: 'parchment-dim',
    value: '#b9b2a4',
    role: 'ink',
    comment: 'Secondary text: labels, counts, notes.',
  },
  {
    name: 'brass',
    value: '#c9a227',
    role: 'accent',
    comment: 'Earned or decided: combo degree, locked cards. Never decoration.',
  },
  { name: 'brass-dim', value: '#6d5a1a', role: 'accent', comment: 'Brass at rest, for borders.' },
  {
    name: 'sage',
    value: '#4e9a69',
    role: 'status',
    comment:
      'Good / short of target / matches. Chosen with the palette validator, not by eye — the ' +
      'previous #6E9B7C had chroma 0.067 and read as grey on ink.',
  },
  {
    name: 'rust',
    value: '#c06248',
    role: 'status',
    comment:
      'Over target, over budget, a problem. The only alarm colour. Lightened from ' +
      '#A8503C, which the contrast test caught at 2.80:1 on ink-2 — below the 3:1 ' +
      'floor, on the very surface cut hints are drawn.',
  },
]

export const byName = (name: string): ColorToken => {
  const found = COLORS.find((c) => c.name === name)
  if (found === undefined) throw new Error(`unknown colour token: ${name}`)
  return found
}

export const TYPE = {
  display: "'Spectral', Georgia, serif",
  ui: "'Karla', system-ui, sans-serif",
  mono: "'JetBrains Mono', ui-monospace, monospace",
} as const

export const SPACE = { step: '0.5rem', radius: '3px' } as const

// ---------------------------------------------------------------- contrast

const channel = (eight: number): number => {
  const c = eight / 255
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}

export const luminance = (hex: string): number => {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

/** WCAG 2.1 contrast ratio, 1..21. */
export const contrast = (a: string, b: string): number => {
  const la = luminance(a)
  const lb = luminance(b)
  const [lighter, darker] = la > lb ? [la, lb] : [lb, la]
  return (lighter + 0.05) / (darker + 0.05)
}

/**
 * Pairs that must stay legible, and the floor each must clear.
 *
 * 4.5:1 is the AA floor for body text. 3:1 is the AA floor for large text and
 * for non-text things you must be able to SEE — a meter fill, a progress bar,
 * a status pip — which is what the accent and status colours are used for.
 * Listing the pairs explicitly means adding a surface forces a decision about
 * what may sit on it, rather than leaving it to be discovered by a user.
 */
export interface ContrastRule {
  readonly foreground: string
  readonly background: string
  readonly min: number
  readonly why: string
}

export const CONTRAST_RULES: readonly ContrastRule[] = [
  { foreground: 'parchment', background: 'ink', min: 4.5, why: 'body text on the table' },
  { foreground: 'parchment', background: 'ink-2', min: 4.5, why: 'card names in a row' },
  { foreground: 'parchment', background: 'ink-3', min: 4.5, why: 'card names on hover' },
  { foreground: 'parchment-dim', background: 'ink', min: 4.5, why: 'labels, counts, notes' },
  { foreground: 'parchment-dim', background: 'ink-2', min: 4.5, why: 'costs inside a row' },
  { foreground: 'brass', background: 'ink', min: 3, why: 'combo degree and the lock marker' },
  { foreground: 'brass', background: 'ink-2', min: 3, why: 'the same, inside a row' },
  { foreground: 'sage', background: 'ink', min: 3, why: 'short-of-target bars, matched columns' },
  { foreground: 'rust', background: 'ink', min: 3, why: 'over-target bars, cut hints' },
  { foreground: 'rust', background: 'ink-2', min: 3, why: 'cut hints inside a deck row' },
  { foreground: 'rust', background: 'ink-3', min: 3, why: 'a cut hint on a hovered row' },
  { foreground: 'sage', background: 'ink-3', min: 3, why: 'a matched column on a hovered row' },
  { foreground: 'ink', background: 'brass', min: 4.5, why: 'text on the primary button' },
]

/**
 * Sage and rust are NOT distinguishable by colour alone under deuteranopia.
 *
 * They sit at ΔE 4.5 deutan, under the 6 floor, and no hex fixes it: the pair
 * only separated when rust was dark, and dark is exactly what failed contrast
 * on `ink-2`. Contrast is a hard requirement, so contrast won.
 *
 * What makes that acceptable is that colour is never the only signal anywhere
 * they are used, and this list is the standing check on that claim:
 *
 *   - composition bars    carry `actual / ideal` as text, and a title attribute
 *   - curve buckets       carry an aria-label naming short / over and the range
 *   - cut hints           are words ("no synergy"), the colour is decoration
 *   - column cells        are a tick or a dot, a glyph not a hue
 *
 * Anything new that uses sage against rust must add its own second signal. That
 * is not a nicety here — for a red/green pair on a dark ground it is the only
 * thing making them tellable apart.
 */
export const STATUS_NEEDS_SECOND_SIGNAL = true
