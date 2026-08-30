import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { byName, COLORS, contrast, CONTRAST_RULES, luminance } from './tokens.js'

describe('contrast', () => {
  it('matches the WCAG reference values', () => {
    // Black on white is the definition of 21:1; identical colours are 1:1.
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('does not care which way round the pair is given', () => {
    expect(contrast('#131a2a', '#ede6d8')).toBeCloseTo(contrast('#ede6d8', '#131a2a'), 8)
  })

  it('reads luminance on the WCAG scale', () => {
    expect(luminance('#000000')).toBeCloseTo(0, 5)
    expect(luminance('#ffffff')).toBeCloseTo(1, 5)
  })
})

/**
 * The DoD for FOUND-02: "contrast >= 4.5:1 verified by a test".
 *
 * Every pair the interface actually puts together, checked. A failure here is
 * not a test to relax — it means a colour has to move, which is exactly what
 * happened to `sage` when the palette validator caught it reading as grey.
 */
describe('palette contrast', () => {
  for (const rule of CONTRAST_RULES) {
    it(`${rule.foreground} on ${rule.background} clears ${String(rule.min)}:1 — ${rule.why}`, () => {
      const ratio = contrast(byName(rule.foreground).value, byName(rule.background).value)
      expect(ratio).toBeGreaterThanOrEqual(rule.min)
    })
  }
})

describe('token hygiene', () => {
  it('gives every colour a comment saying what it is for', () => {
    // A token nobody can explain is a token that gets misused.
    for (const token of COLORS) {
      expect(token.comment.length).toBeGreaterThan(10)
    }
  })

  it('has no duplicate names', () => {
    expect(new Set(COLORS.map((c) => c.name)).size).toBe(COLORS.length)
  })

  it('writes every value as a six-digit lowercase hex', () => {
    // The CSS file and this table must be diffable by eye.
    for (const token of COLORS) {
      expect(token.value).toMatch(/^#[0-9a-f]{6}$/)
    }
  })

  it('reserves brass for earned or decided state', () => {
    // The rule that keeps the accent meaningful — if brass becomes decoration
    // the combo pip stops standing out.
    expect(byName('brass').comment).toMatch(/earned|decided/i)
  })

  it('throws on an unknown token rather than returning undefined', () => {
    expect(() => byName('chartreuse')).toThrow(/unknown colour token/)
  })
})

describe('tokens.css stays in step with tokens.ts', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'tokens.css'), 'utf8')

  it('declares every colour, at the value the data gives', () => {
    // The generated stylesheet is the thing the browser reads; if it drifts
    // from the table above, the contrast assertions are checking a palette
    // nobody is actually looking at.
    for (const token of COLORS) {
      expect(css).toContain(`--${token.name}: ${token.value};`)
    }
  })

  it('declares no colour the data does not have', () => {
    const declared = [...css.matchAll(/--([a-z0-9-]+): (#[0-9a-f]{6});/g)].map((m) => m[1])
    const known = new Set(COLORS.map((c) => c.name))
    for (const name of declared) expect(known.has(name!)).toBe(true)
  })

  it('says it is generated, so nobody hand-edits it', () => {
    expect(css).toMatch(/GENERATED/)
  })
})
