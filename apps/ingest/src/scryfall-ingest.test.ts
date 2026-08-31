import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { getCard } from '@roundtable/db'
import { createTestDatabase, databaseUrl, type TestDatabase } from '@roundtable/db/testing'
import { oracleId } from '@roundtable/domain'
import { ingestScryfall } from './scryfall-ingest.js'

/**
 * The ingest end to end, with every Scryfall response stubbed.
 *
 * What this pins is the WIRING: that the commander set the search returns
 * actually reaches the row written to `cards`. Both halves already have their
 * own tests — the pager in `packages/clients`, the source choice in
 * `commander-eligibility.test.ts` — and both passed while the line joining them
 * was missing, because neither of them can see it.
 *
 * Real Postgres (AGENTS.md §4); SKIP loudly without one. No network: `fetchImpl`
 * answers every URL from strings held here.
 */
const hasDatabase = databaseUrl() !== null
const describeDb = hasDatabase ? describe : describe.skip

if (!hasDatabase) {
  console.warn('[ingest] DATABASE_URL not set — skipping ingest integration tests (AGENTS.md §4)')
}

const HEART_OF_KIRAN = 'e2ee410f-2467-4f1f-84a0-8a79faedc0b3'
const KRENKO = '68418069-f615-40ef-ae0d-764192acae00'
const SOL_RING = '4d0c0b93-9b1e-4b0e-b0b2-b0b0b0b0b0b0'

/**
 * Three real cards, in the shape the bulk export writes them.
 *
 * Heart of Kiran is the one that matters and is the reason the search exists:
 * `deriveCanBeCommander` says a legendary Vehicle cannot lead a deck, and
 * Scryfall lists it. The other two agree between the sources, so they are what
 * proves the search is not simply overwriting everything with `true`.
 */
const BULK_LINES = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    oracle_id: HEART_OF_KIRAN,
    name: 'Heart of Kiran',
    type_line: 'Legendary Artifact — Vehicle',
    oracle_text: 'Flying\nCrew 3',
    cmc: 2,
    legalities: { commander: 'legal' },
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    oracle_id: KRENKO,
    name: 'Krenko, Mob Boss',
    type_line: 'Legendary Creature — Goblin Warrior',
    oracle_text: '{T}: Create X 1/1 red Goblin creature tokens.',
    cmc: 4,
    legalities: { commander: 'legal' },
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    oracle_id: SOL_RING,
    name: 'Sol Ring',
    type_line: 'Artifact',
    oracle_text: '{T}: Add {C}{C}.',
    cmc: 1,
    legalities: { commander: 'legal' },
  },
]
  .map((c) => JSON.stringify(c))
  .join('\n')

/**
 * Filler, so the answer is a plausible size.
 *
 * The ingest treats a complete-but-tiny search result as the query having
 * stopped meaning what we think and falls back — correctly, and this test hit
 * it with two ids. These stand in for the other ~3,400 commanders, and none of
 * them is in the bulk stream, which is also true of the real thing: the search
 * lists cards the corpus filter drops.
 */
const FILLER = Array.from(
  { length: 1_200 },
  (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
)

/** Scryfall's search envelope, with only the fields the pager reads. */
const searchBody = (ids: readonly string[]): string =>
  JSON.stringify({
    object: 'list',
    total_cards: ids.length,
    has_more: false,
    data: ids.map((id) => ({ oracle_id: id })),
  })

const BULK_URL = 'https://data.scryfall.invalid/bulk.jsonl'

/**
 * A fetch that answers from strings, routed by URL.
 *
 * Real `Response` objects rather than hand-rolled shapes: `streamBulkCards`
 * reads `response.body` as a web stream and `textStreamOf` branches on the
 * content headers, and a stub that faked those would be testing itself.
 */
const stubFetch = (commanderIds: readonly string[] | 'fail'): typeof fetch =>
  ((input: string) => {
    const url = String(input)
    if (url.includes('/cards/search')) {
      if (commanderIds === 'fail') {
        return Promise.resolve(new Response('nope', { status: 503 }))
      }
      return Promise.resolve(
        new Response(searchBody(commanderIds), {
          headers: { 'content-type': 'application/json' },
        }),
      )
    }
    if (url.includes('/bulk-data/')) {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            type: 'oracle_cards',
            updated_at: '2026-08-30T00:00:00.000Z',
            compressed_size: 1,
            download_uri: BULK_URL,
          }),
          { headers: { 'content-type': 'application/json' } },
        ),
      )
    }
    return Promise.resolve(
      new Response(BULK_LINES, { headers: { 'content-type': 'application/x-ndjson' } }),
    )
  }) as unknown as typeof fetch

const noSleep = (): Promise<void> => Promise.resolve()

describeDb('ingestScryfall commander eligibility', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase('ingest')
  }, 60_000)

  afterAll(async () => {
    await db?.drop()
  }, 60_000)

  it('stores what Scryfall says, including the Vehicle the text cannot justify', async () => {
    const report = await ingestScryfall(db.pool, {
      fetchImpl: stubFetch([HEART_OF_KIRAN, KRENKO, ...FILLER]),
      sleepImpl: noSleep,
    })

    expect(report.commanderEligibility.source).toBe('scryfall-search')

    // The whole point. Nothing on this card says it may lead a deck.
    expect((await getCard(db.pool, oracleId(HEART_OF_KIRAN)))?.canBeCommander).toBe(true)
    expect((await getCard(db.pool, oracleId(KRENKO)))?.canBeCommander).toBe(true)
    // Not in the search results, so `false` — the set decides both ways, and a
    // wiring that only ever wrote `true` would pass the two lines above.
    expect((await getCard(db.pool, oracleId(SOL_RING)))?.canBeCommander).toBe(false)
  }, 60_000)

  it('falls back to the derivation, and the corpus still lands', async () => {
    // A search outage must not cost the corpus. Krenko still reads as a
    // commander off its own type line; Heart of Kiran is the 26-card price of
    // the fallback, and the report is what says the price was paid.
    const report = await ingestScryfall(db.pool, {
      fetchImpl: stubFetch('fail'),
      sleepImpl: noSleep,
    })

    expect(report.commanderEligibility.source).toBe('derived-from-oracle-text')
    expect(report.cards).toBe(3)

    expect((await getCard(db.pool, oracleId(KRENKO)))?.canBeCommander).toBe(true)
    expect((await getCard(db.pool, oracleId(HEART_OF_KIRAN)))?.canBeCommander).toBe(false)
    expect((await getCard(db.pool, oracleId(SOL_RING)))?.canBeCommander).toBe(false)
  }, 60_000)
})
