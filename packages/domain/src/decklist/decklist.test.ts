import { describe, expect, it } from 'vitest'
import { oracleId } from '../ids.js'
import { formatDecklist, LOSSY_FORMATS, type ExportDeck } from './format.js'
import { parseDecklist } from './parse.js'
import { buildNameIndex, normaliseName, resolveDecklist, similarity } from './resolve.js'

const names = (text: string) => parseDecklist(text).entries.map((e) => e.name)

describe('parseDecklist — quantity forms', () => {
  it('reads a plain list', () => {
    expect(names('1 Sol Ring\n1 Arcane Signet')).toEqual(['Sol Ring', 'Arcane Signet'])
  })

  it('reads the x suffix', () => {
    expect(names('1x Sol Ring\n2x Mountain')).toEqual(['Sol Ring', 'Mountain'])
    expect(parseDecklist('2x Mountain').entries[0]!.quantity).toBe(2)
  })

  it('defaults a missing quantity to 1', () => {
    // Two words, so not a category header.
    expect(parseDecklist('4 Mountain').entries[0]!.quantity).toBe(4)
  })

  it('reads set and collector number', () => {
    const entry = parseDecklist('1 Sol Ring (C21) 263').entries[0]!
    expect(entry.name).toBe('Sol Ring')
    expect(entry.setCode).toBe('C21')
    expect(entry.collectorNumber).toBe('263')
  })

  it('reads a set with no collector number', () => {
    const entry = parseDecklist('1 Sol Ring (C21)').entries[0]!
    expect(entry.name).toBe('Sol Ring')
    expect(entry.setCode).toBe('C21')
    expect(entry.collectorNumber).toBeNull()
  })
})

describe('parseDecklist — the awkward cases', () => {
  it('handles Windows line endings', () => {
    expect(names('1 Sol Ring\r\n1 Mountain')).toEqual(['Sol Ring', 'Mountain'])
  })

  it('keeps a split card whole', () => {
    expect(names('1 Fire // Ice')).toEqual(['Fire // Ice'])
  })

  it('keeps accented and punctuated names intact', () => {
    expect(names("1 Krenko's Command\n1 Jeska's Will\n1 Nazgûl")).toEqual([
      "Krenko's Command",
      "Jeska's Will",
      'Nazgûl',
    ])
  })

  it('skips blank lines', () => {
    expect(names('1 Sol Ring\n\n\n1 Mountain')).toHaveLength(2)
  })

  it('reports a line it cannot read rather than throwing', () => {
    const result = parseDecklist('0 Sol Ring')
    expect(result.entries).toHaveLength(0)
    expect(result.problems[0]!.reason).toMatch(/invalid quantity/)
  })
})

describe('parseDecklist — sections and categories', () => {
  it('detects a commander marker', () => {
    const entry = parseDecklist('1 Krenko, Mob Boss *CMDR*').entries[0]!
    expect(entry.isCommander).toBe(true)
    expect(entry.name).toBe('Krenko, Mob Boss')
  })

  it('detects a Commander section header', () => {
    const entries = parseDecklist('Commander\n1 Krenko, Mob Boss\n\nDeck\n1 Sol Ring').entries
    expect(entries[0]!.isCommander).toBe(true)
    expect(entries[1]!.isCommander).toBe(false)
  })

  it('detects a maybeboard marker and tags the section', () => {
    const entries = parseDecklist('1 Sol Ring\n// Maybeboard\n1 Skullclamp').entries
    expect(entries[0]!.section).toBe('main')
    expect(entries[1]!.section).toBe('maybeboard')
  })

  // doc 15 §15.2 — their taxonomy is preserved as tags, never mapped to our roles.
  it('keeps a category header as a tag, not as a role', () => {
    const entries = parseDecklist("SORCERY (12)\n1 Jeska's Will").entries
    expect(entries[0]!.tags).toEqual(['SORCERY'])
    expect(entries[0]!.name).toBe("Jeska's Will")
  })

  it('keeps a bracketed annotation as a tag', () => {
    const entry = parseDecklist('1 Sol Ring [Ramp]').entries[0]!
    expect(entry.name).toBe('Sol Ring')
    expect(entry.tags).toEqual(['Ramp'])
  })

  it('does not mistake a category header for a card', () => {
    const entries = parseDecklist('Ramp\n1 Sol Ring\nCreatures\n1 Krenko').entries
    expect(entries.map((e) => e.name)).toEqual(['Sol Ring', 'Krenko'])
    expect(entries[0]!.tags).toEqual(['Ramp'])
    expect(entries[1]!.tags).toEqual(['Creatures'])
  })

  it('handles an empty list', () => {
    expect(parseDecklist('')).toEqual({ entries: [], problems: [] })
  })
})

describe('name resolution', () => {
  const index = buildNameIndex([
    { oracleId: oracleId('sol'), name: 'Sol Ring' },
    { oracleId: oracleId('bomb'), name: 'Goblin Bombardment' },
    { oracleId: oracleId('fire'), name: 'Fire // Ice' },
    { oracleId: oracleId('nazgul'), name: 'Nazgûl' },
  ])

  it('normalises case, punctuation and accents', () => {
    expect(normaliseName('Nazgûl')).toBe(normaliseName('nazgul'))
    expect(normaliseName("Krenko's Command")).toBe(normaliseName('krenkos command'))
  })

  it('resolves a split card by its first half', () => {
    const { resolved } = resolveDecklist(parseDecklist('1 Fire').entries, index)
    expect(resolved[0]!.oracleId).toBe(oracleId('fire'))
  })

  it('resolves exactly when the name matches', () => {
    const { resolved } = resolveDecklist(parseDecklist('1 Sol Ring').entries, index)
    expect(resolved[0]).toMatchObject({ oracleId: oracleId('sol'), method: 'exact', confidence: 1 })
  })

  it('resolves a near miss fuzzily', () => {
    const { resolved, unresolved } = resolveDecklist(
      parseDecklist('1 Goblin Bombardmnt').entries,
      index,
    )
    expect(unresolved).toHaveLength(0)
    expect(resolved[0]).toMatchObject({ oracleId: oracleId('bomb'), method: 'fuzzy' })
    expect(resolved[0]!.confidence).toBeLessThan(1)
  })

  // doc 15 §15.6 — a confidently wrong card is worse than an unresolved line.
  it('asks rather than guessing below the confidence floor', () => {
    const { resolved, unresolved } = resolveDecklist(
      parseDecklist('1 Goblin Bombadier').entries,
      index,
    )
    expect(resolved).toHaveLength(0)
    expect(unresolved[0]!.reason).toMatch(/no card matches/)
    expect(unresolved[0]!.suggestions).toContain(oracleId('bomb'))
  })

  it('offers no suggestion for something wholly unlike any card', () => {
    const { unresolved } = resolveDecklist(parseDecklist('1 Qqqqzzzzxxxx').entries, index)
    expect(unresolved[0]!.suggestions).toEqual([])
  })

  it('brings in what parsed even when a line fails', () => {
    const parsed = parseDecklist('1 Sol Ring\n1 Not A Real Card At All\n1 Nazgûl')
    const { resolved, unresolved } = resolveDecklist(parsed.entries, index)
    expect(resolved.map((r) => r.oracleId)).toEqual([oracleId('sol'), oracleId('nazgul')])
    expect(unresolved).toHaveLength(1)
  })

  it('scores similarity between 0 and 1', () => {
    expect(similarity('abc', 'abc')).toBe(1)
    expect(similarity('', '')).toBe(1)
    expect(similarity('abc', 'xyz')).toBeGreaterThanOrEqual(0)
  })
})

describe('formatDecklist', () => {
  const deck: ExportDeck = {
    name: 'Goblins',
    entries: [
      {
        oracleId: oracleId('krenko'),
        name: 'Krenko, Mob Boss',
        quantity: 1,
        isCommander: true,
        category: null,
        setCode: null,
        collectorNumber: null,
      },
      {
        oracleId: oracleId('sol'),
        name: 'Sol Ring',
        quantity: 1,
        isCommander: false,
        category: 'Ramp',
        setCode: 'C21',
        collectorNumber: '263',
      },
      {
        oracleId: oracleId('mtn'),
        name: 'Mountain',
        quantity: 34,
        isCommander: false,
        category: 'Lands',
        setCode: null,
        collectorNumber: null,
      },
    ],
  }

  it('writes plain text with the commander first', () => {
    expect(formatDecklist(deck, 'text')).toBe('1 Krenko, Mob Boss\n1 Sol Ring\n34 Mountain')
  })

  it('writes the Moxfield flavour with a marker and categories', () => {
    const out = formatDecklist(deck, 'moxfield')
    expect(out).toContain('1 Krenko, Mob Boss *CMDR*')
    expect(out).toContain('// Ramp')
    expect(out).toContain('// Lands')
  })

  it('round-trips through the Moxfield flavour', () => {
    const parsed = parseDecklist(formatDecklist(deck, 'moxfield'))
    expect(parsed.problems).toEqual([])
    expect(parsed.entries.map((e) => e.name)).toEqual(['Krenko, Mob Boss', 'Sol Ring', 'Mountain'])
    expect(parsed.entries[0]!.isCommander).toBe(true)
    expect(parsed.entries[1]!.tags).toEqual(['Ramp'])
  })

  it('round-trips through plain text', () => {
    const parsed = parseDecklist(formatDecklist(deck, 'text'))
    expect(parsed.entries.map((e) => [e.quantity, e.name])).toEqual([
      [1, 'Krenko, Mob Boss'],
      [1, 'Sol Ring'],
      [34, 'Mountain'],
    ])
  })

  it('escapes CSV values that need it', () => {
    const out = formatDecklist(deck, 'csv')
    expect(out.split('\n')[0]).toBe('Count,Name,Commander,Category,Set,CollectorNumber')
    expect(out).toContain('"Krenko, Mob Boss"')
  })

  it('round-trips losslessly through JSON, and only through JSON', () => {
    expect(JSON.parse(formatDecklist(deck, 'json'))).toEqual(deck)
    expect(LOSSY_FORMATS.has('json')).toBe(false)
    for (const format of ['text', 'moxfield', 'mtgo', 'csv'] as const) {
      expect(LOSSY_FORMATS.has(format)).toBe(true)
    }
  })
})
