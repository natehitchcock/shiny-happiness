import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import {
  createTestDatabase,
  databaseUrl,
  MIGRATIONS_DIR,
  type TestDatabase,
} from '@roundtable/db/testing'
import {
  createSnapshot,
  loadMigrations,
  migrateDown,
  migrationVersions,
  promoteSnapshot,
  insertCombos,
  setSnapshotCounts,
  upsertCards,
} from '@roundtable/db'
import type { Card, CardType, DeckCommand, OracleId } from '@roundtable/domain'
import { comboId, oracleId, printingId, rebaseCommands } from '@roundtable/domain'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'

/**
 * `API-06` — a replayable 409, and `GET /api/v1/health`.
 *
 * Against a REAL Postgres (AGENTS.md §4); skips loudly without one.
 *
 * The concurrency cases are written as two clients on one deck, because that is
 * `API-06`'s definition of done in doc 11 and because a single-client test
 * cannot fail the way the shipped code failed: it re-sent its batch blindly and
 * could not tell "someone else already did this" from "this was refused".
 */
const hasDatabase = databaseUrl() !== null
const describeDb = hasDatabase ? describe : describe.skip

if (!hasDatabase) {
  console.warn('[api] DATABASE_URL not set — skipping API-06 tests (AGENTS.md §4)')
}

const KROV = oracleId(randomUUID())
const SOL = oracleId(randomUUID())
const MOUNTAIN = oracleId(randomUUID())
const BOLT = oracleId(randomUUID())

const card = (id: OracleId, name: string, opts: Partial<Card> = {}): Card => ({
  oracleId: id,
  name,
  manaCost: '{1}',
  manaValue: 1,
  colorIdentity: opts.colorIdentity ?? ['R'],
  colors: opts.colors ?? ['R'],
  typeLine: opts.typeLine ?? 'Creature — Goblin',
  types: (opts.types ?? ['creature']) as readonly CardType[],
  oracleText: '',
  power: null,
  toughness: null,
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
  // Required since DATA-05. None of these fixtures is on Wizards' list, and
  // this suite is about concurrent edits, not brackets.
  gameChanger: false,
})

describeDb('API-06 — replayable conflicts', () => {
  let db: TestDatabase
  let app: FastifyInstance

  beforeAll(async () => {
    db = await createTestDatabase('api06')
    await upsertCards(db.pool, [
      card(KROV, 'Krovax, Test Commander', {
        typeLine: 'Legendary Creature — Vampire',
        colorIdentity: ['B', 'R'],
      }),
      card(SOL, 'Sol Ring', { typeLine: 'Artifact', colorIdentity: [], colors: [] }),
      card(MOUNTAIN, 'Mountain', { typeLine: 'Basic Land — Mountain' }),
      card(BOLT, 'Lightning Bolt', { typeLine: 'Instant' }),
    ])
    app = await buildServer({ pool: db.pool })
    // CREATE DATABASE plus the full migration set, while every other test file
    // is doing the same thing on the same server. The default 10 s hook timeout
    // is not a fact about this code.
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await db?.drop()
  }, 60_000)

  const createDeck = async (): Promise<{ id: string; version: number }> => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v1/decks',
      payload: {
        name: 'Concurrent',
        commanders: [KROV],
        targetBracket: 3,
        archetype: 'midrange',
      },
    })
    const deck = response.json()
    return { id: deck.id, version: deck.version }
  }

  const send = (id: string, commands: readonly DeckCommand[], baseVersion: number) =>
    app.inject({
      method: 'POST',
      url: `/api/v1/decks/${id}/commands`,
      payload: { commands, idempotencyKey: randomUUID(), baseVersion },
    })

  const accept = (id: OracleId): DeckCommand => ({ type: 'accept', oracleId: id, origin: 'manual' })
  const exclude = (id: OracleId): DeckCommand => ({ type: 'exclude', oracleId: id })

  const acceptedIds = (deck: { entries: { oracleId: string; zone: string }[] }): string[] =>
    deck.entries.filter((e) => e.zone === 'accepted').map((e) => e.oracleId)

  // ------------------------------------------------------------------ `since`

  describe('the 409 body', () => {
    it('carries the commands accepted since the client’s version', async () => {
      const deck = await createDeck()
      await send(deck.id, [accept(SOL)], 1)
      await send(deck.id, [accept(BOLT)], 2)

      const stale = await send(deck.id, [accept(MOUNTAIN)], 1)

      expect(stale.statusCode).toBe(409)
      const body = stale.json()
      expect(body.deck.version).toBe(3)
      expect(body.since).toEqual([accept(SOL), accept(BOLT)])
      expect(body.sinceComplete).toBe(true)
    })

    it('groups the same commands by version, each with the instant it was applied', async () => {
      const deck = await createDeck()
      await send(deck.id, [accept(SOL)], 1)
      await send(deck.id, [accept(BOLT), accept(MOUNTAIN)], 2)

      const body = (await send(deck.id, [accept(MOUNTAIN)], 1)).json()

      expect(body.sinceBatches.map((b: { version: number }) => b.version)).toEqual([2, 3])
      expect(body.sinceBatches[1].commands).toHaveLength(2)
      // Doc 12 §12.7 resolves a genuine conflict by wall clock, which a bare
      // command list cannot express.
      expect(Date.parse(body.sinceBatches[0].appliedAt)).not.toBeNaN()
      // The flat view is the same data, so the two can never disagree.
      expect(body.since).toEqual(
        body.sinceBatches.flatMap((b: { commands: unknown[] }) => b.commands),
      )
    })

    it('records what the batch applied and NOT what it rejected', async () => {
      const deck = await createDeck()
      // One accept applies; the core-package command is rejected as unsupported.
      await send(deck.id, [accept(SOL), { type: 'applyCorePackage', bracket: 3 }], 1)

      const body = (await send(deck.id, [accept(BOLT)], 1)).json()

      expect(body.since).toEqual([accept(SOL)])
      expect(body.since).not.toContainEqual({ type: 'applyCorePackage', bracket: 3 })
    })

    it('answers the same way when the stale batch would have applied nothing', async () => {
      // The early-return branch: `applied.length === 0` short-circuits before
      // `applyBatch` ever runs, and it used to send `since: []` unconditionally.
      const deck = await createDeck()
      await send(deck.id, [accept(SOL)], 1)

      const stale = await send(deck.id, [{ type: 'applyCorePackage', bracket: 3 }], 1)

      expect(stale.statusCode).toBe(409)
      expect(stale.json().since).toEqual([accept(SOL)])
      expect(stale.json().sinceComplete).toBe(true)
    })

    it('reports an unbridgeable gap as incomplete rather than as an empty history', async () => {
      const deck = await createDeck()
      await send(deck.id, [accept(SOL)], 1)
      await send(deck.id, [accept(BOLT)], 2)
      // A deck edited before the log existed looks exactly like this.
      await db.pool.query('DELETE FROM deck_command_log WHERE deck_id = $1 AND version = 2', [
        deck.id,
      ])

      const body = (await send(deck.id, [accept(MOUNTAIN)], 1)).json()

      expect(body.sinceComplete).toBe(false)
      expect(body.since).not.toEqual([])
    })

    it('leaves the deck untouched — a 409 applies nothing', async () => {
      const deck = await createDeck()
      await send(deck.id, [accept(SOL)], 1)

      await send(deck.id, [accept(MOUNTAIN)], 1)

      const after = (await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}` })).json()
      expect(acceptedIds(after)).toEqual([SOL])
      expect(after.version).toBe(2)
    })
  })

  // ------------------------------------------------------- two clients, one deck

  /**
   * Each of these runs the REAL client path: `rebaseCommands` is the function
   * `apps/web/src/App.tsx` calls on a 409, so a rule that is wrong here is
   * wrong in the browser.
   */
  describe('two clients editing one deck', () => {
    /** What the client does with a 409: rebase onto `since`, then re-send. */
    const replayAfterConflict = async (
      deckId: string,
      queued: readonly DeckCommand[],
      conflict: { since: DeckCommand[]; sinceComplete: boolean; deck: { version: number } },
    ) => {
      const rebased = conflict.sinceComplete
        ? rebaseCommands(queued, conflict.since)
        : { replay: queued, superseded: [], overrides: [] }
      const result =
        rebased.replay.length === 0
          ? null
          : (await send(deckId, rebased.replay, conflict.deck.version)).json()
      return { ...rebased, result }
    }

    it('converges without data loss when both clients add different cards', async () => {
      const deck = await createDeck()

      // Both clients hold version 1. A gets there first.
      const a = await send(deck.id, [accept(SOL)], 1)
      expect(a.statusCode).toBe(200)

      const b = await send(deck.id, [accept(MOUNTAIN)], 1)
      expect(b.statusCode).toBe(409)

      const replayed = await replayAfterConflict(deck.id, [accept(MOUNTAIN)], b.json())

      expect(replayed.superseded).toEqual([])
      expect(replayed.overrides).toEqual([])
      // Neither client's work was lost, and neither overwrote the other.
      expect(acceptedIds(replayed.result.deck).sort()).toEqual([SOL, MOUNTAIN].sort())
      expect(replayed.result.deck.version).toBe(3)
    })

    it('drops a command the other client already carried out, instead of earning a rejection', async () => {
      const deck = await createDeck()
      await send(deck.id, [accept(SOL)], 1)

      // Both clients then exclude Sol Ring. A wins the race.
      const a = await send(deck.id, [exclude(SOL)], 2)
      expect(a.statusCode).toBe(200)
      const b = await send(deck.id, [exclude(SOL)], 2)
      expect(b.statusCode).toBe(409)

      const replayed = await replayAfterConflict(deck.id, [exclude(SOL)], b.json())

      // Nothing re-sent: the state B asked for is already true. Re-sending
      // blindly — what the code did before API-06 — earned an
      // `already-excluded` rejection, which reads to the user as "your click
      // failed" for a click that in fact succeeded.
      expect(replayed.replay).toEqual([])
      expect(replayed.superseded[0]?.reason).toBe('already-excluded')
      expect(replayed.result).toBeNull()

      const after = (await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}` })).json()
      expect(acceptedIds(after)).toEqual([])
      expect(after.version).toBe(3)
    })

    it('names the conflict when one client accepts what the other excluded (doc 12 §12.7)', async () => {
      const deck = await createDeck()
      await send(deck.id, [accept(SOL)], 1)

      const a = await send(deck.id, [exclude(SOL)], 2)
      expect(a.statusCode).toBe(200)
      const b = await send(deck.id, [accept(SOL)], 2)
      expect(b.statusCode).toBe(409)

      const replayed = await replayAfterConflict(deck.id, [accept(SOL)], b.json())

      // The accept still applies — pillar P6 binds the recommender, not the
      // user — but the client now KNOWS it overrode a foreign exclusion. That
      // is the whole difference: before, this clobbered silently.
      expect(replayed.overrides).toHaveLength(1)
      expect(replayed.overrides[0]?.by).toEqual(exclude(SOL))
      expect(acceptedIds(replayed.result.deck)).toEqual([SOL])
      expect(
        replayed.result.deck.entries.filter((e: { zone: string }) => e.zone === 'excluded'),
      ).toHaveLength(0)
    })

    it('keeps the half of a batch the other client did not touch', async () => {
      const deck = await createDeck()

      const a = await send(deck.id, [accept(SOL), exclude(BOLT)], 1)
      expect(a.statusCode).toBe(200)

      // B queued three things; one of them is already done.
      const queued = [accept(MOUNTAIN), exclude(BOLT), accept(SOL)]
      const b = await send(deck.id, queued, 1)
      expect(b.statusCode).toBe(409)

      const replayed = await replayAfterConflict(deck.id, queued, b.json())

      expect(replayed.replay).toEqual([accept(MOUNTAIN), accept(SOL)])
      expect(replayed.superseded).toHaveLength(1)
      // Accepting Sol Ring twice is refused by the singleton rule, honestly —
      // the client does not silently drop it, because it cannot tell a Sol Ring
      // from a Mountain without card data.
      expect(replayed.result.rejected[0].reason).toMatchObject({ kind: 'not-singleton' })
      expect(acceptedIds(replayed.result.deck).sort()).toEqual([SOL, MOUNTAIN].sort())
    })

    it('converges when three clients start from the same version', async () => {
      const deck = await createDeck()

      const responses = [
        await send(deck.id, [accept(SOL)], 1),
        await send(deck.id, [accept(MOUNTAIN)], 1),
        await send(deck.id, [accept(BOLT)], 1),
      ]
      expect(responses.filter((r) => r.statusCode === 409)).toHaveLength(2)

      // Each loser rebases against a `since` that grows as the earlier loser
      // lands, so the last one sees two foreign batches.
      for (const [index, queued] of [[accept(MOUNTAIN)], [accept(BOLT)]].entries()) {
        const current = (
          await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}` })
        ).json()
        const conflict = (await send(deck.id, queued, 1)).json()
        expect(conflict.sinceComplete).toBe(true)
        expect(conflict.since).toHaveLength(index + 1)
        await replayAfterConflict(deck.id, queued, { ...conflict, deck: current })
      }

      const after = (await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}` })).json()
      expect(acceptedIds(after).sort()).toEqual([SOL, MOUNTAIN, BOLT].sort())
    })
  })
})

// ------------------------------------------------------------------- health

describeDb('GET /api/v1/health', () => {
  let db: TestDatabase
  let app: FastifyInstance

  beforeAll(async () => {
    db = await createTestDatabase('health')
    app = await buildServer({ pool: db.pool })
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await db?.drop()
  }, 60_000)

  const get = () => app.inject({ method: 'GET', url: '/api/v1/health' })

  beforeEach(async () => {
    await db.pool.query('DELETE FROM dataset_snapshots')
  })

  it('reports the applied migration head', async () => {
    const shipped = await migrationVersions(MIGRATIONS_DIR)

    const body = (await get()).json()

    expect(body.schema.applied).toBe(shipped[shipped.length - 1])
    expect(body.schema.expected).toBe(shipped[shipped.length - 1])
    expect(body.schema.pending).toEqual([])
    expect(body.schema.upToDate).toBe(true)
  })

  it('is `ok` and 200 once the corpus is loaded', async () => {
    const id = randomUUID()
    await createSnapshot(db.pool, id, 'scryfall')
    await setSnapshotCounts(db.pool, id, { cards: 34_492, combos: 108_046 })
    await promoteSnapshot(db.pool, id, 'scryfall')

    const response = await get()

    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({
      status: 'ok',
      corpus: { loaded: true, snapshotId: id, cardCount: 34_492 },
      database: { reachable: true },
    })
  })

  it('counts the combos that exist, not the ones the last run wrote', async () => {
    /*
     * The defect this catches, seen on production within a minute of the
     * endpoint going live: it reported `comboCount: 0` beside `loaded: true`
     * on a corpus holding 108,135 combos.
     *
     * A snapshot records what ONE ingest run wrote. A cards ingest writes a
     * fresh live snapshot with `combo_count: 0`, because that run ingests no
     * combos — the combos are still in the table, untouched. Reading the count
     * off the snapshot therefore says the combo corpus is empty every time
     * anyone re-ingests cards, which is the most common maintenance action
     * there is. A diagnostic that says the wrong thing is worse than one that
     * says nothing.
     */
    await insertCombos(db.pool, [
      {
        id: comboId('health-1'),
        pieces: [oracleId(randomUUID()), oracleId(randomUUID())],
        produces: ['infinite-mana'],
      },
    ])

    const id = randomUUID()
    await createSnapshot(db.pool, id, 'scryfall')
    // Exactly what a cards-only ingest leaves behind.
    await setSnapshotCounts(db.pool, id, { cards: 34_492, combos: 0 })
    await promoteSnapshot(db.pool, id, 'scryfall')

    expect((await get()).json().corpus.comboCount).toBe(1)
  })

  it('is `degraded`, not `ok`, when the schema is current but no corpus is live', async () => {
    // DEPLOYING.md step 4: a migrated database with no ingest answers every
    // route with an empty result and no error at all.
    const body = (await get()).json()

    expect(body.status).toBe('degraded')
    expect(body.corpus).toMatchObject({ loaded: false, snapshotId: null, cardCount: null })
    expect(body.schema.upToDate).toBe(true)
  })

  /*
   * The failure this endpoint was added for. Production ran four migrations
   * behind for weeks and never returned an error — `0006` adds power/toughness
   * and an unapplied column serves nulls, which render as absent.
   */
  it('names every unapplied migration when the deployment is behind', async () => {
    const scratch = await createTestDatabase('behind_api')
    const behind = await buildServer({ pool: scratch.pool })
    try {
      const shipped = await migrationVersions(MIGRATIONS_DIR)
      await migrateDown(scratch.pool, await loadMigrations(MIGRATIONS_DIR), 4)

      const response = await behind.inject({ method: 'GET', url: '/api/v1/health' })

      // Still 200: the deployment IS serving. Taking it out of a load balancer
      // over a missing migration would be worse than the missing migration.
      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.status).toBe('degraded')
      expect(body.schema.upToDate).toBe(false)
      expect(body.schema.pending).toEqual(shipped.slice(-4))
      expect(body.schema.applied).toBe(shipped[shipped.length - 5])
      expect(body.schema.expected).toBe(shipped[shipped.length - 1])
    } finally {
      await behind.close()
      await scratch.drop()
    }
  }, 60_000)

  describe('when the database cannot be reached', () => {
    const PASSWORD = 'hunter2-do-not-leak'
    const HOST = 'no-such-host.invalid'
    let dead: Pool
    let deadApp: FastifyInstance

    beforeAll(async () => {
      dead = new Pool({
        connectionString: `postgresql://someuser:${PASSWORD}@${HOST}:5432/somedb`,
        // Fail fast: the point is the answer, not the wait.
        connectionTimeoutMillis: 3_000,
      })
      // A pool whose connections always fail emits an 'error' event; without a
      // listener Node treats it as unhandled and kills the test run.
      dead.on('error', () => undefined)
      deadApp = await buildServer({ pool: dead })
    }, 30_000)

    afterAll(async () => {
      await deadApp?.close()
      await dead?.end().catch(() => undefined)
    }, 30_000)

    it('answers 503 with a usable body instead of an opaque 500', async () => {
      const response = await deadApp.inject({ method: 'GET', url: '/api/v1/health' })

      expect(response.statusCode).toBe(503)
      const body = response.json()
      expect(body.status).toBe('unavailable')
      expect(body.database.reachable).toBe(false)
      // The shape does not change when things break — the fields an operator
      // came for are still there, saying they are unknown.
      expect(body.schema).toHaveProperty('applied', null)
      expect(body.corpus).toHaveProperty('loaded', false)
    })

    it('never leaks the connection string, the password or the host', async () => {
      const raw = (await deadApp.inject({ method: 'GET', url: '/api/v1/health' })).body

      expect(raw).not.toContain(PASSWORD)
      expect(raw).not.toContain(HOST)
      expect(raw).not.toContain('someuser')
      expect(raw).not.toContain('postgresql://')
    })

    it('names the environment variables that ARE set, so a near miss is visible', async () => {
      const body = (await deadApp.inject({ method: 'GET', url: '/api/v1/health' })).json()

      // `serverless.ts`'s precedent: the usual cause is POSTGRES_URL set and
      // DATABASE_URL not. Names only — a value would be the leak above.
      expect(body.database.detail).toContain('DATABASE_URL')
      expect(typeof body.database.code).toBe('string')
    })
  })
})
