import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, databaseUrl, type TestDatabase } from '@roundtable/db/testing'
import { createDeck, insertCombos, upsertCards } from '@roundtable/db'
import type { Card, CardType, Combo, OracleId } from '@roundtable/domain'
import { comboId, deckId, oracleId, printingId } from '@roundtable/domain'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'

/**
 * Contract tests for API-02 against doc 10 §10.4 and §10.5.
 *
 * Real Postgres (AGENTS.md §4); SKIP loudly without one.
 */
const hasDatabase = databaseUrl() !== null
const describeDb = hasDatabase ? describe : describe.skip

if (!hasDatabase) {
  console.warn('[api] DATABASE_URL not set — skipping API-02 contract tests (AGENTS.md §4)')
}

const KROV = oracleId(randomUUID())
const PIECE_A = oracleId(randomUUID())
const PIECE_B = oracleId(randomUUID())
const RAMP = oracleId(randomUUID())
const LAND = oracleId(randomUUID())
const OFF_COLOR = oracleId(randomUUID())
const BAD_COMMANDER = oracleId(randomUUID())
const UNDECIDED = oracleId(randomUUID())
/**
 * Four cards flagged as Game Changers (DATA-05).
 *
 * Four because Bracket 3 allows three: three of them is the boundary that must
 * pass and four is the one that must fail, and a fixture with fewer could not
 * tell those apart.
 */
const GAME_CHANGERS = [0, 1, 2, 3].map(() => oracleId(randomUUID()))
/** A legendary Game Changer, so the command zone can be checked too. */
const GC_COMMANDER = oracleId(randomUUID())

const card = (id: OracleId, name: string, opts: Partial<Card> = {}): Card => ({
  oracleId: id,
  name,
  manaCost: opts.manaCost ?? '{1}{R}',
  manaValue: opts.manaValue ?? 2,
  colorIdentity: opts.colorIdentity ?? ['R'],
  colors: opts.colors ?? ['R'],
  typeLine: opts.typeLine ?? 'Creature — Goblin',
  types: (opts.types ?? ['creature']) as readonly CardType[],
  oracleText: opts.oracleText ?? '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  // Absent unless the fixture says otherwise, which is the pre-re-ingest state
  // of every row in the real corpus and the one the analysis endpoint has to
  // report rather than rule on.
  ...(opts.canBeCommander === undefined ? {} : { canBeCommander: opts.canBeCommander }),
  edhrecRank: opts.edhrecRank ?? null,
  defaultPrinting: printingId(randomUUID()),
  roles: opts.roles ?? ['synergy'],
  primaryRole: opts.primaryRole ?? 'synergy',
  universesBeyond: false,
  gameChanger: opts.gameChanger ?? false,
  synergyProduces: [],
  synergyWants: [],
})

describeDb('API-02 contract', () => {
  let db: TestDatabase
  let app: FastifyInstance
  let deck: { id: string; version: number }

  beforeAll(async () => {
    db = await createTestDatabase('api02')
    await upsertCards(db.pool, [
      card(KROV, 'Krovax', {
        typeLine: 'Legendary Creature — Vampire',
        colorIdentity: ['R'],
        canBeCommander: true,
      }),
      // The production defect, preserved as a row: a deck already exists with
      // this in the command zone, and creation now refuses it, so the only way
      // to reach the analysis path is a deck written straight to the database.
      card(BAD_COMMANDER, 'Sol Ring', {
        typeLine: 'Artifact',
        types: ['artifact'],
        colorIdentity: [],
        colors: [],
        canBeCommander: false,
      }),
      // Deliberately undecided: a row the re-ingest behind migration 0010 has
      // not reached.
      card(UNDECIDED, 'Legend of Unknown Eligibility', {
        typeLine: 'Legendary Creature — Wizard',
      }),
      card(PIECE_A, 'Combo Piece A'),
      card(PIECE_B, 'Combo Piece B'),
      card(RAMP, 'Ramp Rock', {
        typeLine: 'Artifact',
        types: ['artifact'],
        roles: ['ramp'],
        primaryRole: 'ramp',
        universesBeyond: false,
        synergyProduces: [],
        synergyWants: [],
        colorIdentity: [],
        colors: [],
      }),
      card(LAND, 'Mountain', {
        typeLine: 'Basic Land — Mountain',
        roles: ['land'],
        primaryRole: 'land',
        universesBeyond: false,
        synergyProduces: [],
        synergyWants: [],
        manaCost: null,
        manaValue: 0,
        types: ['land'],
      }),
      card(OFF_COLOR, 'Blue Thing', { colorIdentity: ['U'], colors: ['U'] }),
      ...GAME_CHANGERS.map((id, index) => card(id, `Game Changer ${index}`, { gameChanger: true })),
      card(GC_COMMANDER, 'Tergrid, Test Legend', {
        typeLine: 'Legendary Creature — God',
        gameChanger: true,
      }),
    ])
    const combo: Combo = {
      id: comboId('combo-1'),
      pieces: [PIECE_A, PIECE_B],
      prerequisites: '',
      steps: [],
      produces: ['infinite-mana'],
      colorIdentity: ['R'],
    }
    await insertCombos(db.pool, [combo])

    app = await buildServer({ pool: db.pool })
    await app.ready()

    deck = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/decks',
        payload: {
          name: 'Analysis deck',
          commanders: [KROV],
          targetBracket: 3,
          archetype: 'midrange',
        },
      })
    ).json()
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await db?.drop()
  }, 60_000)

  describe('POST /api/v1/decks/:id/recommendations', () => {
    it('returns groups, each item carrying non-empty reasons (pillar P4)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${deck.id}/recommendations`,
        payload: {},
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(Array.isArray(body.groups)).toBe(true)
      for (const group of body.groups) {
        for (const item of group.items) {
          // A recommendation the user cannot interrogate is a bug (AGENTS.md §8).
          expect(item.reasons.length).toBeGreaterThan(0)
        }
      }
    })

    it('never recommends an off-colour card', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: {},
        })
      ).json()

      const suggested = body.groups.flatMap((g: { items: { oracleId: string }[] }) =>
        g.items.map((i) => i.oracleId),
      )
      expect(suggested).not.toContain(OFF_COLOR)
    })

    it('reports every missing source in `unavailable` rather than omitting groups', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: {},
        })
      ).json()

      const keys = body.unavailable.map((u: { key: string }) => u.key)
      // Corpus statistics have no source at all (ADR-0008) — the client must be
      // told, not left to infer it from an absent group.
      expect(keys).toContain('statistics')
      const stats = body.unavailable.find((u: { key: string }) => u.key === 'statistics')
      expect(stats.reason).toMatch(/ADR-0008/)
    })

    it('returns an unfiltered result plus errors when the query does not parse', async () => {
      const unfiltered = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: {},
        })
      ).json()

      // Half of this parses. Applying that half would filter the pool to
      // creatures and look like a correct, smaller answer — the exact failure
      // doc 10 §10.4 forbids. The totals must match the unfiltered run.
      const partial = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: { query: 'is:creature typ:creature' },
        })
      ).json()

      expect(partial.query.errors.length).toBeGreaterThan(0)
      expect(partial.query.errors[0]).toHaveProperty('position')

      const totals = (b: { groups: { key: string; total: number }[] }) =>
        Object.fromEntries(b.groups.map((g) => [g.key, g.total]))
      expect(totals(partial)).toEqual(totals(unfiltered))
      expect(
        Object.values(partial.query.withheldByGroup as Record<string, number>).reduce(
          (a, b) => a + b,
          0,
        ),
      ).toBe(0)
    })

    it('reports withheldByGroup so a filtered-out card is never silently absent', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: { query: 'zzzznothing' },
        })
      ).json()

      expect(body.query.errors).toEqual([])
      expect(body.query).toHaveProperty('withheldByGroup')
      const withheld = Object.values(body.query.withheldByGroup) as number[]
      expect(withheld.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    })

    it('honours limitPerGroup', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: { limitPerGroup: 1 },
        })
      ).json()

      for (const group of body.groups) expect(group.items.length).toBeLessThanOrEqual(1)
    })

    it('answers 404 for a deck that does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${randomUUID()}/recommendations`,
        payload: {},
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('GET /api/v1/decks/:id/combo-index', () => {
    it('reports a non-zero degree for a card that completes a combo', async () => {
      const fresh = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/decks',
          payload: {
            name: 'Combo deck',
            commanders: [KROV],
            targetBracket: 3,
            archetype: 'combo',
          },
        })
      ).json()
      await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${fresh.id}/commands`,
        payload: {
          commands: [{ type: 'accept', oracleId: PIECE_A, origin: 'manual' }],
          idempotencyKey: randomUUID(),
          baseVersion: 1,
        },
      })

      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/combo-index` })
      ).json()

      // With A accepted, B now completes combo-1.
      expect(body.comboDegreeByOracleId[PIECE_B]).toBeGreaterThan(0)
    })
  })

  describe('GET /api/v1/decks/:id/analysis', () => {
    it('returns counts, targets, deficits and an archetype assessment', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/decks/${deck.id}/analysis`,
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.counts.total).toBeGreaterThan(0)
      expect(body.targets.length).toBeGreaterThan(0)
      expect(body.archetype.declared).toBe('midrange')
      expect(body.archetype).toHaveProperty('assessed')
      expect(body.archetype).toHaveProperty('drivers')
      expect(body.curve).toHaveProperty('averageManaValue')
      expect(body.colorBalance.pips).toHaveProperty('R')
    })

    it('reports a land deficit for a deck with no lands', async () => {
      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}/analysis` })
      ).json()

      const land = body.deficits.find(
        (d: { dimension: { role?: string } }) => d.dimension.role === 'land',
      )
      expect(land).toBeDefined()
      expect(land.delta).toBeLessThan(0)
    })

    it('does not assert a bracket verdict it has no rules for', async () => {
      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}/analysis` })
      ).json()

      // Wizards publishes a per-bracket value for one barometer of five
      // (DATA-05), so which bracket a deck IS still cannot be decided. Guessing
      // is what AGENTS.md §8 rejects: `assessed` is null and the gap is named.
      expect(body.bracket.target).toBe(3)
      expect(body.bracket.assessed).toBeNull()
      const keys = body.unavailable.map((u: { key: string }) => u.key)
      expect(keys).toContain('bracket-assessment')
    })

    it('checks commander eligibility rather than declaring it unavailable', async () => {
      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}/analysis` })
      ).json()

      const keys = body.unavailable.map((u: { key: string }) => u.key)
      // The endpoint used to admit here that it skipped these checks entirely.
      expect(keys).not.toContain('commander-legality')
      expect(keys).not.toContain('commander-eligibility')
      const kinds = body.legality.problems.map((p: { kind: string }) => p.kind)
      expect(kinds).not.toContain('invalid-commander')
    })

    it('reports a deck already led by an ineligible card', async () => {
      /*
       * Written straight to the database, because the creation route refuses
       * this now — and that is exactly the deck this test is about. The decks
       * built before the check existed are still out there, and an analysis
       * that stayed quiet about them would leave the user with no way to find
       * out why their suggestions look wrong.
       */
      const id = deckId(randomUUID())
      await createDeck(db.pool, {
        id,
        ownerId: '00000000-0000-0000-0000-000000000001',
        name: 'Led by Sol Ring',
        commanders: [BAD_COMMANDER],
        targetBracket: 3,
        archetype: 'midrange',
        colorIdentity: [],
      })

      const body = (await app.inject({ method: 'GET', url: `/api/v1/decks/${id}/analysis` })).json()

      const problem = body.legality.problems.find(
        (p: { kind: string }) => p.kind === 'invalid-commander',
      )
      expect(problem).toBeDefined()
      expect(problem.oracleId).toBe(BAD_COMMANDER)
      expect(body.legality.legal).toBe(false)
    })

    it('reports the gap rather than a verdict when the corpus has not decided', async () => {
      // `canBeCommander` is null for every row until the re-ingest runs. Ruling
      // "ineligible" on that would call every deck illegal; ruling "eligible"
      // would be inventing the answer. It says it does not know.
      const id = deckId(randomUUID())
      await createDeck(db.pool, {
        id,
        ownerId: '00000000-0000-0000-0000-000000000001',
        name: 'Undecided commander',
        commanders: [UNDECIDED],
        targetBracket: 3,
        archetype: 'midrange',
        colorIdentity: ['R'],
      })

      const body = (await app.inject({ method: 'GET', url: `/api/v1/decks/${id}/analysis` })).json()

      const kinds = body.legality.problems.map((p: { kind: string }) => p.kind)
      expect(kinds).not.toContain('invalid-commander')
      const gap = body.unavailable.find((u: { key: string }) => u.key === 'commander-eligibility')
      expect(gap).toBeDefined()
      expect(gap.reason).toMatch(/re-ingest/)
    })

    describe('bracket checks (DATA-05)', () => {
      /** A deck at `targetBracket` holding `count` of the Game Changer fixtures. */
      const deckHolding = async (targetBracket: number, count: number) => {
        const fresh = (
          await app.inject({
            method: 'POST',
            url: '/api/v1/decks',
            payload: {
              name: `Bracket ${targetBracket} with ${count}`,
              commanders: [KROV],
              targetBracket,
              archetype: 'midrange',
            },
          })
        ).json()
        if (count > 0) {
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${fresh.id}/commands`,
            payload: {
              commands: GAME_CHANGERS.slice(0, count).map((id) => ({
                type: 'accept',
                oracleId: id,
                origin: 'manual',
              })),
              idempotencyKey: randomUUID(),
              baseVersion: 1,
            },
          })
        }
        return (
          await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
        ).json()
      }

      it('names the Game Changers the deck holds', async () => {
        const body = await deckHolding(3, 2)
        expect(body.bracket.gameChangers).toHaveLength(2)
        expect(body.bracket.gameChangers).toContain(GAME_CHANGERS[0])
      })

      it('reports no violation at the allowance', async () => {
        // Three is what Bracket 3 allows, quoted in brackets/rules.data.json.
        const body = await deckHolding(3, 3)
        expect(body.bracket.violations).toEqual([])
      })

      it('reports a violation one Game Changer past the allowance', async () => {
        const body = await deckHolding(3, 4)
        expect(body.bracket.violations).toHaveLength(1)
        expect(body.bracket.violations[0].flag).toBe('game-changer')
        expect(body.bracket.violations[0].allowed).toBe(3)
        expect(body.bracket.violations[0].actual).toBe(4)
      })

      it('reports a violation for a single Game Changer at bracket 1', async () => {
        const body = await deckHolding(1, 1)
        expect(body.bracket.violations).toHaveLength(1)
        expect(body.bracket.violations[0].allowed).toBe(0)
      })

      it('reports no violation at bracket 4, whatever the deck holds', async () => {
        const body = await deckHolding(4, 4)
        expect(body.bracket.violations).toEqual([])
      })

      it('counts a Game Changer in the command zone', async () => {
        // The command zone is the one place a Game Changer is guaranteed to be
        // available every game, so leaving commanders out of the count would
        // clear the deck hardest to defend. Bracket 2 allows none.
        const fresh = (
          await app.inject({
            method: 'POST',
            url: '/api/v1/decks',
            payload: {
              name: 'Legendary Game Changer',
              commanders: [GC_COMMANDER],
              targetBracket: 2,
              archetype: 'midrange',
            },
          })
        ).json()

        const body = (
          await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
        ).json()

        expect(body.bracket.gameChangers).toEqual([GC_COMMANDER])
        expect(body.bracket.violations).toHaveLength(1)
        expect(body.bracket.violations[0].actual).toBe(1)
      })

      it('flags a Game Changer among the recommendations it offers', async () => {
        // The flag is surfaced, never used to filter (doc 03 §3.2): the card is
        // still offered, and the user is told what it is.
        const body = (
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${deck.id}/recommendations`,
            payload: {},
          })
        ).json()

        const items = body.groups.flatMap(
          (g: { items: { oracleId: string; bracketFlags: string[] }[] }) => g.items,
        )
        const flagged = items.filter((i: { bracketFlags: string[] }) =>
          i.bracketFlags.includes('game-changer'),
        )
        expect(flagged.length).toBeGreaterThan(0)
        // Nothing unflagged may sneak into that list either: a flag applied to
        // everything is as useless as a flag applied to nothing.
        for (const item of flagged) {
          expect([...GAME_CHANGERS, GC_COMMANDER]).toContain(item.oracleId)
        }
        const unflagged = items.filter(
          (i: { bracketFlags: string[] }) => !i.bracketFlags.includes('game-changer'),
        )
        expect(unflagged.length).toBeGreaterThan(0)
      })

      it('carries the provenance of the allowance to the client', async () => {
        // The product should be able to show where the rule came from and when,
        // which is the whole point of ADR-0006 reaching past the repository.
        const body = await deckHolding(3, 0)
        expect(body.bracket.rules.sourceUrl).toMatch(/^https:\/\/magic\.wizards\.com\//)
        expect(body.bracket.rules.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      })
    })

    it('lists an assembled combo once both pieces are accepted', async () => {
      const fresh = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/decks',
          payload: {
            name: 'Assembled',
            commanders: [KROV],
            targetBracket: 3,
            archetype: 'combo',
          },
        })
      ).json()
      await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${fresh.id}/commands`,
        payload: {
          commands: [
            { type: 'accept', oracleId: PIECE_A, origin: 'manual' },
            { type: 'accept', oracleId: PIECE_B, origin: 'manual' },
          ],
          idempotencyKey: randomUUID(),
          baseVersion: 1,
        },
      })

      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
      ).json()

      expect(body.deckCombos).toHaveLength(1)
      expect(body.deckCombos[0].comboId).toBe('combo-1')
      expect(body.deckCombos[0].produces).toContain('infinite-mana')
    })

    it('answers 404 for a deck that does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/decks/${randomUUID()}/analysis`,
      })

      expect(response.statusCode).toBe(404)
    })
  })
})
