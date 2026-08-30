import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, databaseUrl, type TestDatabase } from '@roundtable/db/testing'
import { insertCombos, upsertCards } from '@roundtable/db'
import type { Card, Combo, OracleId } from '@roundtable/domain'
import { comboId, oracleId, printingId } from '@roundtable/domain'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'

/**
 * API-02's budget: full recompute < 200 ms p95 on a 100-card deck (doc 11).
 *
 * Measured against a corpus of realistic size, because the cost is dominated by
 * the candidate pool rather than the deck: a 5-colour deck sees essentially the
 * whole legal card table. A budget measured against six fixture cards would pass
 * forever and mean nothing.
 */
const hasDatabase = databaseUrl() !== null
const describeDb = hasDatabase ? describe : describe.skip

if (!hasDatabase) {
  console.warn('[api] DATABASE_URL not set — skipping API-02 performance test (AGENTS.md §4)')
}

const CORPUS = 20_000
const COMBOS = 2_000
const DECK_SIZE = 99
const BUDGET_MS = 200
const RUNS = 20

const ROLES = ['ramp', 'draw', 'spot-removal', 'board-wipe', 'tutor', 'synergy', 'wincon'] as const
const COLORS = ['W', 'U', 'B', 'R', 'G'] as const

describeDb('API-02 performance', () => {
  let db: TestDatabase
  let app: FastifyInstance
  let deckId: string
  const ids: OracleId[] = []

  beforeAll(async () => {
    db = await createTestDatabase('api02perf')

    // Deterministic, not random: a perf test that shuffles its own corpus
    // produces a different number every run and cannot be regressed against.
    const cards: Card[] = []
    for (let i = 0; i < CORPUS; i += 1) {
      const id = oracleId(randomUUID())
      ids.push(id)
      const role = ROLES[i % ROLES.length]!
      const isLand = i % 12 === 0
      cards.push({
        oracleId: id,
        name: `Card ${String(i).padStart(6, '0')}`,
        manaCost: isLand ? null : `{${i % 7}}{${COLORS[i % 5]!}}`,
        manaValue: isLand ? 0 : i % 8,
        colorIdentity: [COLORS[i % 5]!],
        colors: isLand ? [] : [COLORS[i % 5]!],
        typeLine: isLand ? 'Land' : 'Creature — Human',
        types: [isLand ? 'land' : 'creature'],
        oracleText: 'text',
        keywords: [],
        legalities: { commander: 'legal' },
        edhrecRank: i,
        defaultPrinting: printingId(randomUUID()),
        roles: [isLand ? 'land' : role],
        primaryRole: isLand ? 'land' : role,
      })
    }
    // The commander must be mono-red so the eligible pool is a realistic slice.
    const commander = ids[0]!
    cards[0] = { ...cards[0]!, typeLine: 'Legendary Creature — Human', colorIdentity: ['R'] }

    for (let i = 0; i < cards.length; i += 2000) {
      await upsertCards(db.pool, cards.slice(i, i + 2000))
    }

    const combos: Combo[] = []
    for (let i = 0; i < COMBOS; i += 1) {
      combos.push({
        id: comboId(`c-${i}`),
        pieces: [ids[(i * 3) % CORPUS]!, ids[(i * 7 + 1) % CORPUS]!],
        prerequisites: '',
        steps: [],
        produces: ['infinite-mana'],
        colorIdentity: ['R'],
      })
    }
    await insertCombos(db.pool, combos)

    app = await buildServer({ pool: db.pool })
    await app.ready()

    const deck = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/decks',
        payload: {
          name: 'Perf deck',
          commanders: [commander],
          targetBracket: 3,
          archetype: 'midrange',
        },
      })
    ).json()
    deckId = deck.id

    // 99 cards + 1 commander = a full deck.
    const redCards = ids.filter((_, i) => i % 5 === 3).slice(0, DECK_SIZE)
    const response = await app.inject({
      method: 'POST',
      url: `/api/v1/decks/${deckId}/commands`,
      payload: {
        commands: redCards.map((id) => ({ type: 'accept', oracleId: id, origin: 'manual' })),
        idempotencyKey: randomUUID(),
        baseVersion: 1,
      },
    })
    expect(response.statusCode).toBe(200)
  }, 300_000)

  afterAll(async () => {
    await app?.close()
    await db?.drop()
  }, 60_000)

  it(`recomputes a 100-card deck under ${BUDGET_MS} ms at p95`, async () => {
    // One warm-up: the first call pays for pool warm-up and JIT, and including
    // it would measure startup rather than the recompute.
    await app.inject({
      method: 'POST',
      url: `/api/v1/decks/${deckId}/recommendations`,
      payload: {},
    })

    const timings: number[] = []
    for (let i = 0; i < RUNS; i += 1) {
      const started = performance.now()
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${deckId}/recommendations`,
        payload: {},
      })
      timings.push(performance.now() - started)
      expect(response.statusCode).toBe(200)
    }

    timings.sort((a, b) => a - b)
    const p95 = timings[Math.min(timings.length - 1, Math.ceil(timings.length * 0.95) - 1)]!
    const median = timings[Math.floor(timings.length / 2)]!
    console.log(
      `[perf] corpus=${CORPUS} combos=${COMBOS} deck=${DECK_SIZE + 1} ` +
        `median=${median.toFixed(1)}ms p95=${p95.toFixed(1)}ms budget=${BUDGET_MS}ms`,
    )

    expect(p95).toBeLessThan(BUDGET_MS)
  }, 300_000)
})
