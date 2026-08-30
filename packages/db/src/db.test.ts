import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type { Card, Combo, DeckId, OracleId } from '@roundtable/domain'
import { buildComboIndex, comboDegree, comboId, deckId } from '@roundtable/domain'
import { loadMigrations, migrateDown, migrateUp } from './index.js'
import { combosContaining, combosWithin, insertCombos } from './repositories/combos.js'
import {
  findEligibleCards,
  getCard,
  getCards,
  searchCardsByName,
  upsertCards,
} from './repositories/cards.js'
import {
  applyBatch,
  createDeck,
  getDeck,
  listDeckSummaries,
  removeAllCopies,
  removeEntry,
  restoreDeck,
  setEntry,
  setEntryStandalone,
  softDeleteDeck,
} from './repositories/decks.js'
import { createTestDatabase, databaseUrl, MIGRATIONS_DIR, type TestDatabase } from './testing.js'

const url = databaseUrl()
// Loud, not silent: a skipped integration suite must be visible, or a broken
// query ships because nobody noticed the tests never ran.
if (url === null) {
  console.warn('\n[db] DATABASE_URL not set — SKIPPING integration tests against real Postgres.\n')
}
const describeDb = url === null ? describe.skip : describe

const uuid = () => randomUUID() as OracleId

const card = (name: string, over: Partial<Card> = {}): Card => ({
  oracleId: over.oracleId ?? uuid(),
  name,
  manaCost: '{1}{R}',
  manaValue: 2,
  colorIdentity: ['R'],
  colors: ['R'],
  typeLine: 'Creature — Goblin',
  types: ['creature'],
  oracleText: '',
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: 100,
  defaultPrinting: null,
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

describeDb('packages/db against real PostgreSQL', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase('main')
  }, 60_000)

  afterAll(async () => {
    await db?.drop()
  })

  describe('migrations', () => {
    it('applied every migration', async () => {
      const { rows } = await db.pool.query<{ version: string }>(
        'SELECT version FROM schema_migrations',
      )
      expect(rows.length).toBeGreaterThan(0)
    })

    it('created the tables the schema declares', async () => {
      const { rows } = await db.pool.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      )
      const names = rows.map((r) => r.table_name)
      for (const table of ['cards', 'printings', 'combos', 'decks', 'deck_entries', 'card_stats']) {
        expect(names).toContain(table)
      }
    })

    it('created the GIN index the combo hot path depends on', async () => {
      const { rows } = await db.pool.query<{ indexdef: string }>(
        "SELECT indexdef FROM pg_indexes WHERE indexname = 'combos_pieces_idx'",
      )
      expect(rows[0]?.indexdef).toContain('gin')
      expect(rows[0]?.indexdef).toContain('pieces')
    })

    it('runs up and down cleanly', async () => {
      const scratch = await createTestDatabase('migrate')
      try {
        const migrations = await loadMigrations(MIGRATIONS_DIR)
        const reverted = await migrateDown(scratch.pool, migrations, migrations.length)
        expect(reverted.length).toBe(migrations.length)
        const { rows } = await scratch.pool.query<{ table_name: string }>(
          "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
        )
        expect(rows.map((r) => r.table_name)).not.toContain('cards')

        const applied = await migrateUp(scratch.pool, migrations)
        expect(applied.length).toBe(migrations.length)
      } finally {
        await scratch.drop()
      }
    }, 60_000)

    it('is idempotent — a second up applies nothing', async () => {
      const applied = await migrateUp(db.pool, await loadMigrations(MIGRATIONS_DIR))
      expect(applied).toEqual([])
    })
  })

  describe('schema constraints do the enforcing', () => {
    /**
     * `printings.oracle_id` references `cards`, so a printing cannot be written
     * before the card it belongs to.
     *
     * The Scryfall ingest READS printings first — it must, because Universes
     * Beyond provenance is a tally over every printing (ADR-0011) and no card
     * row can be written until that tally is complete. It also WROTE them first
     * for a long time, which works on any database that already holds a corpus
     * and fails on an empty one. So it passed locally forever and failed the
     * first time it was pointed at a fresh Neon database — the only run where
     * the order could possibly matter.
     */
    it('refuses a printing whose oracle card has not been written yet', async () => {
      await expect(
        db.pool.query(
          `INSERT INTO printings (printing_id, oracle_id, set_code, set_name,
                                  collector_number, rarity, image_art_crop,
                                  image_normal, price_usd, reserved)
           VALUES ($1, $2, 'tst', 'Test Set', '1', 'common', 'a', 'b', NULL, false)`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow(/foreign key constraint/i)
    })

    it('accepts a printing once its card exists', async () => {
      const subject = card('Printed Card')
      await upsertCards(db.pool, [subject])
      await expect(
        db.pool.query(
          `INSERT INTO printings (printing_id, oracle_id, set_code, set_name,
                                  collector_number, rarity, image_art_crop,
                                  image_normal, price_usd, reserved)
           VALUES ($1, $2, 'tst', 'Test Set', '1', 'common', 'a', 'b', NULL, false)`,
          [randomUUID(), subject.oracleId],
        ),
      ).resolves.toBeDefined()
    })

    it('refuses a combo with no pieces', async () => {
      await expect(
        db.pool.query("INSERT INTO combos (combo_id, pieces) VALUES ('empty', '{}')"),
      ).rejects.toThrow(/combos_have_pieces/)
    })

    it('refuses an out-of-range bracket', async () => {
      await expect(
        db.pool.query(
          `INSERT INTO decks (id, owner_id, name, target_bracket, archetype)
           VALUES ($1, $2, 'x', 9, 'midrange')`,
          [randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow(/decks_bracket_range/)
    })

    it('refuses three commanders', async () => {
      await expect(
        db.pool.query(
          `INSERT INTO decks (id, owner_id, name, commanders, target_bracket, archetype)
           VALUES ($1, $2, 'x', ARRAY[$3,$4,$5]::uuid[], 3, 'midrange')`,
          [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()],
        ),
      ).rejects.toThrow(/decks_commander_count/)
    })

    it('refuses an unknown zone', async () => {
      const owner = randomUUID()
      const id = deckId(randomUUID())
      await createDeck(db.pool, {
        id,
        ownerId: owner,
        name: 'x',
        commanders: [],
        targetBracket: 3,
        archetype: 'midrange',
        colorIdentity: ['R'],
      })
      await expect(
        db.pool.query(
          `INSERT INTO deck_entries (deck_id, oracle_id, zone, origin) VALUES ($1, $2, 'maybe', 'manual')`,
          [id, uuid()],
        ),
      ).rejects.toThrow(/deck_entries_zone_known/)
    })
  })

  describe('cards', () => {
    it('upserts and reads back', async () => {
      const sol = card('Sol Ring', { typeLine: 'Artifact', types: ['artifact'], colorIdentity: [] })
      await upsertCards(db.pool, [sol])
      const back = await getCard(db.pool, sol.oracleId)
      expect(back?.name).toBe('Sol Ring')
      expect(back?.colorIdentity).toEqual([])
      expect(back?.types).toEqual(['artifact'])
    })

    it('updates on conflict rather than duplicating', async () => {
      const id = uuid()
      await upsertCards(db.pool, [card('First', { oracleId: id })])
      await upsertCards(db.pool, [card('Second', { oracleId: id, edhrecRank: 7 })])
      const back = await getCard(db.pool, id)
      expect(back?.name).toBe('Second')
      expect(back?.edhrecRank).toBe(7)
    })

    it('round-trips a card with no printing resolved yet (ADR-0007)', async () => {
      const c = card('No Art Yet', { defaultPrinting: null })
      await upsertCards(db.pool, [c])
      expect((await getCard(db.pool, c.oracleId))?.defaultPrinting).toBeNull()
    })

    it('accepts a batch containing the same oracle id twice', async () => {
      // ON CONFLICT DO UPDATE cannot touch a row twice in one statement, so an
      // undeduped batch aborted entirely. Bulk Scryfall data contains repeats.
      const id = uuid()
      const written = await upsertCards(db.pool, [
        card('First Write', { oracleId: id }),
        card('Second Write', { oracleId: id }),
      ])
      expect(written).toBe(1)
      expect((await getCard(db.pool, id))?.name).toBe('Second Write')
    })

    it('returns null for a card it does not have', async () => {
      expect(await getCard(db.pool, uuid())).toBeNull()
    })

    it('filters candidates by colour identity in SQL', async () => {
      const red = card('Red Card', { colorIdentity: ['R'] })
      const green = card('Green Card', { colorIdentity: ['G'] })
      const colorless = card('Colorless Card', { colorIdentity: [] })
      await upsertCards(db.pool, [red, green, colorless])

      const eligible = await findEligibleCards(db.pool, ['R'])
      const names = eligible.map((c) => c.name)
      expect(names).toContain('Red Card')
      expect(names).toContain('Colorless Card')
      expect(names).not.toContain('Green Card')
    })

    it('excludes banned cards from the eligible pool', async () => {
      await upsertCards(db.pool, [card('Banned Thing', { legalities: { commander: 'banned' } })])
      const names = (await findEligibleCards(db.pool, ['R'])).map((c) => c.name)
      expect(names).not.toContain('Banned Thing')
    })

    it('excludes basic lands from the eligible pool', async () => {
      await upsertCards(db.pool, [
        card('Mountain', {
          typeLine: 'Basic Land — Mountain',
          types: ['land'],
          colorIdentity: ['R'],
        }),
      ])
      const names = (await findEligibleCards(db.pool, ['R'])).map((c) => c.name)
      expect(names).not.toContain('Mountain')
    })

    it('searches by name case-insensitively', async () => {
      await upsertCards(db.pool, [card('Goblin Bombardment')])
      const found = await searchCardsByName(db.pool, 'bombard')
      expect(found.map((c) => c.name)).toContain('Goblin Bombardment')
    })

    it('treats LIKE wildcards in a search term as literals', async () => {
      // Unescaped, a user typing "_" matched every card in the table — a search
      // box that quietly returns everything.
      await upsertCards(db.pool, [card('Percent % Card'), card('Underscore _ Card')])
      const all = await searchCardsByName(db.pool, '%')
      // Assert the match, not just that nothing unexpected came back: an empty
      // result satisfies `every()` vacuously and would hide the bug.
      expect(all.map((c) => c.name)).toEqual(['Percent % Card'])
      const one = await searchCardsByName(db.pool, '_ Card')
      expect(one.map((c) => c.name)).toEqual(['Underscore _ Card'])
    })

    it('batch-fetches by id', async () => {
      const a = card('Batch A')
      const b = card('Batch B')
      await upsertCards(db.pool, [a, b])
      const back = await getCards(db.pool, [a.oracleId, b.oracleId])
      expect(back).toHaveLength(2)
    })

    it('handles an empty batch without a query', async () => {
      expect(await getCards(db.pool, [])).toEqual([])
      expect(await upsertCards(db.pool, [])).toBe(0)
    })
  })

  describe('combos — the GIN-indexed hot path', () => {
    const kiki = uuid()
    const conscripts = uuid()
    const bombardment = uuid()
    const unrelated = uuid()

    const combo = (id: string, pieces: OracleId[]): Combo => ({
      id: comboId(id),
      pieces,
      prerequisites: '',
      steps: [],
      produces: ['infinite-damage'],
      colorIdentity: ['R'],
    })

    beforeAll(async () => {
      await insertCombos(db.pool, [
        combo('kiki-conscripts', [kiki, conscripts]),
        combo('kiki-bombardment', [kiki, conscripts, bombardment]),
        combo('elsewhere', [unrelated]),
      ])
    })

    it('finds every combo containing a card', async () => {
      const found = await combosContaining(db.pool, [kiki])
      expect(found.map((c) => c.id).sort()).toEqual(['kiki-bombardment', 'kiki-conscripts'])
    })

    it('finds combos for several cards at once', async () => {
      const found = await combosContaining(db.pool, [kiki, unrelated])
      expect(found).toHaveLength(3)
    })

    it('finds combos fully contained in an accepted set', async () => {
      const found = await combosWithin(db.pool, [kiki, conscripts])
      expect(found.map((c) => c.id)).toEqual(['kiki-conscripts'])
    })

    it('returns nothing for a card in no combo', async () => {
      expect(await combosContaining(db.pool, [uuid()])).toEqual([])
      expect(await combosContaining(db.pool, [])).toEqual([])
    })

    it('feeds the domain combo index, and degrees agree', async () => {
      // The point of the schema: what comes out of Postgres is what the pure
      // domain function expects, with no reshaping in between.
      const combos = await combosContaining(db.pool, [kiki, conscripts, bombardment])
      const index = buildComboIndex(combos)
      const accepted = new Set([conscripts, bombardment])
      expect(comboDegree(index, accepted, kiki)).toBe(2)
    })

    it('uses the GIN index rather than a sequential scan', async () => {
      // A GIN index the planner ignores is not an index. `SET` is per-connection,
      // so this pins one client — issued on the pool it could land on a different
      // connection than the EXPLAIN, and would leak the setting if the assertion
      // threw.
      const client = await db.pool.connect()
      try {
        await client.query('SET LOCAL enable_seqscan = off')
        await client.query('BEGIN')
        await client.query('SET LOCAL enable_seqscan = off')
        const { rows } = await client.query<{ 'QUERY PLAN': string }>(
          'EXPLAIN SELECT * FROM combos WHERE pieces && $1::uuid[]',
          [[kiki]],
        )
        await client.query('ROLLBACK')
        expect(rows.map((r) => r['QUERY PLAN']).join('\n')).toMatch(/combos_pieces_idx/)
      } finally {
        client.release()
      }
    })
  })

  describe('decks', () => {
    const owner = randomUUID()
    let id: DeckId
    const krenko = uuid()

    beforeAll(async () => {
      id = deckId(randomUUID())
      await createDeck(db.pool, {
        id,
        ownerId: owner,
        name: 'Goblins',
        commanders: [krenko],
        targetBracket: 3,
        archetype: 'tokens',
        colorIdentity: ['R'],
      })
    })

    it('round-trips a deck', async () => {
      const deck = await getDeck(db.pool, id)
      expect(deck?.name).toBe('Goblins')
      expect(deck?.commanders).toEqual([krenko])
      expect(deck?.archetype).toBe('tokens')
      expect(deck?.version).toBe(1)
    })

    it('stores duplicate copies as separate rows', async () => {
      // The bug that let a four-Sol-Ring deck validate: entries keyed by
      // (deck, oracle_id) would collapse 34 Mountains into one.
      const mountain = uuid()
      for (let i = 0; i < 34; i++) {
        await setEntryStandalone(db.pool, id, {
          oracleId: mountain,
          zone: 'accepted',
          origin: 'manual',
          locked: false,
          tags: [],
        })
      }
      const deck = await getDeck(db.pool, id)
      expect(deck!.entries.filter((e) => e.oracleId === mountain)).toHaveLength(34)
    })

    it('allows a card to be excluded only once (pillar P6)', async () => {
      const rejected = uuid()
      await setEntryStandalone(db.pool, id, {
        oracleId: rejected,
        zone: 'excluded',
        origin: 'recommended',
        locked: false,
        tags: [],
      })
      await setEntryStandalone(db.pool, id, {
        oracleId: rejected,
        zone: 'excluded',
        origin: 'recommended',
        locked: false,
        tags: [],
      })
      const deck = await getDeck(db.pool, id)
      expect(
        deck!.entries.filter((e) => e.oracleId === rejected && e.zone === 'excluded'),
      ).toHaveLength(1)
    })

    it('excluding a card removes it from accepted', async () => {
      const card = uuid()
      await setEntryStandalone(db.pool, id, {
        oracleId: card,
        zone: 'accepted',
        origin: 'manual',
        locked: false,
        tags: [],
      })
      await setEntryStandalone(db.pool, id, {
        oracleId: card,
        zone: 'excluded',
        origin: 'manual',
        locked: false,
        tags: [],
      })
      const deck = await getDeck(db.pool, id)
      const entries = deck!.entries.filter((e) => e.oracleId === card)
      expect(entries).toHaveLength(1)
      expect(entries[0]!.zone).toBe('excluded')
    })

    it('removes an accepted entry', async () => {
      const card = uuid()
      await setEntryStandalone(db.pool, id, {
        oracleId: card,
        zone: 'accepted',
        origin: 'manual',
        locked: false,
        tags: [],
      })
      expect(await removeEntry(db.pool, id, card)).toBe(1)
      expect(await removeEntry(db.pool, id, card)).toBe(0)
    })

    // --- regressions for bugs found in review ---

    it('removes ONE copy of a duplicated card, not all of them', async () => {
      // An unqualified DELETE took all 34 Mountains when the user removed one.
      const basic = uuid()
      for (let i = 0; i < 5; i++) {
        await setEntryStandalone(db.pool, id, {
          oracleId: basic,
          zone: 'accepted',
          origin: 'manual',
          locked: false,
          tags: [],
        })
      }
      expect(await removeEntry(db.pool, id, basic)).toBe(1)
      const deck = await getDeck(db.pool, id)
      expect(deck!.entries.filter((e) => e.oracleId === basic)).toHaveLength(4)
    })

    it('removes every copy when a bulk operation asks to', async () => {
      const basic = uuid()
      for (let i = 0; i < 3; i++) {
        await setEntryStandalone(db.pool, id, {
          oracleId: basic,
          zone: 'accepted',
          origin: 'manual',
          locked: false,
          tags: [],
        })
      }
      expect(await removeAllCopies(db.pool, id, basic)).toBe(3)
      const deck = await getDeck(db.pool, id)
      expect(deck!.entries.filter((e) => e.oracleId === basic)).toHaveLength(0)
    })

    it('accepting a previously excluded card clears the exclusion', async () => {
      // Otherwise the card sits in acceptedSet AND excludedSet at once, and
      // every consumer disagrees about which state it is in (doc 02 §2.2).
      const subject = uuid()
      await setEntryStandalone(db.pool, id, {
        oracleId: subject,
        zone: 'excluded',
        origin: 'recommended',
        locked: false,
        tags: [],
      })
      await setEntryStandalone(db.pool, id, {
        oracleId: subject,
        zone: 'accepted',
        origin: 'manual',
        locked: false,
        tags: [],
      })
      const deck = await getDeck(db.pool, id)
      const rows = deck!.entries.filter((e) => e.oracleId === subject)
      expect(rows).toHaveLength(1)
      expect(rows[0]!.zone).toBe('accepted')
    })

    it('preserves tags from an import', async () => {
      const card = uuid()
      await setEntryStandalone(db.pool, id, {
        oracleId: card,
        zone: 'accepted',
        origin: 'imported',
        locked: false,
        tags: ['Ramp', 'SORCERY'],
      })
      const deck = await getDeck(db.pool, id)
      expect(deck!.entries.find((e) => e.oracleId === card)?.tags).toEqual(['Ramp', 'SORCERY'])
    })
  })

  describe('optimistic concurrency (doc 12 §12.7)', () => {
    const owner = randomUUID()
    let id: DeckId

    beforeAll(async () => {
      id = deckId(randomUUID())
      await createDeck(db.pool, {
        id,
        ownerId: owner,
        name: 'Concurrent',
        commanders: [],
        targetBracket: 2,
        archetype: 'midrange',
        colorIdentity: [],
      })
    })

    it('applies a batch and bumps the version', async () => {
      const result = await applyBatch(db.pool, id, 1, async (client) => {
        await setEntry(client, id, {
          oracleId: uuid(),
          zone: 'accepted',
          origin: 'core',
          locked: false,
          tags: [],
        })
        return 'ok'
      })
      expect(result).toEqual({ kind: 'applied', result: 'ok', version: 2 })
    })

    it('refuses a stale baseVersion instead of clobbering, and says it is stale', async () => {
      const stale = await applyBatch(db.pool, id, 1, async () => 'should not run')
      expect(stale.kind).toBe('stale')
      if (stale.kind === 'stale') expect(stale.currentVersion).toBeGreaterThan(1)
    })

    it('distinguishes a missing deck from a stale version', async () => {
      // The API answers 404 for one and 409 for the other; a shared null could not.
      const missing = await applyBatch(db.pool, deckId(randomUUID()), 1, async () => 'x')
      expect(missing.kind).toBe('not-found')
    })

    it('distinguishes a missing deck from a stale version', async () => {
      // The API answers 404 for one and 409 for the other; a shared null could not.
      const missing = await applyBatch(db.pool, deckId(randomUUID()), 1, async () => 'x')
      expect(missing.kind).toBe('not-found')
    })

    it('rolls the whole batch back when it throws', async () => {
      const before = await getDeck(db.pool, id)
      await expect(
        applyBatch(db.pool, id, before!.version, async (client) => {
          await setEntry(client, id, {
            oracleId: uuid(),
            zone: 'accepted',
            origin: 'core',
            locked: false,
            tags: [],
          })
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')

      const after = await getDeck(db.pool, id)
      expect(after!.version).toBe(before!.version)
      expect(after!.entries).toHaveLength(before!.entries.length)
    })

    it('serialises two concurrent batches — one wins, one is refused', async () => {
      const start = (await getDeck(db.pool, id))!.version
      const [a, b] = await Promise.all([
        applyBatch(db.pool, id, start, async () => 'a'),
        applyBatch(db.pool, id, start, async () => 'b'),
      ])
      const winners = [a, b].filter((r) => r.kind === 'applied')
      expect(winners).toHaveLength(1)
      expect([a, b].filter((r) => r.kind === 'stale')).toHaveLength(1)
      expect((await getDeck(db.pool, id))!.version).toBe(start + 1)
    })
  })

  describe('deck library', () => {
    const owner = randomUUID()

    beforeAll(async () => {
      for (const [name, status] of [
        ['Active One', 'active'],
        ['Archived One', 'archived'],
      ] as const) {
        const id = deckId(randomUUID())
        await createDeck(db.pool, {
          id,
          ownerId: owner,
          name,
          commanders: [uuid()],
          targetBracket: 3,
          archetype: 'midrange',
          colorIdentity: ['R'],
        })
        await setEntryStandalone(db.pool, id, {
          oracleId: uuid(),
          zone: 'accepted',
          origin: 'manual',
          locked: false,
          tags: [],
        })
        if (status === 'archived') {
          await db.pool.query('UPDATE decks SET status = $1 WHERE id = $2', [status, id])
        }
      }
    })

    it('lists active decks by default', async () => {
      const summaries = await listDeckSummaries(db.pool, owner)
      expect(summaries.map((s) => s.name)).toEqual(['Active One'])
    })

    it('lists archived decks on request', async () => {
      const summaries = await listDeckSummaries(db.pool, owner, { status: 'archived' })
      expect(summaries.map((s) => s.name)).toEqual(['Archived One'])
    })

    it('counts cards in SQL, including the commander', async () => {
      const [summary] = await listDeckSummaries(db.pool, owner)
      expect(summary!.cardCount).toBe(2) // 1 commander + 1 entry
    })

    it('does not leak decks across owners', async () => {
      expect(await listDeckSummaries(db.pool, randomUUID())).toEqual([])
    })

    it('soft-deletes and restores', async () => {
      const id = deckId(randomUUID())
      await createDeck(db.pool, {
        id,
        ownerId: owner,
        name: 'Doomed',
        commanders: [],
        targetBracket: 1,
        archetype: 'midrange',
        colorIdentity: [],
      })
      expect(await softDeleteDeck(db.pool, id)).toBe(true)
      expect(await getDeck(db.pool, id)).toBeNull()
      expect(await softDeleteDeck(db.pool, id)).toBe(false)

      expect(await restoreDeck(db.pool, id)).toBe(true)
      expect((await getDeck(db.pool, id))?.name).toBe('Doomed')
    })
  })
})
