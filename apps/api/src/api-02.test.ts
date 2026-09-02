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
/** Command Tower and a fetch: identical colour identity, opposite production. */
const TOWER = oracleId(randomUUID())
const FETCH = oracleId(randomUUID())
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
/**
 * Two cards for the barometers Wizards names but never quantifies (ADR-0018),
 * plus the card that must NOT be counted with them.
 *
 * `NONLAND_WIPE` carries Ruinous Ultimatum's real text because "nonland"
 * contains "land": it is the false positive the whole land rule is shaped
 * around, and the endpoint is where it would reach a user.
 */
const EXTRA_TURN = oracleId(randomUUID())
const LAND_DENIAL = oracleId(randomUUID())
const NONLAND_WIPE = oracleId(randomUUID())
/**
 * A commander that sits on both sides of one tag, plus two candidates that
 * differ only in which of her tags they carry.
 *
 * Modelled on Tergrid, whose front face WANTS `opponent-discard` and whose
 * Lantern PRODUCES it — so a deck she leads has weight on both sides of the tag
 * and both directions of match are reachable from one fixture.
 */
const EMPH_COMMANDER = oracleId(randomUUID())
const DISCARD_CARD = oracleId(randomUUID())
const UNTAP_CARD = oracleId(randomUUID())

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
  // Same shape and the same reason: a row from before migration 0008 records
  // no production, and `[]` would claim it makes none. The colour generation
  // chart has to tell those apart, so the fixture has to be able to be both.
  ...(opts.producedMana === undefined ? {} : { producedMana: opts.producedMana }),
  edhrecRank: opts.edhrecRank ?? null,
  defaultPrinting: printingId(randomUUID()),
  roles: opts.roles ?? ['synergy'],
  primaryRole: opts.primaryRole ?? 'synergy',
  universesBeyond: false,
  gameChanger: opts.gameChanger ?? false,
  synergyProduces: opts.synergyProduces ?? [],
  synergyWants: opts.synergyWants ?? [],
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
        // A rock, so the generation chart is provably not lands-only.
        producedMana: ['C'],
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
        producedMana: ['R'],
      }),
      /*
       * Command Tower, the card the old implementation could not see.
       *
       * Its colour identity is EMPTY and it taps for all five, so the "sources"
       * figure — which read `colorIdentity` — gave the format's best fixing
       * land a score of nothing in every colour.
       */
      card(TOWER, 'Command Tower', {
        typeLine: 'Land',
        types: ['land'],
        roles: ['land'],
        primaryRole: 'land',
        manaCost: null,
        manaValue: 0,
        colorIdentity: [],
        colors: [],
        producedMana: ['W', 'U', 'B', 'R', 'G'],
      }),
      // A fetch: the same empty identity as the Tower and no production at all.
      card(FETCH, 'Scalding Tarn', {
        typeLine: 'Land',
        types: ['land'],
        roles: ['land'],
        primaryRole: 'land',
        manaCost: null,
        manaValue: 0,
        colorIdentity: [],
        colors: [],
        producedMana: [],
      }),
      card(OFF_COLOR, 'Blue Thing', { colorIdentity: ['U'], colors: ['U'] }),
      ...GAME_CHANGERS.map((id, index) => card(id, `Game Changer ${index}`, { gameChanger: true })),
      card(GC_COMMANDER, 'Tergrid, Test Legend', {
        typeLine: 'Legendary Creature — God',
        gameChanger: true,
      }),
      card(EXTRA_TURN, 'Time Warp', {
        typeLine: 'Sorcery',
        types: ['sorcery'],
        oracleText: 'Target player takes an extra turn after this one.',
      }),
      card(LAND_DENIAL, 'Armageddon', {
        typeLine: 'Sorcery',
        types: ['sorcery'],
        oracleText: 'Destroy all lands.',
      }),
      card(NONLAND_WIPE, 'Ruinous Ultimatum', {
        typeLine: 'Sorcery',
        types: ['sorcery'],
        oracleText: 'Destroy all nonland permanents your opponents control.',
      }),
      card(EMPH_COMMANDER, 'Emphasis Legend', {
        typeLine: 'Legendary Creature — God',
        canBeCommander: true,
        synergyProduces: ['opponent-discard'],
        synergyWants: ['opponent-discard', 'untap'],
      }),
      // Deliberately the LATER name of the two, so the alphabetical tie-break
      // puts it second and only the emphasis term can bring it first.
      card(UNTAP_CARD, 'Zephyr Untapper', { synergyProduces: ['untap'] }),
      card(DISCARD_CARD, 'Aggressive Discard', { synergyProduces: ['opponent-discard'] }),
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
      expect(body.colorBalance.identity).toHaveProperty('R')
      // The two buckets the first pie had no key for at all.
      expect(body.colorBalance.identity).toHaveProperty('M')
      expect(body.colorBalance.identity).toHaveProperty('C')
      expect(body.colorBalance.generation).toHaveProperty('C')
    })

    describe('colour balance', () => {
      const balanceOf = async (oracleIds: readonly string[]) => {
        const fresh = (
          await app.inject({
            method: 'POST',
            url: '/api/v1/decks',
            payload: {
              name: 'Colour balance',
              commanders: [KROV],
              targetBracket: 3,
              archetype: 'midrange',
            },
          })
        ).json()
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${fresh.id}/commands`,
          payload: {
            commands: oracleIds.map((id) => ({ type: 'accept', oracleId: id, origin: 'manual' })),
            idempotencyKey: randomUUID(),
            baseVersion: 1,
          },
        })
        return (
          await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
        ).json()
      }

      it('gives every accepted card exactly one identity bucket, colourless included', async () => {
        /*
         * Krovax (R) leads and a Mountain is red; Ramp Rock and Command Tower
         * are colourless. Four cards, four slices, and the two colourless ones
         * are IN the chart — the reported bug was that they were in the deck
         * and in no slice at all.
         *
         * No multicolour card here: `M` needs two colours inside the
         * commander's identity, and a mono-red commander cannot legally have
         * one accepted. That bucket is pinned in the domain unit tests, where
         * a fixture is free to be any colour.
         */
        const body = await balanceOf([RAMP, TOWER, LAND])
        expect(body.colorBalance.identity).toMatchObject({ R: 2, U: 0, C: 2, M: 0 })
        expect(body.colorBalance.cards).toBe(4)
        const summed = Object.values(body.colorBalance.identity as Record<string, number>).reduce(
          (a, b) => a + b,
          0,
        )
        expect(summed).toBe(body.colorBalance.cards)
      })

      it('reads generation from produced mana, so Command Tower makes all five', async () => {
        /*
         * The regression this endpoint most needs pinned. `sources` used to be
         * counted from `colorIdentity`, and Command Tower's identity is empty —
         * so the format's best fixing land contributed to no colour at all.
         */
        const body = await balanceOf([TOWER, RAMP, LAND])
        expect(body.colorBalance.generation).toMatchObject({
          W: 1,
          U: 1,
          B: 1,
          G: 1,
          // Tower and Mountain.
          R: 2,
          // Sol Ring. A lands-only chart would not have this at all.
          C: 1,
        })
        expect(body.colorBalance.producers).toBe(3)
      })

      it('gives a fetchland no production, though its identity matches the Tower', async () => {
        const body = await balanceOf([FETCH])
        expect(body.colorBalance.identity.C).toBe(1)
        expect(body.colorBalance.generation).toMatchObject({
          W: 0,
          U: 0,
          B: 0,
          R: 0,
          G: 0,
          C: 0,
        })
        expect(body.colorBalance.producers).toBe(0)
      })

      it('sends no unknown-production count, because the database cannot express one', async () => {
        /*
         * Krovax is written to the database with no `producedMana` at all — the
         * pre-migration-0008 state of every row in the real corpus — and reads
         * back as `[]` regardless, because 0008 added the column as
         * `NOT NULL DEFAULT '{}'`. A row that predates the migration and a
         * fetchland are the same bytes on disk, so this endpoint contributes
         * both to `producers` identically and has no gap it could report.
         *
         * The first draft of this route DID report one, on a count that is
         * structurally always zero here. A caveat wired to a branch that cannot
         * run is a claim about the corpus we are not in a position to make, so
         * the field is dropped at this boundary rather than sent as a zero a
         * client might render. The distinction stays alive in the domain unit
         * tests, where a fixture can express it.
         */
        const body = await balanceOf([TOWER, FETCH])
        expect(body.colorBalance).not.toHaveProperty('unknownProduction')
        expect(body.unavailable.find((u: { key: string }) => u.key === 'mana-production')).toBe(
          undefined,
        )
        // Krovax (unrecorded) and Scalding Tarn (explicitly empty) are alike:
        // only Command Tower is a producer.
        expect(body.colorBalance.producers).toBe(1)
      })
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

      /*
       * The three barometers Wizards names and does not quantify (ADR-0018).
       *
       * These are findings, not violations, and the two lists stay apart in the
       * response for that reason: a violation is a published allowance broken,
       * a finding is our own count of what the deck holds. A test that only
       * checked the counts would pass just as happily if the two were merged,
       * so the separation is asserted alongside them.
       */
      describe('barometer findings', () => {
        const deckOf = async (targetBracket: number, oracleIds: readonly string[]) => {
          const fresh = (
            await app.inject({
              method: 'POST',
              url: '/api/v1/decks',
              payload: {
                name: `Barometers ${targetBracket}`,
                commanders: [KROV],
                targetBracket,
                archetype: 'midrange',
              },
            })
          ).json()
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${fresh.id}/commands`,
            payload: {
              commands: oracleIds.map((id) => ({
                type: 'accept',
                oracleId: id,
                origin: 'manual',
              })),
              idempotencyKey: randomUUID(),
              baseVersion: 1,
            },
          })
          return (
            await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
          ).json()
        }

        const finding = (
          body: { bracket: { barometers: { findings: unknown[] } } },
          name: string,
        ) =>
          body.bracket.barometers.findings.find(
            (f) => (f as { barometer: string }).barometer === name,
          ) as { severity: string; count: number; cards: string[]; combos: string[] } | undefined

        it('errors on a card that takes an extra turn', async () => {
          const body = await deckOf(3, [EXTRA_TURN])
          const extra = finding(body, 'extra-turns')
          expect(extra).toBeDefined()
          expect(extra?.severity).toBe('error')
          expect(extra?.count).toBe(1)
          expect(extra?.cards).toEqual([EXTRA_TURN])
        })

        it('warns on land denial and leaves a nonland wipe out of the count', async () => {
          const body = await deckOf(3, [LAND_DENIAL, NONLAND_WIPE])
          const denial = finding(body, 'mass-land-denial')
          expect(denial?.severity).toBe('warn')
          expect(denial?.cards).toEqual([LAND_DENIAL])
        })

        it('warns on a two-card infinite the deck assembles', async () => {
          const body = await deckOf(3, [PIECE_A, PIECE_B])
          const infinite = finding(body, 'two-card-infinites')
          expect(infinite?.severity).toBe('warn')
          expect(infinite?.combos).toEqual(['combo-1'])
        })

        /*
         * Unconditional on the bracket, and that is the ADR-0018 boundary in a
         * test. Raising these only for brackets 1-3 would re-create the
         * per-bracket table Wizards retired on 2025-10-21; a bracket 5 deck gets
         * the same count, because the count is about the deck.
         */
        it('reports the same findings at bracket 5 as at bracket 1', async () => {
          // All three barometers at once, because a gate could be put on any one
          // of them and a deck holding only two would not notice.
          const held = [EXTRA_TURN, LAND_DENIAL, PIECE_A, PIECE_B]
          const low = await deckOf(1, held)
          const high = await deckOf(5, held)
          expect(low.bracket.barometers.findings).toHaveLength(3)
          expect(high.bracket.barometers.findings).toEqual(low.bracket.barometers.findings)
        })

        it('keeps the findings out of `violations` and says whose reading they are', async () => {
          const body = await deckOf(1, [EXTRA_TURN, LAND_DENIAL])
          // Bracket 1 allows no Game Changers and this deck holds none, so a
          // finding leaking into `violations` would be visible here and only
          // here.
          expect(body.bracket.violations).toEqual([])
          expect(body.bracket.assessed).toBeNull()
          expect(body.bracket.barometers.basis).toContain('not a Wizards bracket verdict')
        })

        it('reports an empty findings list for a deck that trips nothing', async () => {
          const body = await deckOf(3, [RAMP])
          expect(body.bracket.barometers.findings).toEqual([])
          // Still sent, so a client can say what was looked for.
          expect(body.bracket.barometers.basis).toBeTruthy()
        })
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

      it('carries the target bracket ENTRY, nulls included', async () => {
        /*
         * `violations` names the allowance only when the deck breaks it, so a
         * deck inside its allowance could otherwise be told how many Game
         * Changers it holds and never what it is allowed.
         *
         * The four nulls travel too, and they are the substance of ADR-0018:
         * a client that receives them can say "the format publishes no rule
         * here", which is a different claim from 'allowed'. A client that
         * received only the number would have to name the other four
         * barometers from memory — the hardcoded ruleset AGENTS.md §8 rejects.
         */
        const body = await deckHolding(3, 0)
        expect(body.bracket.rules.targetBracket).toEqual({
          bracket: 3,
          name: 'Upgraded',
          gameChangersAllowed: 3,
          massLandDenial: null,
          extraTurnChaining: null,
          twoCardInfinites: null,
          tutorDensity: null,
        })
      })

      it('carries the entry of the bracket the DECK targets, not a fixed one', async () => {
        // Reading bracket 3's row for every deck would tell a Bracket 1 builder
        // they may run three Game Changers.
        const body = await deckHolding(1, 0)
        expect(body.bracket.rules.targetBracket.bracket).toBe(1)
        expect(body.bracket.rules.targetBracket.gameChangersAllowed).toBe(0)
      })

      it('says "unlimited" at bracket 4 rather than a number', async () => {
        // The difference between "room for more" and "no limit at all" is not
        // recoverable from a count, and only this field carries it.
        const body = await deckHolding(4, 4)
        expect(body.bracket.rules.targetBracket.gameChangersAllowed).toBe('unlimited')
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

  /**
   * The archetype customiser end to end (doc 16).
   *
   * The domain tests prove the arithmetic; these prove the wire — that a number
   * typed into `PATCH /decks/:id` reaches the targets the analysis reports and
   * the recommendations are ordered by, and that it can be taken back off.
   */
  describe('per-deck target overrides (doc 16)', () => {
    /** A deck of its own, so tuning it cannot disturb the shared fixture deck. */
    const freshDeck = async (archetype = 'midrange'): Promise<{ id: string }> =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/decks',
          payload: { name: 'Tuned', commanders: [KROV], targetBracket: 3, archetype },
        })
      ).json()

    const analyse = async (id: string) =>
      (await app.inject({ method: 'GET', url: `/api/v1/decks/${id}/analysis` })).json()

    const idealOf = (
      body: { targets: { dimension: { role?: string }; ideal: number }[] },
      role: string,
    ) => body.targets.find((t) => t.dimension.role === role)?.ideal

    it('starts every deck on its archetype with nothing overridden', async () => {
      const body = await analyse((await freshDeck()).id)
      expect(body.targetOverrides).toEqual({})
      expect(body.targets.every((t: { source: string }) => t.source === 'archetype')).toBe(true)
      // With nothing overridden the preset IS the target, everywhere.
      for (const t of body.targets) expect(t.preset).toBe(t.ideal)
    })

    it('moves the target a builder typed and leaves the others alone', async () => {
      const fresh = await freshDeck()
      const before = await analyse(fresh.id)

      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().targetOverrides).toEqual({ roles: { 'role:ramp': 17 } })

      const after = await analyse(fresh.id)
      expect(idealOf(after, 'ramp')).toBe(17)
      // Sparse: every other row is still exactly what the archetype said, so
      // this deck keeps inheriting later revisions of all of them.
      expect(idealOf(after, 'draw')).toBe(idealOf(before, 'draw'))
      expect(idealOf(after, 'land')).toBe(idealOf(before, 'land'))
    })

    it('says which targets are the builder’s and what the archetype wanted', async () => {
      const fresh = await freshDeck()
      const presetRamp = idealOf(await analyse(fresh.id), 'ramp')
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })

      const body = await analyse(fresh.id)
      const ramp = body.targets.find(
        (t: { dimension: { role?: string } }) => t.dimension.role === 'ramp',
      )
      expect(ramp.source).toBe('custom')
      // The preset stays visible behind the number, which is doc 16's whole
      // interface argument: a box reading 17 cannot tell you it wanted 10.
      expect(ramp.preset).toBe(presetRamp)
      expect(
        body.targets.find((t: { dimension: { role?: string } }) => t.dimension.role === 'draw')
          .source,
      ).toBe('archetype')
    })

    it('reports null rather than zero for a dimension the archetype never named', async () => {
      // "The archetype wanted none of these" and "the archetype has no opinion
      // about these" are different, and only one of them is true here.
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:stax': 5 } } },
      })
      const stax = (await analyse(fresh.id)).targets.find(
        (t: { dimension: { role?: string } }) => t.dimension.role === 'stax',
      )
      expect(stax.ideal).toBe(5)
      expect(stax.preset).toBeNull()
    })

    it('moves the curve the panel draws, and keeps the preset beside it', async () => {
      const fresh = await freshDeck()
      const before = await analyse(fresh.id)
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { curve: { '6': 14 } } },
      })
      const after = await analyse(fresh.id)

      expect(after.curve.target[6].ideal).toBeGreaterThan(before.curve.target[6].ideal)
      expect(after.curve.target[6].source).toBe('custom')
      expect(after.curve.target[5].source).toBe('archetype')
      // The archetype's own shape survives alongside, for the sheet to show.
      expect(after.curve.preset[6].ideal).toBeCloseTo(before.curve.target[6].ideal, 9)
    })

    it('judges the deck against the same tuned curve in both endpoints', async () => {
      /*
       * The two endpoints build their curve target from the same three
       * arguments, and they MUST agree: an analysis panel saying the deck is
       * fine at two, beside an ordering that is pushing two-drops down because
       * it thinks the bucket is over-full, is worse than either alone. That is
       * the reason `deck-context` exists at all, and the curve is the one target
       * it does not carry.
       *
       * Observed through `curve-fit`, which the domain emits only for a card
       * with nothing else to say for itself — and whose `delta` is read off the
       * same `curveDeltas` the analysis reports.
       */
      const fresh = await freshDeck()
      await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${fresh.id}/commands`,
        payload: {
          commands: [PIECE_A, PIECE_B, RAMP].map((oracle) => ({
            type: 'accept',
            oracleId: oracle,
            origin: 'manual',
          })),
          idempotencyKey: randomUUID(),
          baseVersion: 1,
        },
      })

      const curveFitDelta = async (): Promise<number | undefined> => {
        const body = (
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${fresh.id}/recommendations`,
            payload: {},
          })
        ).json()
        return body.groups
          .flatMap((g: { items: { reasons: { kind: string; delta?: number }[] }[] }) => g.items)
          .flatMap((i: { reasons: { kind: string; delta?: number }[] }) => i.reasons)
          .find((r: { kind: string }) => r.kind === 'curve-fit')?.delta
      }

      // Every fixture card sits at mana value two, so bucket two is where the
      // deck actually is and the only bucket the assertion can be about.
      const before = await analyse(fresh.id)
      expect(await curveFitDelta()).toBe(before.curve.deltas[2].delta)
      // Over-full at two before the override, so the numbers below are a real
      // change rather than two zeroes agreeing by accident.
      expect(before.curve.deltas[2].delta).toBeLessThan(0)

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { curve: { '2': 60 } } },
      })

      const after = await analyse(fresh.id)
      expect(after.curve.deltas[2].delta).toBe(0)
      expect(await curveFitDelta()).toBe(after.curve.deltas[2].delta)
    })

    it('reaches the recommendation reasons, not only the meters', async () => {
      /*
       * Pillar P4. The suggestion is now being made on the builder's authority
       * rather than the archetype's, and the reason has to say so — otherwise
       * the one number they could change is the one thing the explanation hides.
       */
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 20 } } },
      })
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${fresh.id}/recommendations`,
          payload: {},
        })
      ).json()

      const reasons = body.groups
        .flatMap((g: { items: { reasons: { kind: string; source?: string }[] }[] }) => g.items)
        .flatMap((i: { reasons: { kind: string; source?: string }[] }) => i.reasons)
        .filter((r: { kind: string }) => r.kind === 'fills-deficit')
      expect(reasons.length).toBeGreaterThan(0)
      expect(reasons.some((r: { source?: string }) => r.source === 'custom')).toBe(true)
      // And every recommendation still explains itself at all (P4).
      for (const group of body.groups) {
        for (const item of group.items) expect(item.reasons.length).toBeGreaterThan(0)
      }
    })

    it('can be cleared with an empty object', async () => {
      const fresh = await freshDeck()
      const before = await analyse(fresh.id)
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 }, tolerance: 0.1 } },
      })
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: {} },
      })
      const after = await analyse(fresh.id)
      expect(after.targetOverrides).toEqual({})
      expect(after.targets).toEqual(before.targets)
    })

    it('can be cleared with an explicit null', async () => {
      // The way out has to be sayable in a body whose other fields all treat
      // absence as "leave alone". An override you cannot remove is a trap.
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: null },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().targetOverrides).toEqual({})
    })

    it('leaves the overrides alone when the patch does not mention them', async () => {
      // Every other field on this endpoint behaves this way, and a target that
      // silently reset when a deck was renamed would be indistinguishable from
      // a bug the user could not describe.
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      const renamed = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { name: 'Renamed' },
      })
      expect(renamed.json().name).toBe('Renamed')
      expect(renamed.json().targetOverrides).toEqual({ roles: { 'role:ramp': 17 } })
    })

    it('carries the overrides through an archetype change', async () => {
      /*
       * Doc 16's second open question, answered: FOLLOW, and say so loudly.
       *
       * Silently discarding numbers the builder typed is worse than carrying
       * numbers they may not want, because only one of those is reversible —
       * there is a reset for the second and nothing at all for the first.
       */
      const fresh = await freshDeck('midrange')
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      const switched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { archetype: 'control' },
      })
      expect(switched.json().archetype).toBe('control')
      expect(switched.json().targetOverrides).toEqual({ roles: { 'role:ramp': 17 } })

      const body = await analyse(fresh.id)
      expect(idealOf(body, 'ramp')).toBe(17)
      // The rest of the deck really did become a control deck, so the override
      // is riding on top of the new archetype rather than pinning the old one.
      expect(idealOf(body, 'draw')).toBe(
        idealOf(await analyse((await freshDeck('control')).id), 'draw'),
      )
    })

    it('replaces wholesale rather than merging', async () => {
      // A merge protocol has no way to express a deletion: "reset ramp" and
      // "leave ramp alone" are both an absent key.
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17, 'role:draw': 4 } } },
      })
      const second = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      expect(second.json().targetOverrides).toEqual({ roles: { 'role:ramp': 17 } })
    })

    it('rejects a count that is not a whole card', async () => {
      for (const roles of [{ 'role:ramp': -1 }, { 'role:ramp': 3.5 }, { 'role:ramp': 100 }]) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/v1/decks/${(await freshDeck()).id}`,
          payload: { targetOverrides: { roles } },
        })
        expect(response.statusCode, JSON.stringify(roles)).toBe(400)
      }
    })

    it('rejects a curve bucket that is not 0..7', async () => {
      // Kept, an `8` would be an override the curve never applies and the sheet
      // cannot show — an edit the builder made and can never find again.
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${(await freshDeck()).id}`,
        payload: { targetOverrides: { curve: { '8': 4 } } },
      })
      expect(response.statusCode).toBe(400)
    })

    it('rejects a tolerance outside 0..1', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${(await freshDeck()).id}`,
        payload: { targetOverrides: { tolerance: 1.5 } },
      })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('per-deck semantic emphasis', () => {
    const freshDeck = async (semanticEmphasis?: string[] | null): Promise<{ id: string }> =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/decks',
          payload: {
            name: 'Focused',
            commanders: [EMPH_COMMANDER],
            targetBracket: 3,
            archetype: 'midrange',
            ...(semanticEmphasis === undefined ? {} : { semanticEmphasis }),
          },
        })
      ).json()

    const suggest = async (id: string) =>
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${id}/recommendations`,
          payload: {},
        })
      ).json()

    /** Every suggested card, in the order the endpoint put them in. */
    const ordering = (body: { groups: { items: { oracleId: string }[] }[] }) =>
      body.groups.flatMap((g) => g.items.map((i) => i.oracleId))

    it('starts every deck with nothing emphasised', async () => {
      const fresh = await freshDeck()
      const body = await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}` })
      expect(body.json().semanticEmphasis).toEqual([])
      expect((await suggest(fresh.id)).emphasis).toEqual([])
    })

    it('takes the emphasis at creation, because that is when the user is asked', async () => {
      // "When choosing my commander, before I start making the deck." A deck
      // that could only be focused by a follow-up PATCH would spend one round
      // trip scoring against the wrong thing.
      const fresh = await freshDeck(['untap', 'opponent-discard'])
      const body = await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}` })
      // Canonical order, not click order.
      expect(body.json().semanticEmphasis).toEqual(['untap', 'opponent-discard'])
    })

    it('ranks a card supporting the emphasis above one that does not', async () => {
      const plain = ordering(await suggest((await freshDeck()).id))
      const focused = ordering(await suggest((await freshDeck(['untap'])).id))

      // Without emphasis the alphabetical tie-break puts the discard card first.
      expect(plain.indexOf(DISCARD_CARD)).toBeLessThan(plain.indexOf(UNTAP_CARD))
      expect(focused.indexOf(UNTAP_CARD)).toBeLessThan(focused.indexOf(DISCARD_CARD))
    })

    it('never removes a suggestion — emphasis reorders and nothing else', async () => {
      // The failure mode this feature must not have. Emphasising something the
      // pool cannot support must not empty the feed.
      const plain = ordering(await suggest((await freshDeck()).id))
      const focused = ordering(await suggest((await freshDeck(['landfall'])).id))
      expect([...focused].sort()).toEqual([...plain].sort())
    })

    /**
     * The focus guarantee, over HTTP (ADR-0026).
     *
     * `limitPerGroup: 1` because the defect only exists past the cut: at the
     * default 60 this pool is never cut at all, the guarantee has nothing to
     * do, and the test could not fail.
     *
     * `emphasis: 0` weight isolates the guarantee from the SCORING half of the
     * feature. Left at its default the emphasis term alone lifts the untapper
     * to the top of its group, so it would be on the page whether or not a
     * guarantee existed — which is the same vacuum. Zeroed, the focus moves no
     * card at all and the only thing that can put the untapper on a page of one
     * is the guarantee. It is also the case the feature exists for: a supporter
     * that the score does not lift far enough.
     */
    const tight = async (id: string) =>
      (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${id}/recommendations`,
          payload: { limitPerGroup: 1, weights: { emphasis: 0 } },
        })
      ).json()

    it('carries the focus past limitPerGroup, so a cut page still shows it', async () => {
      const plain = ordering(await tight((await freshDeck()).id))
      const focused = ordering(await tight((await freshDeck(['untap'])).id))

      // The defect: with a cut of one, the untapper is not on the page at all.
      expect(plain).not.toContain(UNTAP_CARD)
      expect(focused).toContain(UNTAP_CARD)
      // And it EXTENDS rather than displacing: everything that was there is
      // still there. The interface promises a focus never hides a card.
      for (const id of plain) expect(focused).toContain(id)
    })

    it('says over the wire that the row is there because of the focus (P4)', async () => {
      const body = await tight((await freshDeck(['untap'])).id)
      const item = body.groups
        .flatMap((g: { items: { oracleId: string; reasons: unknown[] }[] }) => g.items)
        .find((i: { oracleId: string }) => i.oracleId === UNTAP_CARD)
      expect(item.reasons).toContainEqual({
        kind: 'keyword-synergy',
        tag: 'untap',
        direction: 'enables',
        withOracleIds: [],
        emphasised: true,
        guaranteed: true,
      })
    })

    it('will not resurrect a card the builder rejected (pillar P6)', async () => {
      // The guarantee reaches past the cut, and a rejection lives on the other
      // side of it. Excluding the one card the focus would have carried in must
      // leave it off the page entirely.
      const fresh = await freshDeck(['untap'])
      const excluded = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${fresh.id}/commands`,
        payload: {
          commands: [{ type: 'exclude', oracleId: UNTAP_CARD }],
          idempotencyKey: randomUUID(),
          baseVersion: 1,
        },
      })
      expect(excluded.statusCode).toBe(200)
      expect(ordering(await tight(fresh.id))).not.toContain(UNTAP_CARD)
    })

    it('says how much of the pool each emphasised tag reaches', async () => {
      // `supporting: 0` is the honest answer to "why did nothing change".
      // Without it, an emphasis nothing supports is indistinguishable from one
      // that worked, because the list comes back full either way.
      const body = await suggest((await freshDeck(['landfall', 'untap'])).id)
      expect(body.emphasis).toEqual([
        { tag: 'landfall', supporting: 0 },
        { tag: 'untap', supporting: 1 },
      ])
    })

    it('says how much of the pool supports every tag, so an offer can be ranked', async () => {
      // The interface offers the semantics RELATED to a chosen focus, and those
      // are by definition not emphasised — so `emphasis` above cannot rank them
      // and the offer would fall back to the alphabet, leading with whichever
      // tag sorts first even when nothing in the deck's colours supports it.
      const body = await suggest((await freshDeck(['untap'])).id)
      const support = new Map(
        body.tagSupport.map((e: { tag: string; supporting: number }) => [e.tag, e.supporting]),
      )
      expect(support.get('untap')).toBe(1)
      // Counted and found to be nothing — reported, not omitted. The client
      // ranks a counted zero above a tag it has no count for at all.
      expect(support.get('landfall')).toBe(0)
      expect(body.tagSupport.length).toBeGreaterThan(body.emphasis.length)
    })

    it('reports the tag support even with no emphasis, because the offer precedes one', async () => {
      // "Show all semantics" is reachable before any focus exists, and it is
      // ranked by the same counts.
      const body = await suggest((await freshDeck()).id)
      expect(body.emphasis).toEqual([])
      expect(
        body.tagSupport.find((e: { tag: string }) => e.tag === 'untap'),
      ).toEqual({ tag: 'untap', supporting: 1 })
    })

    it('says the card rose because of the emphasis, not an ordinary synergy (P4)', async () => {
      const body = await suggest((await freshDeck(['untap'])).id)
      const item = body.groups
        .flatMap((g: { items: { oracleId: string; reasons: unknown[] }[] }) => g.items)
        .find((i: { oracleId: string }) => i.oracleId === UNTAP_CARD)
      expect(item.reasons).toContainEqual({
        kind: 'keyword-synergy',
        tag: 'untap',
        direction: 'enables',
        withOracleIds: [],
        emphasised: true,
      })
    })

    it('makes no emphasis claim about a card the builder did not emphasise', async () => {
      const body = await suggest((await freshDeck(['untap'])).id)
      const item = body.groups
        .flatMap((g: { items: { oracleId: string; reasons: { kind: string }[] }[] }) => g.items)
        .find((i: { oracleId: string }) => i.oracleId === DISCARD_CARD)
      const synergy = item.reasons.find((r: { kind: string }) => r.kind === 'keyword-synergy')
      expect(synergy).not.toHaveProperty('emphasised')
    })

    it('adds an emphasis through PATCH', async () => {
      const fresh = await freshDeck()
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { semanticEmphasis: ['opponent-discard'] },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().semanticEmphasis).toEqual(['opponent-discard'])
    })

    it('de-emphasises one tag by sending the shorter list', async () => {
      // Wholesale replacement is what makes removing a tag the same operation
      // as adding one. There is no remove verb to forget to implement.
      const fresh = await freshDeck(['untap', 'opponent-discard'])
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { semanticEmphasis: ['opponent-discard'] },
      })
      expect(patched.json().semanticEmphasis).toEqual(['opponent-discard'])
    })

    it('can be cleared with an empty array', async () => {
      const fresh = await freshDeck(['untap'])
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { semanticEmphasis: [] },
      })
      expect(patched.json().semanticEmphasis).toEqual([])
      // And the ordering goes back to what it was — an emphasis that left a
      // residue behind would be one the user could not actually undo.
      expect(ordering(await suggest(fresh.id))).toEqual(
        ordering(await suggest((await freshDeck()).id)),
      )
    })

    it('can be cleared with an explicit null', async () => {
      const fresh = await freshDeck(['untap'])
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { semanticEmphasis: null },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().semanticEmphasis).toEqual([])
    })

    it('leaves the emphasis alone when the patch does not mention it', async () => {
      const fresh = await freshDeck(['untap'])
      const renamed = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { name: 'Renamed' },
      })
      expect(renamed.json().name).toBe('Renamed')
      expect(renamed.json().semanticEmphasis).toEqual(['untap'])
    })

    it('does not disturb the target overrides, which are a separate axis', async () => {
      // Doc 16's controls and this one both live on `PATCH`, and a deck may
      // want eighteen creatures AND be about opponent-discard.
      const fresh = await freshDeck(['untap'])
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
      ).json()
      expect(body.semanticEmphasis).toEqual(['untap'])
      expect(body.targetOverrides).toEqual({ roles: { 'role:ramp': 17 } })
    })

    it('rejects a tag that is not in the vocabulary', async () => {
      // The enum is the domain's own `SYNERGY_TAGS`. A tag kept here would be
      // an emphasis that silently matched nothing forever.
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${(await freshDeck()).id}`,
        payload: { semanticEmphasis: ['not-a-real-tag'] },
      })
      expect(response.statusCode).toBe(400)
    })
  })

  /**
   * Columns as deck state, and the two metrics that ship as default columns
   * (doc 18 §18.7/§18.8).
   *
   * The distinction under test throughout is the one no other field on this
   * endpoint has: `null` and `[]` are DIFFERENT VALUES. Every assertion that
   * separates them is the feature, not a detail — a builder who removes every
   * column and gets them back on the next load has not removed anything.
   */
  describe('columns saved with the deck', () => {
    const freshDeck = async (columns?: unknown): Promise<{ id: string }> =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/decks',
          payload: {
            name: 'Columned',
            commanders: [KROV],
            targetBracket: 3,
            archetype: 'midrange',
            ...(columns === undefined ? {} : { columns }),
          },
        })
      ).json()

    it('starts null, meaning the client draws the defaults', async () => {
      const fresh = await freshDeck()
      const body = await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}` })
      expect(body.json().columns).toBeNull()
    })

    it('takes columns at creation', async () => {
      const fresh = await freshDeck([
        { kind: 'metric', metric: 'impact' },
        { kind: 'query', query: 't:creature' },
      ])
      const body = await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}` })
      expect(body.json().columns).toEqual([
        { kind: 'metric', metric: 'impact' },
        { kind: 'query', query: 't:creature' },
      ])
    })

    it('creates with NO columns when an empty list is sent', async () => {
      // `?? null` in the handler would be `?? []` on every other field here.
      const fresh = await freshDeck([])
      const body = await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}` })
      expect(body.json().columns).toEqual([])
    })

    it('replaces the whole list through PATCH', async () => {
      const fresh = await freshDeck([{ kind: 'metric', metric: 'impact' }])
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { columns: [{ kind: 'query', query: 'mv<=2' }] },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().columns).toEqual([{ kind: 'query', query: 'mv<=2' }])
    })

    it('removes every column with an empty array, and it STAYS removed', async () => {
      const fresh = await freshDeck([{ kind: 'metric', metric: 'impact' }])
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { columns: [] },
      })
      expect(patched.json().columns).toEqual([])
      // Re-read, because the failure this guards against is on the NEXT load.
      const reread = await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}` })
      expect(reread.json().columns).toEqual([])
    })

    it('goes back to the defaults with an explicit null', async () => {
      // `null` means "clear my customisation" here exactly as it does for
      // targetOverrides and semanticEmphasis — and clearing a column list means
      // returning to the defaults, which are SQL NULL.
      const fresh = await freshDeck([{ kind: 'query', query: 'mv<=2' }])
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { columns: null },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().columns).toBeNull()
    })

    it('leaves the columns alone when the patch does not mention them', async () => {
      const fresh = await freshDeck([{ kind: 'query', query: 'mv<=2' }])
      const renamed = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { name: 'Renamed' },
      })
      expect(renamed.json().name).toBe('Renamed')
      expect(renamed.json().columns).toEqual([{ kind: 'query', query: 'mv<=2' }])
    })

    it('leaves an EMPTIED list alone when the patch does not mention it', async () => {
      // The case a COALESCE write gets wrong in the other direction: `[]` is not
      // null, so an unrelated patch must not restore the defaults.
      const fresh = await freshDeck([])
      const renamed = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { name: 'Still Bare' },
      })
      expect(renamed.json().columns).toEqual([])
    })

    it('does not disturb the semantic emphasis, which is a separate axis', async () => {
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { semanticEmphasis: ['untap'] },
      })
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { columns: [{ kind: 'metric', metric: 'efficiency' }] },
      })
      expect(patched.json().semanticEmphasis).toEqual(['untap'])
      expect(patched.json().columns).toEqual([{ kind: 'metric', metric: 'efficiency' }])
    })

    it('rejects a metric that is not in the vocabulary', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${(await freshDeck()).id}`,
        payload: { columns: [{ kind: 'metric', metric: 'vibes' }] },
      })
      expect(response.statusCode).toBe(400)
    })

    it('rejects a column that is both a query and a metric', async () => {
      // `oneOf`, not one object with everything optional: a body carrying both
      // must be a 400 rather than a coin toss about which one wins.
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${(await freshDeck()).id}`,
        payload: { columns: [{ kind: 'query', query: 'impact', metric: 'impact' }] },
      })
      expect(response.statusCode).toBe(400)
    })
  })

  /**
   * Where the two metrics surface (doc 18 §18.8).
   *
   * On the recommendation items and on card detail, so the UI can draw a column
   * without recomputing and without a second implementation.
   */
  describe('impact and efficiency on the wire', () => {
    it('rides on every recommendation item, beside `reasons` and not inside it', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: {},
        })
      ).json()
      const items = body.groups.flatMap(
        (g: { items: { impact?: unknown; efficiency?: unknown; reasons: { kind: string }[] }[] }) =>
          g.items,
      )
      expect(items.length).toBeGreaterThan(0)
      for (const item of items) {
        expect(item.impact).toMatchObject({
          score: expect.any(Number),
          breadth: expect.any(String),
          persistence: expect.any(String),
          stakes: expect.any(String),
          symmetry: expect.any(String),
          scales: expect.any(Boolean),
          fragile: expect.any(Boolean),
        })
        expect(item.efficiency).toMatchObject({ score: expect.any(Number) })
        // P4: every recommendation still stands on a deck-relative reason. A
        // card-intrinsic metric is not a reason and must never be the only one.
        expect(item.reasons.length).toBeGreaterThan(0)
        for (const reason of item.reasons) {
          expect(reason.kind).not.toBe('impact')
          expect(reason.kind).not.toBe('efficiency')
        }
      }
    })

    it('rides on card detail', async () => {
      const body = (await app.inject({ method: 'GET', url: `/api/v1/cards/${LAND_DENIAL}` })).json()
      // Armageddon: "Destroy all lands." Unbounded breadth, one-shot, and it
      // takes your lands too.
      expect(body.impact.breadth).toBe('unbounded')
      expect(body.impact.persistence).toBe('one-shot')
      expect(body.efficiency.score).toBeGreaterThan(0)
    })

    it('agrees between the two surfaces for the same card', async () => {
      // One definition, two readers. Two implementations would eventually
      // disagree, and the disagreement would be invisible.
      const detail = (
        await app.inject({ method: 'GET', url: `/api/v1/cards/${NONLAND_WIPE}` })
      ).json()
      const recs = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: {},
        })
      ).json()
      const item = recs.groups
        .flatMap((g: { items: { oracleId: string; impact: unknown }[] }) => g.items)
        .find((i: { oracleId: string }) => i.oracleId === NONLAND_WIPE)
      if (item !== undefined) expect(item.impact).toEqual(detail.impact)
    })

    it('ticks exactly the rows whose own impact cell clears the column threshold', async () => {
      /*
       * The two halves meeting, end to end.
       *
       * A column of `impact>=6` is evaluated server-side against the SAME
       * number the client draws in the impact cell, so a ticked row can never
       * contradict what it displays. Asserted as set equality against the
       * items' own scores rather than against a hardcoded card list — the point
       * is the agreement, not which cards happen to be over six.
       */
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: { columns: ['impact>=6', 'eff>=0.5'] },
        })
      ).json()

      const items = body.groups.flatMap(
        (g: {
          items: { oracleId: string; impact: { score: number }; efficiency: { score: number } }[]
        }) => g.items,
      )
      expect(items.length).toBeGreaterThan(0)

      const column = (query: string): string[] =>
        [
          ...((body.columns as { query: string; matched: string[] }[]).find(
            (c) => c.query === query,
          )?.matched ?? []),
        ].sort()

      const expectedImpact = items
        .filter((i: { impact: { score: number } }) => i.impact.score >= 6)
        .map((i: { oracleId: string }) => i.oracleId)
        .sort()
      const expectedEff = items
        .filter((i: { efficiency: { score: number } }) => i.efficiency.score >= 0.5)
        .map((i: { oracleId: string }) => i.oracleId)
        .sort()

      // A vacuous pass would be two empty lists agreeing, so at least one side
      // has to actually select something.
      expect(expectedImpact.length).toBeGreaterThan(0)
      expect(column('impact>=6')).toEqual(expectedImpact)
      expect(column('eff>=0.5')).toEqual(expectedEff)
    })
  })
})
