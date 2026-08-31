import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { deriveCanBeCommander } from '@roundtable/domain'
import {
  fetchCommanderOracleIds,
  isUniversesBeyondCard,
  tallyPrinting,
  type ProvenanceTally,
  parseTypes,
  toCard,
  toPrinting,
  delayFor,
  skipReason,
  type ScryfallCard,
} from './scryfall.js'

/**
 * Contract tests against a RECORDED fixture, never the live API (AGENTS.md §4).
 *
 * The fixture is a hand-picked sample containing the shapes that break naive
 * mappers: split cards, MDFCs, adventures, meld backs, accented names, a banned
 * card, a basic land and the singleton exceptions.
 */
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'scryfall-oracle-sample.jsonl',
)

const cards: ScryfallCard[] = readFileSync(FIXTURE, 'utf8')
  .split('\n')
  .filter((line) => line.trim() !== '')
  .map((line) => JSON.parse(line) as ScryfallCard)

const byName = (name: string): ScryfallCard => {
  const found = cards.find((c) => c.name === name)
  if (found === undefined) throw new Error(`fixture missing ${name}`)
  return found
}

describe('parseTypes', () => {
  it('reads types from the front of the type line only', () => {
    // "Druid" is a subtype and must not produce a type.
    expect(parseTypes('Legendary Creature — Elf Druid')).toEqual(['creature'])
  })

  it('handles a multi-type line', () => {
    expect([...parseTypes('Artifact Creature — Golem')].sort()).toEqual(['artifact', 'creature'])
  })

  it('does not invent a type from a subtype that shares a word', () => {
    // "Enchantment Creature — Enchantment Whale" style lines; the subtype half
    // is discarded entirely.
    expect(parseTypes('Land — Forest')).toEqual(['land'])
  })

  it('returns nothing for a type line it does not recognise', () => {
    expect(parseTypes('Vanguard')).toEqual([])
    expect(parseTypes('Stickers')).toEqual([])
    expect(parseTypes('Conspiracy')).toEqual([])
    expect(parseTypes('Card')).toEqual([])
  })

  it('reads the pre-6th-edition "Summon" wording as a creature', () => {
    // "Summon Dragon" and friends are still legal in Commander.
    expect(parseTypes('Summon Dragon')).toEqual(['creature'])
    expect(parseTypes('Summon Legend')).toEqual(['creature'])
  })
})

describe('toCard', () => {
  it('maps an ordinary card', () => {
    const card = toCard(byName('Sol Ring'))

    expect(card).not.toBeNull()
    expect(card?.name).toBe('Sol Ring')
    expect(card?.manaValue).toBe(1)
    expect(card?.types).toEqual(['artifact'])
    expect(card?.colorIdentity).toEqual([])
    expect(card?.legalities.commander).toBe('legal')
  })

  it('renames cmc to manaValue, as the domain names it (AGENTS.md §7)', () => {
    const raw = byName('Counterspell')
    const card = toCard(raw)

    expect(card?.manaValue).toBe(raw.cmc)
  })

  it('carries the banned verdict rather than defaulting it to legal', () => {
    const card = toCard(byName('Black Lotus'))

    expect(card?.legalities.commander).toBe('banned')
  })

  it('treats an unrecognised legality as not legal, never as legal', () => {
    const card = toCard({ ...byName('Sol Ring'), legalities: { commander: 'sideways' } })

    expect(card?.legalities.commander).toBe('not_legal')
  })

  it('treats a missing legality as not legal', () => {
    const raw = { ...byName('Sol Ring') }
    delete (raw as { legalities?: unknown }).legalities
    expect(toCard(raw)?.legalities.commander).toBe('not_legal')
  })

  it('decides commander eligibility at ingest rather than leaving it open', () => {
    // The mapping is what is under test here, not the rule — `legality.test.ts`
    // owns the rule against real type lines. What matters at this seam is that
    // every mapped card carries an answer, because the API reads `undefined` as
    // "the ingest has not run" and lets the deck through on that.
    expect(toCard(byName('Lord of the Nazgûl'))?.canBeCommander).toBe(true)
    expect(toCard(byName('Sol Ring'))?.canBeCommander).toBe(false)
    for (const raw of cards) {
      const card = toCard(raw)
      if (card !== null) expect(typeof card.canBeCommander).toBe('boolean')
    }
  })

  it('will not call a card a commander when its legality is unrecognised', () => {
    // A legendary creature Scryfall reports with a legality nobody recognises.
    // The type line alone would say yes, and the format gate is the only thing
    // between that and a deck built around a card that cannot be played —
    // which is the same direction `legalities` itself is defaulted in.
    const raw = { ...byName('Lord of the Nazgûl'), legalities: { commander: 'sideways' } }
    expect(toCard(raw)?.canBeCommander).toBe(false)
  })

  it('keeps both halves of a split card searchable', () => {
    const card = toCard(byName('Fire // Ice'))

    expect(card?.name).toBe('Fire // Ice')
    // Text lives on the faces; joining them keeps the role heuristics working.
    expect(card?.oracleText.length).toBeGreaterThan(0)
  })

  it('keeps the face boundary of a split card, which the join destroys', () => {
    // Fire // Ice is the case that proves it cannot be recovered afterwards:
    // Fire has one ability, Ice has two, and the join separates all three with
    // the same newline. Splitting `oracleText` would rule a line in the wrong
    // place; only the faces know where the boundary is.
    const card = toCard(byName('Fire // Ice'))

    expect(card?.oracleTextFaces).toHaveLength(2)
    expect(card?.oracleTextFaces?.[0]).toMatch(/^Fire deals/)
    expect(card?.oracleTextFaces?.[1]).toContain('\n')
    // The invariant every consumer relies on: the faces reproduce the joined
    // text exactly, so nothing derived from `oracleText` sees anything new.
    expect(card?.oracleTextFaces?.join('\n')).toBe(card?.oracleText)
    // And the joined text is still three newline-separated chunks, unmarked —
    // no sentinel was smuggled into the field the synergy regexes read.
    expect(card?.oracleText.split('\n')).toHaveLength(3)
    expect(card?.oracleText).not.toContain('//')
  })

  it('leaves a single-faced card with no faces at all', () => {
    // Not `[]`. "One face" and "not known" are both nothing to say, and an
    // empty array would instead claim the card has zero faces.
    expect(toCard(byName('Sol Ring'))?.oracleTextFaces).toBeUndefined()
  })

  it('keeps the faces of an adventure, which are halves of one physical card', () => {
    const raw = cards.find((c) => c.name.startsWith('Bonecrusher Giant'))!
    expect(toCard(raw)?.oracleTextFaces).toHaveLength(2)
  })

  it('maps a transforming double-faced card', () => {
    const card = toCard(cards.find((c) => c.layout === 'transform')!)

    expect(card).not.toBeNull()
    expect(card?.types).toContain('creature')
  })

  it('maps an adventure card, whose oracle name carries both halves', () => {
    const raw = cards.find((c) => c.name.startsWith('Bonecrusher Giant'))
    expect(raw).toBeDefined()

    const card = toCard(raw!)
    expect(card?.types).toContain('creature')
  })

  it('preserves an accented name exactly', () => {
    const raw = cards.find((c) => c.name.includes('Nazg'))!
    const card = toCard(raw)

    expect(card?.name).toBe(raw.name)
    expect(card?.name).toMatch(/û/)
  })

  it('derives a role for every fixture card, never an empty set', () => {
    for (const raw of cards) {
      const card = toCard(raw)
      if (card === null) continue
      // primaryRole falls back to `synergy`; an empty role list would break
      // composition counting silently.
      expect(card.roles.length).toBeGreaterThan(0)
      expect(card.primaryRole).toBeTruthy()
    }
  })

  it('classifies a basic land as a land', () => {
    const card = toCard(byName('Mountain'))

    expect(card?.types).toEqual(['land'])
    expect(card?.primaryRole).toBe('land')
  })

  it('returns null for a record with no oracle_id rather than inventing one', () => {
    const raw = { ...byName('Sol Ring') }
    delete (raw as { oracle_id?: string }).oracle_id

    expect(toCard(raw)).toBeNull()
    expect(skipReason(raw)).toBe('no-oracle-id')
  })

  it('rejects art-series records, which carry an oracle_id but are not cards', () => {
    // These are in the real oracle export. Their type line is "Card", so they
    // map to a card with no types that pollutes search and role counting.
    const artSeries = cards.find((c) => c.layout === 'art_series')
    expect(artSeries).toBeDefined()

    expect(skipReason(artSeries!)).toBe('non-playable-layout')
    expect(toCard(artSeries!)).toBeNull()
    expect(toPrinting(artSeries!)).toBeNull()
  })

  it('rejects a card type that cannot be in a deck, even when Scryfall calls it legal', () => {
    // Scryfall marks Unfinity sticker sheets `legal` in Commander, so a filter
    // on legality alone lets them into the candidate pool.
    const sticker = {
      ...byName('Sol Ring'),
      name: 'Ancestral Hot Dog Minotaur',
      type_line: 'Stickers',
      legalities: { commander: 'legal' },
    }

    expect(skipReason(sticker)).toBe('no-card-type')
    expect(toCard(sticker)).toBeNull()
  })

  it('every card it does map has at least one type', () => {
    for (const raw of cards) {
      const card = toCard(raw)
      if (card === null) continue
      expect(card.types.length).toBeGreaterThan(0)
    }
  })
})

describe('toPrinting', () => {
  it('maps set, rarity and a price estimate', () => {
    const printing = toPrinting(byName('Sol Ring'))

    expect(printing?.setCode.length).toBeGreaterThan(0)
    expect(printing?.rarity).toBeTruthy()
    expect(printing?.priceUsd === null || typeof printing?.priceUsd === 'number').toBe(true)
  })

  it('leaves the price null rather than zero when Scryfall has none', () => {
    const printing = toPrinting({ ...byName('Sol Ring'), prices: { usd: null } })

    // Zero would read as "free" everywhere a budget filter looks.
    expect(printing?.priceUsd).toBeNull()
  })

  it('reports the reserved list flag', () => {
    const printing = toPrinting(byName('Black Lotus'))

    expect(typeof printing?.reserved).toBe('boolean')
  })

  /*
   * Art, and the difference between two HALVES and two FACES.
   *
   * Found by playtest: 501 of the corpus's 890 `//` cards had no art anywhere,
   * because Scryfall writes `image_uris` on the card object only for a card
   * printed on ONE physical face. Split, adventure and flip cards are one face
   * carrying two halves and keep their images there; `transform` and
   * `modal_dfc` cards have two physical faces and their images live on
   * `card_faces[]`. A mapper reading only the top level ingested every one of
   * the latter with nothing to draw.
   *
   * The fixture is the whole argument, which is why these assert against the
   * recorded record rather than against pasted URLs: it holds a transform, an
   * MDFC and two splits, and they disagree about where the art is.
   */
  describe('art, which lives in two different places', () => {
    const transform = cards.find((c) => c.layout === 'transform')!
    const mdfc = cards.find((c) => c.layout === 'modal_dfc')!

    it('reads a transforming card from its front face, where Scryfall puts it', () => {
      // The record is the evidence for the rule, not just the setup.
      expect(transform.image_uris).toBeUndefined()
      const front = transform.card_faces?.[0]?.image_uris

      const printing = toPrinting(transform)
      expect(printing?.imageUris.normal).toBe(front?.['normal'])
      expect(printing?.imageUris.artCrop).toBe(front?.['art_crop'])
      // The defect said `''` here, which is how 501 cards came to have no art.
      expect(printing?.imageUris.normal).not.toBe('')
      expect(printing?.imageUris.artCrop).not.toBe('')
    })

    it('reads a modal double-faced card the same way', () => {
      expect(mdfc.image_uris).toBeUndefined()
      const printing = toPrinting(mdfc)

      expect(printing?.imageUris.normal).toBe(mdfc.card_faces?.[0]?.image_uris?.['normal'])
      expect(printing?.imageUris.normal).not.toBe('')
    })

    it('takes the FRONT face, because that is the side the card is', () => {
      // The back is a different picture with a different name on it. Drawing it
      // in a tile would show a card nobody searched for.
      const back = transform.card_faces?.[1]?.image_uris
      expect(back?.['normal']).toBeDefined()

      expect(toPrinting(transform)?.imageUris.normal).not.toBe(back?.['normal'])
    })

    it('still reads a split card from the CARD, which has one physical face', () => {
      // The regression guard on the fix: `Fire // Ice` was never broken, and a
      // blanket "read the face" would have broken it — its faces carry no
      // images at all.
      const fire = byName('Fire // Ice')
      expect(fire.card_faces?.[0]?.image_uris).toBeUndefined()

      expect(toPrinting(fire)?.imageUris.normal).toBe(fire.image_uris?.['normal'])
      expect(toPrinting(fire)?.imageUris.normal).not.toBe('')
    })

    it('leaves art empty when neither the card nor a face carries any', () => {
      // Absence stays absence. `''` is what the DB layer stores as NULL and
      // what `imageFor` reads as "draw the fallback panel".
      const bare = { ...byName('Sol Ring') }
      delete (bare as { image_uris?: unknown }).image_uris

      expect(toPrinting(bare)?.imageUris).toEqual({ artCrop: '', normal: '' })
    })
  })
})

describe('rate limits (ADR-0009 Q1)', () => {
  it('throttles search four times harder than ordinary endpoints', () => {
    expect(delayFor('/cards/search')).toBe(500)
    expect(delayFor('/cards/collection')).toBe(500)
  })

  it('uses 100 ms for everything else', () => {
    expect(delayFor('/cards/some-other-thing')).toBe(100)
  })

  it('backs off hardest on the manifest endpoint', () => {
    expect(delayFor('/cards/manifest')).toBe(6_000)
  })
})

describe('Universes Beyond provenance (ADR-0011)', () => {
  const tally = (printings: { oracle_id?: string; promo_types?: string[] }[]) => {
    const into = new Map<string, ProvenanceTally>()
    for (const p of printings) tallyPrinting(into, { id: 'x', name: 'n', ...p })
    return into
  }

  it('marks a card whose every printing is Universes Beyond', () => {
    const t = tally([
      { oracle_id: 'a', promo_types: ['universesbeyond'] },
      { oracle_id: 'a', promo_types: ['universesbeyond', 'boosterfun'] },
    ])

    expect(isUniversesBeyondCard(t.get('a'))).toBe(true)
  })

  it('does NOT mark a card with even one ordinary printing', () => {
    // This is the Sol Ring case. Scryfall's oracle export picked a Marvel
    // Commander printing for it, so trusting a single printing would have
    // dropped Sol Ring out of every deck.
    const t = tally([
      { oracle_id: 'sol', promo_types: ['surgefoil', 'universesbeyond'] },
      { oracle_id: 'sol', promo_types: [] },
    ])

    expect(isUniversesBeyondCard(t.get('sol'))).toBe(false)
  })

  it('does not mark a card with no printings at all', () => {
    // An empty tally must not read as "all of its printings are UB".
    expect(isUniversesBeyondCard(undefined)).toBe(false)
    expect(isUniversesBeyondCard({ total: 0, universesBeyond: 0 })).toBe(false)
  })

  it('ignores printings with no oracle id', () => {
    const t = tally([{ promo_types: ['universesbeyond'] }])

    expect(t.size).toBe(0)
  })

  it('defaults a mapped card to not-Universes-Beyond when provenance is unknown', () => {
    // Safe direction: an unknown card stays visible rather than vanishing.
    expect(toCard(byName('Sol Ring'))?.universesBeyond).toBe(false)
  })

  it('carries provenance the caller computed', () => {
    expect(toCard(byName('Sol Ring'), { universesBeyond: true })?.universesBeyond).toBe(true)
  })
})

describe('the Game Changers flag (DATA-05)', () => {
  /*
   * Both fixtures are real Scryfall records, and both are on Wizards' list as of
   * 2026-08-30. The list is not written down anywhere in this repository — it is
   * read from `game_changer` on the records we already download — so these
   * assertions are about the mapping, never about which cards belong.
   */
  it('maps a card Scryfall flags as a Game Changer', () => {
    expect(toCard(byName('Rhystic Study'))?.gameChanger).toBe(true)
  })

  it('maps a multi-faced Game Changer', () => {
    // Wizards lists "Tergrid, God of Fright"; Scryfall names the record with
    // both faces. Nothing has to reconcile the two spellings because the flag
    // travels with the record rather than being matched by name — which is the
    // whole reason this comes from the corpus and not a checked-in array.
    expect(toCard(byName("Tergrid, God of Fright // Tergrid's Lantern"))?.gameChanger).toBe(true)
  })

  it('leaves an ordinary card unflagged', () => {
    expect(toCard(byName('Sol Ring'))?.gameChanger).toBe(false)
    expect(toCard(byName('Cultivate'))?.gameChanger).toBe(false)
  })

  it('does not read a banned card as a Game Changer', () => {
    // Black Lotus is banned, not listed. Conflating the two would flag a card
    // the deck cannot legally hold and miss the flag on one it can.
    expect(toCard(byName('Black Lotus'))?.gameChanger).toBe(false)
  })

  it('reads a record with no game_changer field as unflagged', () => {
    // An older mirror predating the field. `false` is the safe direction: it
    // under-reports rather than accusing a deck of holding a Game Changer.
    const { game_changer: flag, ...withoutField } = byName('Rhystic Study')
    // Guards the test itself: if the fixture ever stops carrying the field, the
    // assertion below would pass for the wrong reason.
    expect(flag).toBe(true)
    expect(toCard(withoutField)?.gameChanger).toBe(false)
  })
})

/**
 * The commander search, against RECORDED pages (AGENTS.md §4).
 *
 * Three real `/cards/search` responses, captured from
 * `is:commander legal:commander&unique=cards` and trimmed to a handful of
 * entries each. Everything except `data` is exactly as Scryfall sent it — the
 * `next_page` links, `has_more`, and the 3,411 `total_cards` — because those
 * envelope fields are the whole of what the pager reads.
 *
 * The cards kept in them are the ones that matter. Grist the derivation gets
 * right; Heart of Kiran it gets wrong, and wrong in the direction nobody
 * expects — a legendary Vehicle that reads like a bad commander, which Scryfall
 * lists anyway.
 */
const searchPage = (name: string): unknown =>
  JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', name), 'utf8'),
  )

const PAGE_1 = searchPage('scryfall-commander-search-page1.json')
const PAGE_2 = searchPage('scryfall-commander-search-page2.json')
const PAGE_LAST = searchPage('scryfall-commander-search-last.json')

/** Heart of Kiran and Grist, by the oracle ids the fixtures carry. */
const HEART_OF_KIRAN = 'e2ee410f-2467-4f1f-84a0-8a79faedc0b3'
const GRIST = '0efb0d7e-dea0-4817-a243-15066e9ef333'

interface Recorded {
  readonly urls: string[]
  readonly agents: (string | null)[]
  readonly sleeps: number[]
  readonly fetchImpl: typeof fetch
  readonly sleepImpl: (ms: number) => Promise<void>
}

/**
 * A fetch that serves a queue of recorded pages, and a sleep that records
 * rather than waits.
 *
 * The pages are served in order rather than keyed by URL: each fixture is a
 * real response, and sequencing them is the test's job. Which link the client
 * actually followed is asserted separately, off `urls`.
 */
const recorder = (pages: readonly unknown[], status = 200): Recorded => {
  const urls: string[] = []
  const agents: (string | null)[] = []
  const sleeps: number[] = []
  let index = 0
  return {
    urls,
    agents,
    sleeps,
    fetchImpl: ((input: string, init?: { headers?: Record<string, string> }) => {
      urls.push(String(input))
      agents.push(init?.headers?.['User-Agent'] ?? null)
      const body = pages[Math.min(index, pages.length - 1)]
      index += 1
      return Promise.resolve({
        ok: status >= 200 && status < 300,
        status,
        json: () => Promise.resolve(body),
      } as unknown as Response)
    }) as unknown as typeof fetch,
    sleepImpl: (ms: number) => {
      sleeps.push(ms)
      return Promise.resolve()
    },
  }
}

describe('fetchCommanderOracleIds', () => {
  it('walks every page and keeps the oracle id from each entry', async () => {
    const rec = recorder([PAGE_1, PAGE_2, PAGE_LAST])

    const set = await fetchCommanderOracleIds(rec)

    expect(set.pages).toBe(3)
    expect(set.oracleIds.size).toBe(11)
    expect(set.oracleIds.has(GRIST)).toBe(true)
    // Reported so the caller can sanity-check the shape of what it got.
    expect(set.totalCards).toBe(3411)
  })

  it('carries the answer the oracle text cannot give', async () => {
    // Heart of Kiran is a Legendary Artifact — Vehicle. `deriveCanBeCommander`
    // says no, because nothing on the card says otherwise, and Scryfall says
    // yes. This is the entire reason the fetch exists.
    const rec = recorder([PAGE_1, PAGE_2, PAGE_LAST])

    const set = await fetchCommanderOracleIds(rec)

    expect(set.oracleIds.has(HEART_OF_KIRAN)).toBe(true)
    expect(
      deriveCanBeCommander({
        typeLine: 'Legendary Artifact — Vehicle',
        oracleText: 'Flying\nWhenever Heart of Kiran becomes tapped, ...\nCrew 3',
        legalities: { commander: 'legal' },
      }),
    ).toBe(false)
  })

  it('asks for one row per card, not one per printing', async () => {
    const rec = recorder([PAGE_LAST])

    await fetchCommanderOracleIds(rec)

    // Without `unique=cards` Scryfall returns a row per printing and the twenty
    // pages become several hundred — the crawl ADR-0009 Q3 forbids.
    expect(rec.urls[0]).toContain('unique=cards')
    expect(rec.urls[0]).toContain(encodeURIComponent('is:commander legal:commander'))
  })

  it('follows the next_page Scryfall gives rather than building its own', async () => {
    const rec = recorder([PAGE_1, PAGE_LAST])

    await fetchCommanderOracleIds(rec)

    // Scryfall's link carries `order`, `include_extras` and the page number.
    // Reconstructing that from a page counter is how a pager drifts from the
    // cursor the server actually issued.
    expect(rec.urls[1]).toBe((PAGE_1 as { next_page: string }).next_page)
  })

  it('identifies this application on every request (ADR-0009 Q2)', async () => {
    const rec = recorder([PAGE_1, PAGE_LAST])

    await fetchCommanderOracleIds({ ...rec, userAgent: 'LotusWizard/9.9 (test)' })

    expect(rec.agents).toEqual(['LotusWizard/9.9 (test)', 'LotusWizard/9.9 (test)'])
  })

  it('paces the pages at the 2/s ADR-0009 sets for search', async () => {
    const rec = recorder([PAGE_1, PAGE_2, PAGE_LAST])

    await fetchCommanderOracleIds(rec)

    // Three pages, two gaps: there is nothing to space the first request from.
    // Read off `delayFor` rather than written here a second time.
    expect(rec.sleeps).toEqual([500, 500])
    expect(rec.sleeps[0]).toBe(delayFor('/cards/search'))
  })

  it('throws on a failed page rather than returning a partial set', async () => {
    // The dangerous failure. A short set looks exactly like a complete one at
    // the call site, and writing it would mark thousands of real commanders
    // ineligible — so there must be no way to receive one.
    const rec = recorder([PAGE_1], 503)

    await expect(fetchCommanderOracleIds(rec)).rejects.toThrow(/503/)
  })

  it('throws rather than paging forever when has_more never clears', async () => {
    // PAGE_1 always says `has_more`, so this would loop until the process died
    // inside a deploy-time command.
    const rec = recorder([PAGE_1])

    await expect(fetchCommanderOracleIds(rec)).rejects.toThrow(/exceeded/)
    expect(rec.urls.length).toBeLessThanOrEqual(100)
  })
})

describe('toCard commander provenance', () => {
  const vehicle: ScryfallCard = {
    id: '00000000-0000-0000-0000-0000000000aa',
    oracle_id: HEART_OF_KIRAN,
    name: 'Heart of Kiran',
    type_line: 'Legendary Artifact — Vehicle',
    oracle_text: 'Flying\nCrew 3',
    legalities: { commander: 'legal' },
  }

  it('takes Scryfall’s yes over the derivation’s no', () => {
    // The 31 Vehicles and Spacecraft this whole follow-up exists for.
    expect(toCard(vehicle)?.canBeCommander).toBe(false)
    expect(toCard(vehicle, { canBeCommander: true })?.canBeCommander).toBe(true)
  })

  it('takes Scryfall’s no over the derivation’s yes', () => {
    // `??`, not `||`. A fetched `false` is an answer; falling through to the
    // derivation on it would put the two sources back in disagreement on
    // exactly the cards where they differ.
    const legend = byName('Lord of the Nazgûl')
    expect(toCard(legend)?.canBeCommander).toBe(true)
    expect(toCard(legend, { canBeCommander: false })?.canBeCommander).toBe(false)
  })

  it('falls back to the derivation when the search did not answer', () => {
    // An ingest that could not reach the search still has to write something,
    // and the derivation agrees with Scryfall on 3,380 of 3,411. Writing nothing
    // would leave the API unable to refuse Sol Ring again.
    expect(toCard(byName('Lord of the Nazgûl'), { universesBeyond: false })?.canBeCommander).toBe(
      true,
    )
    expect(toCard(byName('Sol Ring'), {})?.canBeCommander).toBe(false)
  })
})
