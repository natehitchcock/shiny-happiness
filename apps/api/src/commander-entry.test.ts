import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, databaseUrl, type TestDatabase } from '@roundtable/db/testing'
import { upsertCards } from '@roundtable/db'
import type { Card, CardType, OracleId, SynergyTag } from '@roundtable/domain'
import { oracleId, printingId } from '@roundtable/domain'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'
import { clearCorpusCache } from './corpus-cache.js'

/**
 * The two entry routes' contract (ADR-0067, doc 10 §10.6).
 *
 * Against a REAL Postgres (AGENTS.md §4); skips loudly without one. This file
 * IS in `vitest.config.ts`'s literal `DATABASE_SUITES` list — a database suite
 * left out of it runs in the parallel project, where six `CREATE DATABASE`
 * statements queue against one cluster and the symptom is a hook timeout in a
 * different file on every run.
 *
 * ## Why this suite is not flaky, given that both routes are "random"
 *
 * Neither endpoint holds any randomness. The quickdraw seed is a REQUIRED query
 * parameter, so a test that passes one gets the same three commanders every
 * time, and the sampler being exercised is the shipped sampler rather than a
 * stub. Nothing here is mocked — the corpus below is real rows in a real table.
 *
 * ## The corpus
 *
 * Built to make each threshold fail on its own axis, because a fixture where
 * every tag passes or fails for the same reason cannot tell the two floors
 * apart:
 *
 *   landfall       200 cards,  25 commanders  → qualifies
 *   treasure       200 cards,   9 commanders  → too few commanders
 *   token           69 cards,  30 commanders  → too few supporting cards
 *   subtype:elf    160 cards,  22 commanders  → qualifies, and it is TRIBAL
 *   subtype:human    0 cards,  50 commanders  → invisible: membership only
 *
 * The two REFUSED families sit one under their floor rather than comfortably
 * below it — 9 against 10, and 69 against 70 — because a fixture that fails a
 * threshold by a wide margin cannot tell a floor that moved from a floor that
 * stopped being applied. ADR-0068 moved these floors from 20/150 to 10/70 and
 * both of these families passed the new ones on the old numbers, which is
 * exactly the silent green this shape exists to prevent.
 */
const hasDatabase = databaseUrl() !== null
const describeDb = hasDatabase ? describe : describe.skip

if (!hasDatabase) {
  console.warn('[api] DATABASE_URL not set — skipping commander-entry tests (AGENTS.md §4)')
}

const tags = (...t: string[]): readonly SynergyTag[] => t as SynergyTag[]

const card = (name: string, opts: Partial<Card> = {}): Card => ({
  oracleId: oracleId(randomUUID()),
  name,
  manaCost: '{2}{G}',
  manaValue: 3,
  colorIdentity: ['G'],
  colors: ['G'],
  typeLine: 'Creature — Beast',
  types: ['creature'] as readonly CardType[],
  oracleText: '',
  power: '2',
  toughness: '2',
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(randomUUID()),
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
  gameChanger: false,
  ...opts,
})

/**
 * `count` cards carrying `tag`, of which `commanders` may lead a deck.
 *
 * The commanders get a rank inside the familiar cut so the quickdraw pool has
 * something to deal from; everything else is deliberately unranked, which the
 * draw must treat as "not familiar" rather than "rank zero".
 */
const family = (
  label: string,
  tag: string,
  count: number,
  commanders: number,
  direction: 'produces' | 'wants' = 'produces',
): Card[] =>
  Array.from({ length: count }, (_, i) =>
    card(`${label} ${String(i).padStart(3, '0')}`, {
      ...(direction === 'produces' ? { synergyProduces: tags(tag) } : { synergyWants: tags(tag) }),
      ...(i < commanders
        ? {
            canBeCommander: true,
            typeLine: 'Legendary Creature — Beast',
            edhrecRank: 100 + i,
          }
        : {}),
    }),
  )

const TWO_OF_TWO = 'Zzyzx, Both At Once'
const POPULAR_ONE = 'Zzz, The Famous One'
const OBSCURE_ONE = 'Aaa, The Forgotten One'

describeDb('commander entry — semantics and quickdraw (ADR-0067)', () => {
  let db: TestDatabase
  let app: FastifyInstance

  beforeAll(async () => {
    db = await createTestDatabase('commander_entry')
    await upsertCards(db.pool, [
      ...family('Landfall', 'landfall', 200, 25),
      ...family('Treasure', 'treasure', 200, 9),
      ...family('Token', 'token', 69, 30),
      ...family('Elfish', 'subtype:elf', 160, 22, 'wants'),

      /*
       * MEMBERSHIP ONLY. Fifty Legendary Creature — Humans with no
       * `produces`/`wants` semantic at all: `toCard` derives `subtype:human`
       * onto every one of them from the type line, and none of it may reach
       * this screen. These stand in for the 307 real commanders that carry no
       * semantic — they must be invisible to Route 1 and dealable by Route 2.
       */
      ...Array.from({ length: 50 }, (_, i) =>
        card(`Human ${String(i).padStart(3, '0')}`, {
          typeLine: 'Legendary Creature — Human Wizard',
          canBeCommander: true,
          edhrecRank: 20000 + i,
        }),
      ),

      // A commander that carries BOTH picks, named so that a name-first sort
      // would put it last.
      card(TWO_OF_TWO, {
        typeLine: 'Legendary Creature — Elf Druid',
        canBeCommander: true,
        synergyProduces: tags('landfall'),
        synergyWants: tags('subtype:elf'),
        edhrecRank: 7000,
      }),
      // One pick each, and their ranks are the opposite of their names.
      card(POPULAR_ONE, {
        typeLine: 'Legendary Creature — Beast',
        canBeCommander: true,
        synergyProduces: tags('landfall'),
        edhrecRank: 1,
      }),
      card(OBSCURE_ONE, {
        typeLine: 'Legendary Creature — Beast',
        canBeCommander: true,
        synergyProduces: tags('landfall'),
        edhrecRank: 30000,
      }),

      // Not legal, and carrying a qualifying tag. Must be counted nowhere.
      card('Banned Beast', {
        legalities: { commander: 'banned' },
        canBeCommander: true,
        synergyProduces: tags('landfall'),
      }),
    ])
    app = await buildServer({ pool: db.pool })
    clearCorpusCache()
  }, 60_000)

  afterAll(async () => {
    clearCorpusCache()
    await app.close()
    await db.drop()
  })

  /* ------------------------------------------------- GET /commanders/semantics */

  describe('GET /api/v1/commanders/semantics', () => {
    interface Offer {
      readonly tag: string
      readonly category: string
      readonly commanders: number
      readonly supporting: number
    }

    const offers = async (): Promise<readonly Offer[]> => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/commanders/semantics' })
      expect(res.statusCode).toBe(200)
      return (res.json() as { offers: readonly Offer[] }).offers
    }

    it('offers a tag that clears both floors', async () => {
      expect((await offers()).map((o) => o.tag)).toContain('landfall')
    })

    it('refuses a deck nobody can lead — 200 cards, 9 commanders', async () => {
      expect((await offers()).map((o) => o.tag)).not.toContain('treasure')
    })

    it('refuses a deck nobody can fill — 30 commanders, 69 cards', async () => {
      expect((await offers()).map((o) => o.tag)).not.toContain('token')
    })

    it('KEEPS TRIBAL: a subtype reached through cards that care about it', async () => {
      // The thing a reader will assume dropping `has` dropped. It does not:
      // 22 commanders WANT Elves and 160 cards carry the tag, so the tribe is
      // offered — through cards that care about Elves rather than cards that
      // are Elves, which is the right sense of the word for this screen.
      // 22 from the Elfish family plus the one commander that carries both
      // picks, and 160 cards plus that same one.
      const elf = (await offers()).find((o) => o.tag === 'subtype:elf')
      expect(elf).toMatchObject({ category: 'type', commanders: 23, supporting: 161 })
    })

    it('NEVER offers membership: 50 Human commanders do not make Human a semantic', async () => {
      expect((await offers()).map((o) => o.tag)).not.toContain('subtype:human')
    })

    it('counts a banned card nowhere', async () => {
      // 203 legal landfall cards — the family of 200 and the three named
      // commanders — plus one banned one. If legality were not filtered this
      // would read 204 and 29.
      const landfall = (await offers()).find((o) => o.tag === 'landfall')
      expect(landfall).toMatchObject({ commanders: 28, supporting: 203 })
    })

    it('orders mechanics before types, so the offer is stable across draws', async () => {
      const shown = (await offers()).map((o) => o.category)
      expect(shown.indexOf('mechanics')).toBeLessThan(shown.indexOf('type'))
      // No mechanics tag after the first type tag.
      expect(shown.lastIndexOf('mechanics')).toBeLessThan(shown.indexOf('type'))
    })

    it('carries the dataset snapshot, like every corpus-bearing response', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/commanders/semantics' })
      expect(res.json()).toHaveProperty('datasetSnapshotId')
    })
  })

  /* ---------------------------------------------- GET /commanders/by-semantics */

  describe('GET /api/v1/commanders/by-semantics', () => {
    const pick = async (
      query: string,
    ): Promise<{
      items: { oracleId: string; name: string }[]
      matches: Record<string, number>
      total: number
      images: Record<string, unknown>
    }> => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/commanders/by-semantics?${query}`,
      })
      expect(res.statusCode).toBe(200)
      return res.json() as never
    }

    it('ranks two-of-two ahead of one-of-two', async () => {
      const { items, matches } = await pick('tags=landfall,subtype:elf&limit=200')
      expect(items[0]?.name).toBe(TWO_OF_TWO)
      expect(matches[items[0]?.oracleId ?? '']).toBe(2)
      // …and it is FIRST despite sorting last by name, which is the only way to
      // tell the match count is doing the work.
      expect(items[1]?.name).not.toBe(TWO_OF_TWO)
    })

    it('breaks ties by name and not by popularity', async () => {
      const { items } = await pick('tags=landfall&limit=200')
      const names = items.map((i) => i.name)
      // Rank 30,000 ahead of rank 1, because A precedes Z. A popularity
      // tiebreak would invert exactly this pair.
      expect(names.indexOf(OBSCURE_ONE)).toBeLessThan(names.indexOf(POPULAR_ONE))
      expect(names[0]).toBe(OBSCURE_ONE)
    })

    it('never surfaces a commander that carries no semantic at all', async () => {
      const { items } = await pick('tags=landfall,subtype:elf&limit=200')
      expect(items.filter((i) => i.name.startsWith('Human '))).toEqual([])
    })

    it('never matches on membership — an Elf that only IS one is absent', async () => {
      const { items } = await pick('tags=subtype:elf&limit=200')
      // Every Human fixture derives `subtype:human` and none derives elf; the
      // Elf-wanting family is what comes back.
      expect(items.every((i) => i.name.startsWith('Elfish') || i.name === TWO_OF_TWO)).toBe(true)
    })

    it('returns only commanders', async () => {
      const { items, total } = await pick('tags=landfall&limit=200')
      // 25 Landfall commanders + the three named ones. The other 175 landfall
      // cards are not commanders and the banned one is not legal.
      expect(total).toBe(28)
      expect(items).toHaveLength(28)
    })

    it('reports a total larger than the page it returned', async () => {
      const { items, total } = await pick('tags=landfall&limit=5')
      expect(items).toHaveLength(5)
      expect(total).toBe(28)
    })

    it('cuts the page on the match count, so the best matches survive the limit', async () => {
      const { items } = await pick('tags=landfall,subtype:elf&limit=1')
      expect(items.map((i) => i.name)).toEqual([TWO_OF_TWO])
    })

    it('sends art beside the cards, with an entry for every id', async () => {
      const { items, images } = await pick('tags=landfall&limit=5')
      for (const item of items) expect(images).toHaveProperty(item.oracleId)
    })

    it('rejects a tag the vocabulary does not know', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/commanders/by-semantics?tags=landfall,not-a-real-tag',
      })
      // Rejected rather than silently narrowed to `landfall`: a quietly dropped
      // filter answers a different question and looks like a success.
      expect(res.statusCode).toBe(400)
    })

    it('rejects a request with no tags at all', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/commanders/by-semantics' })
      expect(res.statusCode).toBe(400)
    })
  })

  /* -------------------------------------------------- GET /commanders/quickdraw */

  describe('GET /api/v1/commanders/quickdraw', () => {
    const deal = async (
      seed: string,
    ): Promise<{
      items: { oracleId: string; name: string; edhrecRank: number | null }[]
      wildcard: string | null
      seed: string
    }> => {
      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/commanders/quickdraw?seed=${encodeURIComponent(seed)}`,
      })
      expect(res.statusCode).toBe(200)
      return res.json() as never
    }

    it('deals three commanders', async () => {
      const hand = await deal('a-seed')
      expect(hand.items).toHaveLength(3)
      for (const item of hand.items) expect(item.name).not.toBe(undefined)
    })

    it('deals the same three for the same seed', async () => {
      // The property the whole design exists for. `ORDER BY random()` could not
      // pass this line, and mocking the sampler would make it vacuous.
      const first = await deal('reproducible')
      const again = await deal('reproducible')
      expect(again.items.map((i) => i.name)).toEqual(first.items.map((i) => i.name))
    })

    it('deals a different hand on a reroll', async () => {
      const hands = new Set<string>()
      for (const seed of ['s1', 's2', 's3', 's4', 's5', 's6']) {
        hands.add((await deal(seed)).items.map((i) => i.name).join('|'))
      }
      expect(hands.size).toBeGreaterThan(3)
    })

    it('draws two of the three from the familiar cut', async () => {
      for (const seed of ['f1', 'f2', 'f3', 'f4', 'f5']) {
        const hand = await deal(seed)
        const familiar = hand.items.filter((i) => i.edhrecRank !== null && i.edhrecRank <= 5000)
        expect(familiar.length).toBeGreaterThanOrEqual(2)
      }
    })

    it('names the wildcard rather than leaving the client to count to three', async () => {
      const hand = await deal('wildcard')
      expect(hand.wildcard).not.toBeNull()
      expect(hand.items.at(-1)?.oracleId).toBe(hand.wildcard)
    })

    it('lets the wildcard reach past the familiar cut', async () => {
      // 25 familiar commanders against 387 in all. If the wildcard were drawn
      // from the familiar pool this would never fire.
      let beyond = 0
      for (let i = 0; i < 25; i += 1) {
        const hand = await deal(`beyond-${String(i)}`)
        const wild = hand.items.find((item) => item.oracleId === hand.wildcard)
        if (wild !== undefined && (wild.edhrecRank === null || wild.edhrecRank > 5000)) beyond += 1
      }
      expect(beyond).toBeGreaterThan(0)
    })

    it('can deal a commander that carries no semantic at all', async () => {
      // Route 1 must never show these; Route 2 may. They are legal commanders.
      let dealt = 0
      for (let i = 0; i < 25; i += 1) {
        const hand = await deal(`human-${String(i)}`)
        if (hand.items.some((item) => item.name.startsWith('Human '))) dealt += 1
      }
      expect(dealt).toBeGreaterThan(0)
    })

    it('never deals the same commander twice in one hand', async () => {
      for (let i = 0; i < 25; i += 1) {
        const hand = await deal(`dup-${String(i)}`)
        expect(new Set(hand.items.map((item) => item.oracleId)).size).toBe(hand.items.length)
      }
    })

    it('deals no card that cannot lead a deck', async () => {
      const legal = new Set<string>()
      const { rows } = await db.pool.query<{ oracle_id: string }>(
        `SELECT oracle_id FROM cards WHERE can_be_commander IS TRUE AND legality_commander = 'legal'`,
      )
      for (const row of rows) legal.add(row.oracle_id)
      for (let i = 0; i < 15; i += 1) {
        for (const item of (await deal(`legal-${String(i)}`)).items) {
          expect(legal.has(item.oracleId)).toBe(true)
        }
      }
    })

    it('echoes the seed, so a hand can be linked to and reproduced', async () => {
      expect((await deal('echo-me')).seed).toBe('echo-me')
    })

    it('refuses a draw with no seed', async () => {
      // Required on purpose: a fallback would be a second code path that only
      // production ever takes.
      const res = await app.inject({ method: 'GET', url: '/api/v1/commanders/quickdraw' })
      expect(res.statusCode).toBe(400)
    })

    it('sends art beside the cards', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/commanders/quickdraw?seed=art',
      })
      const body = res.json() as {
        items: { oracleId: OracleId }[]
        images: Record<string, unknown>
      }
      for (const item of body.items) expect(body.images).toHaveProperty(item.oracleId)
    })
  })
})
