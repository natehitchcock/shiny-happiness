import { describe, expect, it } from 'vitest'
import type { Card, CardType } from './card.js'
import { oracleId, printingId } from './ids.js'
import { STAPLES, STAPLE_DATA, isStaple, stapleGroupFor } from './staples.js'

const card = (name: string, types: readonly CardType[]): Card => ({
  oracleId: oracleId(name),
  name,
  manaCost: null,
  manaValue: 0,
  colorIdentity: [],
  colors: [],
  typeLine: types.join(' '),
  types,
  oracleText: '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(`${name}-p`),
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
})

describe('the curated staples list', () => {
  it('is not empty — an empty list would make the whole feature a silent no-op', () => {
    expect(STAPLES.names.size).toBeGreaterThan(0)
  })

  it('stays small enough to be an opinion somebody can disagree with card by card', () => {
    // Not a magic ceiling: the value of the list is what it refuses. Somewhere
    // past a hundred entries "staple" has quietly become "good card", and the
    // list would be making a claim it cannot defend entry by entry.
    expect(STAPLES.names.size).toBeLessThanOrEqual(100)
  })

  it('names no card twice — a duplicate would count once and mislead a reader', () => {
    expect(STAPLES.names.size).toBe(STAPLE_DATA.cards.length)
  })

  it('holds exact, trimmed card names, because the corpus is matched by string', () => {
    for (const entry of STAPLE_DATA.cards) {
      expect(entry.name).toBe(entry.name.trim())
      expect(entry.name.length).toBeGreaterThan(0)
    }
  })

  it('records its provenance, so nobody has to ask where the opinion came from', () => {
    // ADR-0006's discipline applied to a curated file: a hand-typed list with
    // no source, no date and no owner is exactly what that ADR exists to stop.
    expect(STAPLES.curatedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(STAPLES.owner.length).toBeGreaterThan(0)
    expect(STAPLE_DATA.$comment.join(' ')).toContain('CURATED')
  })

  it('gives every entry a stated reason, so the principle is auditable per card', () => {
    for (const entry of STAPLE_DATA.cards) expect(entry.why.length).toBeGreaterThan(0)
  })

  it('matches by exact name and nothing looser', () => {
    expect(isStaple('Sol Ring')).toBe(true)
    expect(isStaple('sol ring')).toBe(false)
    expect(isStaple('Sol Ring, the Sequel')).toBe(false)
    expect(isStaple('Grizzly Bears')).toBe(false)
  })
})

describe('splitting the one list into staples and staple lands', () => {
  it("reads the card's own type line rather than a second copy in the data file", () => {
    expect(stapleGroupFor(card('Command Tower', ['land']))).toBe('staple-land')
    expect(stapleGroupFor(card('Sol Ring', ['artifact']))).toBe('staple')
  })

  it('files a card that is not on the list under neither group', () => {
    expect(stapleGroupFor(card('Grizzly Bears', ['creature']))).toBeNull()
    expect(stapleGroupFor(card('Grizzly Bears', ['land']))).toBeNull()
  })

  it('follows the corpus if a listed card is ever a land, without the file changing', () => {
    // The whole argument for having no `type` field in the data: the answer
    // moves with the database, and the checked-in file cannot contradict it.
    expect(stapleGroupFor(card('Sol Ring', ['land']))).toBe('staple-land')
  })

  it('reads a modal card that is a land on one face as a land', () => {
    // `types` carries every face's type, so an MDFC land-back is a land here.
    // Filing it under "staples" would offer it in the phase before the one
    // that is about the mana base.
    expect(stapleGroupFor(card('Command Tower', ['creature', 'land']))).toBe('staple-land')
  })
})
