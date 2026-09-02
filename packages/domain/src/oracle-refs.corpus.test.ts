import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import { resolveOracleReferences } from './oracle-refs.js'

/**
 * The whole-corpus check behind the numbers in `oracle-refs.ts`.
 *
 * The dump is 11 MB of card data and is NOT in git (AGENTS.md §5 — no bulk card
 * data). This suite therefore SKIPS when the dump is absent, which is the normal
 * case in CI and on a clean clone. It exists so the claim "291 cross-card links
 * and no false positives" can be re-run against the real table rather than
 * trusted, and so a future change to the matcher is measured the same way.
 *
 * Regenerate with:
 *   select oracle_id, name, oracle_text, oracle_text_faces from cards
 * dumped as JSONL to the path below.
 */
const DUMP =
  'C:/Users/tripn/AppData/Local/Temp/claude/C--Projects/0862f9f7-81c7-46fe-8300-43637e816fec/scratchpad/measure/cards.jsonl'

interface Row {
  readonly name: string
  readonly oracle_text: string | null
  readonly oracle_text_faces: readonly string[] | null
}

const available = fs.existsSync(DUMP)

describe.skipIf(!available)('oracle-refs over the whole card table', () => {
  const rows: Row[] = available
    ? fs
        .readFileSync(DUMP, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Row)
    : []

  const known = new Set<string>()
  for (const row of rows) {
    known.add(row.name)
    if (row.name.includes(' // ')) for (const face of row.name.split(' // ')) known.add(face.trim())
  }
  const textOf = (row: Row): string =>
    row.oracle_text_faces !== null && row.oracle_text_faces.length > 0
      ? row.oracle_text_faces.join('\n')
      : (row.oracle_text ?? '')
  const withText = rows.filter((row) => textOf(row).trim() !== '')

  const all = withText.map((row) => ({
    row,
    refs: resolveOracleReferences(textOf(row), known, row.name),
  }))
  const linked = all.filter((entry) => entry.refs.length > 0)
  const total = all.reduce((sum, entry) => sum + entry.refs.length, 0)

  it('has the corpus it expects', () => {
    expect(rows.length).toBe(34_494)
    expect(withText.length).toBe(34_145)
  })

  /*
   * The point of the whole design. Naive name matching produced 24,877 links on
   * 46.8% of cards; anything near that number means the anchoring has been lost
   * and rules text is about to turn into a field of links.
   */
  it('links a few hundred cards, not half the corpus', () => {
    expect(total).toBeGreaterThan(200)
    expect(total).toBeLessThan(400)
    expect(linked.length / withText.length).toBeLessThan(0.02)
  })

  it('never links a card to itself', () => {
    for (const { row, refs } of linked) {
      for (const ref of refs) {
        expect(ref.name).not.toBe(row.name)
        expect(ref.name).not.toBe(row.name.replace(/^A-/, ''))
      }
    }
  })

  it('only ever links a name that is really a card', () => {
    for (const { refs } of linked) for (const ref of refs) expect(known.has(ref.name)).toBe(true)
  })

  it('never links a basic land', () => {
    const basics = new Set(['Plains', 'Island', 'Swamp', 'Mountain', 'Forest', 'Wastes'])
    for (const { refs } of linked) for (const ref of refs) expect(basics.has(ref.name)).toBe(false)
  })

  /*
   * The false-positive shapes that a naive matcher produced in bulk. Each of
   * these is a real card name AND an ordinary rules word; every one of them
   * appears thousands of times in text that is not referring to the card.
   */
  it('never links the ordinary words that are also card names', () => {
    const traps = new Set([
      'When',
      'X',
      'Sacrifice',
      'Exile',
      'Return',
      'Flash',
      'Vigilance',
      'Regenerate',
      'Fear',
    ])
    for (const { refs } of linked) for (const ref of refs) expect(traps.has(ref.name)).toBe(false)
  })

  it('puts no card over a handful of links', () => {
    for (const { row, refs } of linked) {
      // Who's That Praetor? names five. Anything much past that is a matcher
      // that has started linking prose.
      expect(refs.length, `${row.name} produced ${refs.length} links`).toBeLessThanOrEqual(6)
    }
  })

  it('finds the references that are certainly there', () => {
    const find = (name: string): readonly string[] =>
      all.find((entry) => entry.row.name === name)?.refs.map((r) => r.name) ?? []
    expect(find('Ral’s Dispersal').length + find("Ral's Dispersal").length).toBeGreaterThan(0)
    expect(find('Helm of Kaldra')).toEqual(['Sword of Kaldra', 'Shield of Kaldra'])
    expect(find('Urza, Lord Protector')).toEqual([
      'The Mightstone and Weakstone',
      'Urza, Planeswalker',
    ])
    expect(find('Kher Keep')).toEqual(['Kobolds of Kher Keep'])
  })
})
