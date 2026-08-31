import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, databaseUrl, type TestDatabase } from '@roundtable/db/testing'
import { getCard, insertCombos, upsertCards, upsertPrintings } from '@roundtable/db'
import type { Card, CardType, Combo, OracleId, Printing } from '@roundtable/domain'
import { comboId, oracleId, printingId } from '@roundtable/domain'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'
import { clearCorpusCache } from './corpus-cache.js'

/**
 * Contract tests for API-01 against doc 10.
 *
 * They run against a REAL Postgres (AGENTS.md §4) via the same harness DB-01
 * uses, and they SKIP loudly rather than passing vacuously when one is absent.
 */
const hasDatabase = databaseUrl() !== null
const describeDb = hasDatabase ? describe : describe.skip

if (!hasDatabase) {
  console.warn('[api] DATABASE_URL not set — skipping API contract tests (AGENTS.md §4)')
}

// Fixed ids so tests can refer to cards without threading values around.
const KROV = oracleId(randomUUID())
const SOL = oracleId(randomUUID())
const COUNTER = oracleId(randomUUID())
const MOUNTAIN = oracleId(randomUUID())
const ANTE = oracleId(randomUUID())
const UB = oracleId(randomUUID())
const UNDECIDED = oracleId(randomUUID())
/** On Wizards' Game Changers list (DATA-05), so `is:gamechanger` has a subject. */
const GAME_CHANGER = oracleId(randomUUID())

const card = (id: OracleId, name: string, opts: Partial<Card> = {}): Card => ({
  oracleId: id,
  name,
  manaCost: opts.manaCost ?? '{1}',
  manaValue: opts.manaValue ?? 1,
  colorIdentity: opts.colorIdentity ?? ['R'],
  colors: opts.colors ?? ['R'],
  typeLine: opts.typeLine ?? 'Creature — Goblin',
  types: (opts.types ?? ['creature']) as readonly CardType[],
  oracleText: opts.oracleText ?? '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: opts.legalities ?? { commander: 'legal' },
  // Set from the fixture rather than derived here: these rows stand in for what
  // the ingest wrote, and a test corpus that derived its own answers would be
  // testing the derivation twice instead of the route once.
  ...(opts.canBeCommander === undefined ? {} : { canBeCommander: opts.canBeCommander }),
  edhrecRank: opts.edhrecRank ?? null,
  defaultPrinting: printingId(randomUUID()),
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
})

describeDb('API-01 contract', () => {
  let db: TestDatabase
  let app: FastifyInstance

  beforeAll(async () => {
    db = await createTestDatabase('api')
    await upsertCards(db.pool, [
      card(KROV, 'Krovax, Test Commander', {
        typeLine: 'Legendary Creature — Vampire',
        colorIdentity: ['B', 'R'],
        canBeCommander: true,
      }),
      card(SOL, 'Sol Ring', {
        typeLine: 'Artifact',
        colorIdentity: [],
        colors: [],
        canBeCommander: false,
      }),
      card(COUNTER, 'Counterspell', {
        colorIdentity: ['U'],
        colors: ['U'],
        canBeCommander: false,
      }),
      card(MOUNTAIN, 'Mountain', { typeLine: 'Basic Land — Mountain', canBeCommander: false }),
      card(ANTE, 'Contract from Below', {
        legalities: { commander: 'banned' },
        canBeCommander: false,
      }),
      // Left undecided on purpose: this is a row the ingest has not revisited
      // since migration 0010, and the route has to tell that from a "no".
      card(UNDECIDED, 'Legend of Unknown Eligibility', {
        typeLine: 'Legendary Creature — Wizard',
      }),
      { ...card(UB, 'Frodo, Test Hobbit'), universesBeyond: true },
      { ...card(GAME_CHANGER, 'Rhystic Study'), gameChanger: true },
    ])
    const combo: Combo = {
      id: comboId('c-1'),
      pieces: [SOL, KROV],
      prerequisites: '',
      steps: [],
      produces: ['infinite-mana'],
      colorIdentity: ['B', 'R'],
    }
    await insertCombos(db.pool, [combo])

    app = await buildServer({ pool: db.pool })
    await app.ready()
    // CREATE DATABASE plus the migrations, against a real server, in parallel
    // with the db suite doing the same. Vitest's 10 s default is optimistic for
    // real DDL and made this hook flake roughly one run in four.
  }, 60_000)

  afterAll(async () => {
    // Close the server before the pool: `drop()` ends the pool the routes hold,
    // and DROP DATABASE blocks while a connection is still attached.
    await app?.close()
    await db?.drop()
  }, 60_000)

  const createDeck = async (over: Record<string, unknown> = {}) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/decks',
      payload: {
        name: 'Test deck',
        commanders: [KROV],
        targetBracket: 3,
        archetype: 'midrange',
        ...over,
      },
    })

  // ------------------------------------------------------------------ decks

  describe('POST /api/v1/decks', () => {
    it('creates a deck and derives colour identity from the commanders', async () => {
      const response = await createDeck()

      expect(response.statusCode).toBe(201)
      const deck = response.json()
      expect(deck).toMatchObject({
        name: 'Test deck',
        commanders: [KROV],
        targetBracket: 3,
        archetype: 'midrange',
        excludeUniversesBeyond: false,
        status: 'active',
        version: 1,
        entries: [],
      })
      // Derived from Krovax, never taken from the request body.
      expect([...deck.colorIdentity].sort()).toEqual(['B', 'R'])
    })

    it('refuses a commander the corpus does not know', async () => {
      const response = await createDeck({ commanders: [randomUUID()] })

      expect(response.statusCode).toBe(422)
      expect(response.headers['content-type']).toContain('application/problem+json')
    })

    it('refuses a bracket outside 1..5 at the schema boundary', async () => {
      const response = await createDeck({ targetBracket: 6 })

      expect(response.statusCode).toBe(400)
    })

    it('refuses an archetype that is not in the domain vocabulary', async () => {
      const response = await createDeck({ archetype: 'goodstuff' })

      expect(response.statusCode).toBe(400)
    })

    it('refuses more than two commanders', async () => {
      const response = await createDeck({ commanders: [KROV, SOL, COUNTER] })

      expect(response.statusCode).toBe(400)
    })

    it('refuses a card that cannot be a commander', async () => {
      // The defect: a deck was created on production with Sol Ring leading it,
      // and every suggestion afterwards was scored against the colour identity
      // of a card that cannot legally be in the command zone.
      const response = await createDeck({ commanders: [SOL] })

      expect(response.statusCode).toBe(422)
      expect(response.headers['content-type']).toContain('application/problem+json')
      const problem = response.json()
      expect(problem.ineligible).toEqual([SOL])
      // The card is named in `detail`, which is the string the web client
      // renders. A uuid on its own is not something a builder can act on.
      expect(problem.detail).toContain('Sol Ring')
    })

    it('names every ineligible commander, not just the first', async () => {
      const response = await createDeck({ commanders: [SOL, COUNTER] })

      expect(response.statusCode).toBe(422)
      expect(new Set(response.json().ineligible)).toEqual(new Set([SOL, COUNTER]))
    })

    it('still refuses an ineligible commander sitting beside a legal one', async () => {
      const response = await createDeck({ commanders: [KROV, SOL] })

      expect(response.statusCode).toBe(422)
      expect(response.json().ineligible).toEqual([SOL])
    })

    it('lets a commander through when the ingest has not decided yet', async () => {
      /*
       * `canBeCommander` is null for every row until the re-ingest that follows
       * migration 0010 runs, and "not decided" is not "no". Rejecting on it
       * would refuse every commander in the corpus for the length of that
       * window, so the deck is created and the gap is reported on the analysis
       * endpoint instead.
       */
      const response = await createDeck({ commanders: [UNDECIDED] })

      expect(response.statusCode).toBe(201)
    })
  })

  describe('GET /api/v1/decks/:id', () => {
    it('answers 404 as problem+json for a deck that does not exist', async () => {
      const response = await app.inject({ method: 'GET', url: `/api/v1/decks/${randomUUID()}` })

      expect(response.statusCode).toBe(404)
      expect(response.headers['content-type']).toContain('application/problem+json')
      expect(response.json()).toMatchObject({ status: 404, title: expect.any(String) })
    })

    it('answers 400 for an id that is not a uuid, rather than reaching the database', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/decks/not-a-uuid' })

      expect(response.statusCode).toBe(400)
    })

    it('returns the deck that was created', async () => {
      const created = (await createDeck({ name: 'Fetch me' })).json()

      const response = await app.inject({ method: 'GET', url: `/api/v1/decks/${created.id}` })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ id: created.id, name: 'Fetch me' })
    })
  })

  describe('PATCH /api/v1/decks/:id', () => {
    it('updates only the fields supplied', async () => {
      const created = (await createDeck({ name: 'Before' })).json()

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${created.id}`,
        payload: { name: 'After' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({
        name: 'After',
        targetBracket: created.targetBracket,
        archetype: created.archetype,
      })
    })

    it('changing archetype moves targets only — it adds and removes no card', async () => {
      const created = (await createDeck()).json()
      await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${created.id}/commands`,
        payload: {
          commands: [{ type: 'accept', oracleId: SOL, origin: 'manual' }],
          idempotencyKey: randomUUID(),
          baseVersion: 1,
        },
      })

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${created.id}`,
        payload: { archetype: 'control' },
      })

      expect(response.statusCode).toBe(200)
      const deck = response.json()
      expect(deck.archetype).toBe('control')
      expect(deck.entries).toHaveLength(1)
      expect(deck.entries[0].oracleId).toBe(SOL)
    })

    it('answers 404 for a deck that does not exist', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${randomUUID()}`,
        payload: { name: 'nope' },
      })

      expect(response.statusCode).toBe(404)
    })
  })

  // ------------------------------------------------------------------ cards

  describe('GET /api/v1/cards/:oracleId', () => {
    it('returns the card with its printings and combos', async () => {
      const response = await app.inject({ method: 'GET', url: `/api/v1/cards/${SOL}` })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body).toMatchObject({ oracleId: SOL, name: 'Sol Ring' })
      expect(Array.isArray(body.printings)).toBe(true)
      expect(body.combos).toHaveLength(1)
      expect(body.combos[0].id).toBe('c-1')
    })

    it('answers 404 for an unknown oracle id', async () => {
      const response = await app.inject({ method: 'GET', url: `/api/v1/cards/${randomUUID()}` })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('POST /api/v1/cards/batch', () => {
    it('hydrates a set of oracle ids', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cards/batch',
        payload: { oracleIds: [SOL, COUNTER] },
      })

      expect(response.statusCode).toBe(200)
      expect(
        response
          .json()
          .items.map((c: Card) => c.oracleId)
          .sort(),
      ).toEqual([SOL, COUNTER].sort())
    })

    it('silently drops nothing — unknown ids are simply absent, known ones return', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cards/batch',
        payload: { oracleIds: [SOL, randomUUID()] },
      })

      expect(response.json().items).toHaveLength(1)
    })

    it('refuses more than 500 ids per call (doc 10 §10.2)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cards/batch',
        payload: { oracleIds: Array.from({ length: 501 }, () => randomUUID()) },
      })

      expect(response.statusCode).toBe(400)
    })
  })

  describe('GET /api/v1/cards/search', () => {
    it('matches on name', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/cards/search?q=sol' })

      expect(response.statusCode).toBe(200)
      expect(response.json().items.map((c: Card) => c.name)).toContain('Sol Ring')
    })

    it('filters by colour identity', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/cards/search?colors=U' })

      const names = response.json().items.map((c: Card) => c.name)
      expect(names).toContain('Counterspell')
      expect(names).not.toContain('Mountain')
    })

    it('paginates by cursor and never by offset (doc 10 §10.1)', async () => {
      const first = await app.inject({ method: 'GET', url: '/api/v1/cards/search?limit=2' })
      const firstBody = first.json()

      expect(firstBody.items).toHaveLength(2)
      expect(firstBody.nextCursor).toEqual(expect.any(String))

      const second = await app.inject({
        method: 'GET',
        url: `/api/v1/cards/search?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      })
      const secondIds = second.json().items.map((c: Card) => c.oracleId)

      expect(secondIds).not.toEqual(firstBody.items.map((c: Card) => c.oracleId))
    })

    it('reports the position and a suggestion for an unparseable query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cards/search?q=' + encodeURIComponent('typ:creature'),
      })

      expect(response.statusCode).toBe(400)
      expect(response.json()).toMatchObject({ position: expect.any(Number) })
    })

    it('refuses deck-relative fields, which have no meaning without a deck', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cards/search?q=' + encodeURIComponent('combo>=2'),
      })

      expect(response.statusCode).toBe(400)
      expect(response.json().detail).toContain('combo')
    })
  })
  // --------------------------------------------------------------- commands

  describe('POST /api/v1/decks/:id/commands', () => {
    const send = async (id: string, commands: unknown[], over: Record<string, unknown> = {}) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/decks/${id}/commands`,
        payload: { commands, idempotencyKey: randomUUID(), baseVersion: 1, ...over },
      })

    it('applies a batch atomically and bumps the deck version', async () => {
      const created = (await createDeck()).json()

      const response = await send(created.id, [
        { type: 'accept', oracleId: SOL, origin: 'manual' },
        { type: 'accept', oracleId: MOUNTAIN, origin: 'manual' },
      ])

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.applied).toHaveLength(2)
      expect(body.rejected).toEqual([])
      expect(body.deck.version).toBe(2)
      expect(body.deck.entries).toHaveLength(2)
    })

    it('reports partial success — the legal command applies, the illegal one is named', async () => {
      const created = (await createDeck()).json()

      const response = await send(created.id, [
        { type: 'accept', oracleId: SOL, origin: 'manual' },
        { type: 'accept', oracleId: COUNTER, origin: 'manual' },
      ])

      const body = response.json()
      expect(body.applied).toHaveLength(1)
      expect(body.rejected).toHaveLength(1)
      expect(body.rejected[0].reason).toMatchObject({
        kind: 'color-identity',
        oracleId: COUNTER,
        offending: ['U'],
      })
      expect(body.deck.entries).toHaveLength(1)
    })

    it('names the reason a banned card was refused', async () => {
      const created = (await createDeck()).json()

      const body = (
        await send(created.id, [{ type: 'accept', oracleId: ANTE, origin: 'manual' }])
      ).json()

      expect(body.rejected[0].reason).toMatchObject({ kind: 'banned' })
    })

    it('refuses to re-suggest an excluded card, but lets the user re-add it (pillar P6)', async () => {
      const created = (await createDeck()).json()
      await send(created.id, [{ type: 'exclude', oracleId: SOL }])

      const resuggested = (
        await send(created.id, [{ type: 'accept', oracleId: SOL, origin: 'recommended' }], {
          baseVersion: 2,
        })
      ).json()
      expect(resuggested.rejected[0].reason).toMatchObject({ kind: 'previously-excluded' })

      // Still baseVersion 2: the rejected re-suggestion applied nothing, so it
      // did not bump the version.
      const readded = (
        await send(created.id, [{ type: 'accept', oracleId: SOL, origin: 'manual' }], {
          baseVersion: 2,
        })
      ).json()
      expect(readded.rejected).toEqual([])
      expect(readded.deck.entries[0]).toMatchObject({ oracleId: SOL, zone: 'accepted' })
    })

    it('answers 409 with the current deck when baseVersion is stale (doc 12 §12.7)', async () => {
      const created = (await createDeck()).json()
      await send(created.id, [{ type: 'accept', oracleId: SOL, origin: 'manual' }])

      const response = await send(created.id, [
        { type: 'accept', oracleId: MOUNTAIN, origin: 'manual' },
      ])

      expect(response.statusCode).toBe(409)
      const body = response.json()
      expect(body.deck.version).toBe(2)
      expect(body).toHaveProperty('since')
      // The stale batch changed nothing.
      expect(body.deck.entries).toHaveLength(1)
    })

    it('replaying an idempotency key returns the first result without applying twice', async () => {
      const created = (await createDeck()).json()
      const key = randomUUID()
      const payload = {
        commands: [{ type: 'accept', oracleId: SOL, origin: 'manual' }],
        idempotencyKey: key,
        baseVersion: 1,
      }

      const first = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${created.id}/commands`,
        payload,
      })
      const replay = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${created.id}/commands`,
        payload,
      })

      expect(replay.statusCode).toBe(200)
      expect(replay.json()).toEqual(first.json())

      const fetched = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${created.id}` })
      ).json()
      expect(fetched.entries).toHaveLength(1)
      expect(fetched.version).toBe(2)
    })

    it('refuses an idempotency key already used for a different deck', async () => {
      const a = (await createDeck()).json()
      const b = (await createDeck()).json()
      const key = randomUUID()
      await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${a.id}/commands`,
        payload: {
          commands: [{ type: 'accept', oracleId: SOL, origin: 'manual' }],
          idempotencyKey: key,
          baseVersion: 1,
        },
      })

      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${b.id}/commands`,
        payload: {
          commands: [{ type: 'accept', oracleId: SOL, origin: 'manual' }],
          idempotencyKey: key,
          baseVersion: 1,
        },
      })

      expect(response.statusCode).toBe(400)
    })

    it('rejects a core-package command rather than silently doing nothing', async () => {
      const created = (await createDeck()).json()

      const body = (await send(created.id, [{ type: 'applyCorePackage', bracket: 3 }])).json()

      expect(body.applied).toEqual([])
      expect(body.rejected[0].reason).toMatchObject({ kind: 'unsupported' })
    })

    it('answers 404 for a deck that does not exist', async () => {
      const response = await send(randomUUID(), [
        { type: 'accept', oracleId: SOL, origin: 'manual' },
      ])

      expect(response.statusCode).toBe(404)
    })

    it('refuses an unknown command type at the schema boundary', async () => {
      const created = (await createDeck()).json()

      const response = await send(created.id, [{ type: 'detonate', oracleId: SOL }])

      expect(response.statusCode).toBe(400)
    })
  })
  describe('GET /api/v1/cards/search — predicates it cannot answer', () => {
    it('answers is:gamechanger from the corpus flag (DATA-05)', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cards/search?q=' + encodeURIComponent('is:gamechanger'),
      })

      expect(response.statusCode).toBe(200)
      const ids = response.json().items.map((i: { oracleId: string }) => i.oracleId)
      expect(ids).toEqual([GAME_CHANGER])
    })

    it('answers the negated form without returning Game Changers as if clean', async () => {
      // `-is:gamechanger` is how a bracket-conscious user filters, and it was
      // refused outright until DATA-05, because answering it from an empty
      // bracketFlags list returns every Game Changer as though it were clean —
      // worse than the positive form returning nothing. Both directions are
      // asserted because only the negation fails silently.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cards/search?q=' + encodeURIComponent('-is:gamechanger'),
      })

      expect(response.statusCode).toBe(200)
      const ids = response.json().items.map((i: { oracleId: string }) => i.oracleId)
      expect(ids.length).toBeGreaterThan(0)
      expect(ids).not.toContain(GAME_CHANGER)
    })

    it('still answers is: predicates that oracle data can decide', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cards/search?q=' + encodeURIComponent('is:creature'),
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().items.length).toBeGreaterThan(0)
    })

    it('refuses a colors value with no colour in it, rather than silently meaning colourless', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/v1/cards/search?colors=Z' })

      expect(response.statusCode).toBe(400)
    })
  })
  describe('POST /api/v1/decks/:id/commands — regressions from review', () => {
    const send = async (id: string, commands: unknown[], over: Record<string, unknown> = {}) =>
      app.inject({
        method: 'POST',
        url: `/api/v1/decks/${id}/commands`,
        payload: { commands, idempotencyKey: randomUUID(), baseVersion: 1, ...over },
      })

    it('does not bump the version for a batch that applied nothing', async () => {
      const created = (await createDeck()).json()

      const body = (await send(created.id, [{ type: 'applyCorePackage', bracket: 3 }])).json()

      expect(body.applied).toEqual([])
      expect(body.deck.version).toBe(1)
    })

    it('refuses to exclude a commander', async () => {
      const created = (await createDeck()).json()

      const body = (await send(created.id, [{ type: 'exclude', oracleId: KROV }])).json()

      expect(body.applied).toEqual([])
      expect(body.rejected[0].reason).toMatchObject({ kind: 'is-commander' })
      expect(body.deck.entries).toEqual([])
    })

    it('persists locked, and a locked entry then survives exclude', async () => {
      const created = (await createDeck()).json()
      await send(created.id, [{ type: 'accept', oracleId: SOL, origin: 'manual', lock: true }])

      const fetched = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${created.id}` })
      ).json()
      expect(fetched.entries[0].locked).toBe(true)

      const body = (
        await send(created.id, [{ type: 'exclude', oracleId: SOL }], {
          baseVersion: 2,
        })
      ).json()
      expect(body.rejected[0].reason).toMatchObject({ kind: 'locked' })
      expect(body.deck.entries[0]).toMatchObject({ oracleId: SOL, zone: 'accepted' })
    })

    it('persists a role override and a lock toggle', async () => {
      const created = (await createDeck()).json()
      await send(created.id, [{ type: 'accept', oracleId: SOL, origin: 'manual' }])
      await send(created.id, [{ type: 'setRole', oracleId: SOL, roles: ['ramp'] }], {
        baseVersion: 2,
      })
      await send(created.id, [{ type: 'lock', oracleId: SOL, locked: true }], { baseVersion: 3 })

      const fetched = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${created.id}` })
      ).json()

      expect(fetched.entries[0].roleOverride).toEqual(['ramp'])
      expect(fetched.entries[0].locked).toBe(true)
    })

    it('excluding a card removes every accepted copy of it', async () => {
      const created = (await createDeck()).json()
      await send(created.id, [
        { type: 'accept', oracleId: MOUNTAIN, origin: 'manual' },
        { type: 'accept', oracleId: MOUNTAIN, origin: 'manual' },
        { type: 'accept', oracleId: MOUNTAIN, origin: 'manual' },
      ])

      const body = (
        await send(created.id, [{ type: 'exclude', oracleId: MOUNTAIN }], {
          baseVersion: 2,
        })
      ).json()

      expect(body.deck.entries.filter((e: { zone: string }) => e.zone === 'accepted')).toEqual([])
      expect(body.deck.entries.filter((e: { zone: string }) => e.zone === 'excluded')).toHaveLength(
        1,
      )
    })

    it('rejects a second copy of a non-basic card through the HTTP layer', async () => {
      const created = (await createDeck()).json()
      await send(created.id, [{ type: 'accept', oracleId: SOL, origin: 'manual' }])

      const body = (
        await send(created.id, [{ type: 'accept', oracleId: SOL, origin: 'manual' }], {
          baseVersion: 2,
        })
      ).json()

      expect(body.rejected[0].reason).toMatchObject({ kind: 'not-singleton', allowed: 1 })
    })

    it('replays under an uppercase deck id, which is the same deck', async () => {
      const created = (await createDeck()).json()
      const key = randomUUID()
      const payload = {
        commands: [{ type: 'accept', oracleId: SOL, origin: 'manual' }],
        idempotencyKey: key,
        baseVersion: 1,
      }
      await app.inject({ method: 'POST', url: `/api/v1/decks/${created.id}/commands`, payload })

      const replay = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${String(created.id).toUpperCase()}/commands`,
        payload,
      })

      expect(replay.statusCode).toBe(200)
      expect(replay.json().deck.entries).toHaveLength(1)
    })
  })

  describe('GET /api/v1/cards/search — pagination covers the table exactly', () => {
    it('walking every page yields each card once, with no gap and no repeat', async () => {
      const all = new Set<string>()
      let cursor: string | null = null
      let pages = 0

      do {
        const suffix: string = cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`
        const url: string = `/api/v1/cards/search?limit=2${suffix}`
        const body: { items: { oracleId: string }[]; nextCursor: string | null } = (
          await app.inject({ method: 'GET', url })
        ).json()
        for (const c of body.items) {
          // A repeat here means the cursor went backwards — the failure an
          // "is page 2 different from page 1" assertion cannot see.
          expect(all.has(c.oracleId)).toBe(false)
          all.add(c.oracleId)
        }
        cursor = body.nextCursor
        pages += 1
      } while (cursor !== null && pages < 50)

      const total = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/cards/batch',
          payload: { oracleIds: [SOL] },
        })
      ).json()
      expect(total.items).toHaveLength(1)
      /*
       * Every seeded card, exactly once.
       *
       * Eight: six original fixtures, plus the Game Changer that DATA-05 added
       * and the undecided-eligibility card that commander validation added.
       * Deliberately a literal and not the fixture array's length — the whole
       * point of this test is that a paging bug cannot make the expectation
       * move along with it, so it has to be updated by hand when a fixture is
       * added. Two agents each added one on the same day, which is exactly the
       * case the literal is here to catch, and it did.
       */
      expect(all.size).toBe(8)
    })
  })
  describe('Universes Beyond filter (ADR-0011)', () => {
    it('offers Universes Beyond cards by default', async () => {
      const body = (await app.inject({ method: 'GET', url: '/api/v1/cards/search?q=frodo' })).json()

      // The corpus keeps every card; only a deck's view of it narrows.
      expect(body.items.map((c: Card) => c.oracleId)).toContain(UB)
    })

    it('hides them from search when asked', async () => {
      const body = (
        await app.inject({
          method: 'GET',
          url: '/api/v1/cards/search?q=frodo&excludeUniversesBeyond=true',
        })
      ).json()

      expect(body.items.map((c: Card) => c.oracleId)).not.toContain(UB)
    })

    it('carries the setting on a deck it was created with', async () => {
      const deck = (await createDeck({ excludeUniversesBeyond: true })).json()

      expect(deck.excludeUniversesBeyond).toBe(true)
    })

    it('defaults the setting off, so the corpus stays whole until asked', async () => {
      const deck = (await createDeck()).json()

      expect(deck.excludeUniversesBeyond).toBe(false)
    })

    it('toggles the setting through PATCH', async () => {
      const created = (await createDeck()).json()

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${created.id}`,
        payload: { excludeUniversesBeyond: true },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json().excludeUniversesBeyond).toBe(true)
    })

    it('reports provenance on the card itself', async () => {
      const body = (await app.inject({ method: 'GET', url: `/api/v1/cards/${UB}` })).json()

      expect(body.universesBeyond).toBe(true)
    })
  })

  describe('printing-level query fields (ADR-0011)', () => {
    it('answers is:reserved now that printings are ingested', async () => {
      // API-01 had to reject this outright; the printings ingest gave it data.
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cards/search?q=' + encodeURIComponent('is:reserved'),
      })

      expect(response.statusCode).toBe(200)
    })

    it('answers a price query', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cards/search?q=' + encodeURIComponent('price<=5'),
      })

      expect(response.statusCode).toBe(200)
    })

    it('still rejects power, which no printing carries', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/v1/cards/search?q=' + encodeURIComponent('power>=4'),
      })

      expect(response.statusCode).toBe(400)
    })
  })

  /**
   * Card art on the wire (ADR-0021).
   *
   * The shape under test is that a card's price and its art come from two
   * DIFFERENT printings on purpose — the cheapest for the price, because that
   * is what a card costs to acquire, and the default for the image, because
   * that is which card it is. They disagree for about a third of the real
   * corpus, so a fixture where they agree would prove nothing.
   */
  describe('card art (ADR-0021)', () => {
    const DEFAULT_ART = 'https://cards.scryfall.io/art_crop/front/9/1/sol-default.jpg?1'
    const DEFAULT_NORMAL = 'https://cards.scryfall.io/normal/front/9/1/sol-default.jpg?1'
    const CHEAP_ART = 'https://cards.scryfall.io/art_crop/front/0/0/sol-cheap.jpg?1'
    const CHEAP_NORMAL = 'https://cards.scryfall.io/normal/front/0/0/sol-cheap.jpg?1'

    beforeAll(async () => {
      const sol = await getCard(db.pool, SOL)
      const counter = await getCard(db.pool, COUNTER)
      const printing = (
        over: Partial<Printing> & Pick<Printing, 'printingId' | 'oracleId'>,
      ): Printing => ({
        setCode: 'tst',
        setName: 'Test Set',
        collectorNumber: '1',
        rarity: 'uncommon',
        imageUris: { artCrop: '', normal: '' },
        priceUsd: null,
        reserved: false,
        ...over,
      })

      await upsertPrintings(db.pool, [
        // The default printing, with art, deliberately NOT the cheapest.
        printing({
          printingId: sol!.defaultPrinting!,
          oracleId: SOL,
          imageUris: { artCrop: DEFAULT_ART, normal: DEFAULT_NORMAL },
          priceUsd: 4.5,
        }),
        // Cheaper, with different art. If the route reads the cheapest printing
        // for images the way it does for prices, these URLs come back instead.
        printing({
          printingId: printingId(randomUUID()),
          oracleId: SOL,
          collectorNumber: '2',
          imageUris: { artCrop: CHEAP_ART, normal: CHEAP_NORMAL },
          priceUsd: 0.5,
        }),
        // A printing with no art at all — the 501-card case.
        printing({ printingId: counter!.defaultPrinting!, oracleId: COUNTER, priceUsd: 1 }),
      ])

      // The facts map is cached per snapshot and these rows did not exist when
      // an earlier test warmed it. Without this the route answers from a corpus
      // that predates the fixture, which would pass or fail by test order.
      clearCorpusCache()
    }, 30_000)

    afterAll(() => {
      // Leave nothing warm for whatever runs next in this file.
      clearCorpusCache()
    })

    it('returns art beside the cards, never on them', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/v1/cards/batch',
        payload: { oracleIds: [SOL] },
      })

      const body = response.json()
      expect(body.images[SOL]).toEqual({ artCrop: DEFAULT_ART, normal: DEFAULT_NORMAL })
      // Doc 02 §2.1: a `Card` is oracle identity and carries no printing facts.
      expect(body.items[0].imageUris).toBeUndefined()
    })

    it('takes the art from the default printing and the price from the cheapest', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/cards/batch',
          payload: { oracleIds: [SOL] },
        })
      ).json()

      expect(body.images[SOL].normal).toBe(DEFAULT_NORMAL)
      expect(body.images[SOL].normal).not.toBe(CHEAP_NORMAL)
      expect(body.prices[SOL]).toBe(0.5)
    })

    it('says a card has no art rather than leaving it out', async () => {
      // 501 cards in the real corpus have no art on any printing. A missing key
      // and "no art" would be the same thing on the wire, and the client would
      // show a spinner for the second one for ever.
      const body = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/cards/batch',
          payload: { oracleIds: [COUNTER] },
        })
      ).json()

      expect(Object.keys(body.images)).toEqual([COUNTER])
      expect(body.images[COUNTER]).toEqual({ artCrop: null, normal: null })
    })

    it('answers for an id that is not a card at all', async () => {
      // `getCards` drops unknown ids; `images` must still account for every id
      // asked about, or the two collections disagree about what was requested.
      const unknown = randomUUID()
      const body = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/cards/batch',
          payload: { oracleIds: [unknown] },
        })
      ).json()

      expect(body.items).toHaveLength(0)
      expect(body.images[unknown]).toEqual({ artCrop: null, normal: null })
    })

    it('sends the URLs exactly as Scryfall published them', async () => {
      // ADR-0021: no rewriting, no proxying, no resizing. A URL pointing
      // anywhere but Scryfall's own CDN means something has started re-serving
      // images, which is the `ING-04` conversation that has not happened.
      const body = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/cards/batch',
          payload: { oracleIds: [SOL] },
        })
      ).json()

      expect(body.images[SOL].artCrop).toMatch(/^https:\/\/cards\.scryfall\.io\//)
      expect(body.images[SOL].normal).toMatch(/^https:\/\/cards\.scryfall\.io\//)
    })

    it('carries art on the search results too, so the first screen has art', async () => {
      // The commander picker is the only card surface reached before a deck
      // exists, and it never calls `/cards/batch`.
      const body = (await app.inject({ method: 'GET', url: '/api/v1/cards/search?q=sol' })).json()

      expect(body.images[SOL]).toEqual({ artCrop: DEFAULT_ART, normal: DEFAULT_NORMAL })
    })
  })
})
