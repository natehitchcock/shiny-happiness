import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import type {
  Card,
  Combo,
  DeckCommand,
  DeckId,
  OracleId,
  Printing,
  PrintingId,
} from '@roundtable/domain'
import {
  DEFAULT_COLUMNS,
  buildComboIndex,
  columnsFor,
  comboDegree,
  comboId,
  deckId,
  printingId,
  semanticMembership,
} from '@roundtable/domain'
import {
  appliedMigrations,
  loadMigrations,
  migrateDown,
  migrateUp,
  migrationVersions,
} from './index.js'
import {
  combosContaining,
  combosInIdentity,
  combosWithin,
  deleteCombos,
  pruneTemplateVariantCombos,
  insertCombos,
} from './repositories/combos.js'
import {
  findEligibleCards,
  gameChangerOracleIds,
  getCard,
  getCards,
  searchCardsByName,
  upsertCards,
} from './repositories/cards.js'
import {
  appendCommandLog,
  applyBatch,
  commandsSince,
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
import { printingFactsForAll, printingsFor, upsertPrintings } from './repositories/printings.js'
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
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: 100,
  defaultPrinting: null,
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
  ...over,
})

describeDb('packages/db against real PostgreSQL', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase('main')
  }, 60_000)

  /*
   * 60 s, like every other teardown that drops a test database.
   *
   * This one was left on vitest's 10 s default and flaked: `drop()` ends the
   * pool, opens a fresh admin connection and issues DROP DATABASE, and on an
   * unlucky moment that is more than ten seconds — the suite passed all 66
   * tests and failed the hook. A teardown that opens a connection is not a
   * cheap operation and should not be held to a default meant for assertions.
   */
  afterAll(async () => {
    await db?.drop()
  }, 60_000)

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

    it('created the command log API-06 reads `since` from', async () => {
      const { rows } = await db.pool.query<{ table_name: string }>(
        "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'",
      )
      expect(rows.map((r) => r.table_name)).toContain('deck_command_log')
    })

    /** What `GET /api/v1/health` reports (see `apps/api/src/routes/health.ts`). */
    describe('reporting what is applied', () => {
      it('lists the shipped versions in order, without reading their SQL', async () => {
        const versions = await migrationVersions(MIGRATIONS_DIR)

        expect(versions).toContain('0001_initial')
        expect(versions).toContain('0012_deck_command_log')
        expect([...versions].sort()).toEqual(versions)
        // One entry per migration, not one per `.up.sql`/`.down.sql` file.
        expect(new Set(versions).size).toBe(versions.length)
      })

      it('reports every shipped version as applied on a migrated database', async () => {
        const applied = await appliedMigrations(db.pool)

        expect(applied).toEqual(await migrationVersions(MIGRATIONS_DIR))
      })

      /*
       * The failure this whole endpoint exists for: production four migrations
       * behind, serving nulls rather than errors. `appliedMigrations` must
       * report the shortfall rather than the head it wishes it had.
       */
      it('reports a database that is behind as missing exactly those versions', async () => {
        const scratch = await createTestDatabase('behind')
        try {
          const migrations = await loadMigrations(MIGRATIONS_DIR)
          await migrateDown(scratch.pool, migrations, 4)

          const applied = await appliedMigrations(scratch.pool)
          const shipped = await migrationVersions(MIGRATIONS_DIR)
          const pending = shipped.filter((v) => !new Set(applied).has(v))

          expect(pending).toEqual(shipped.slice(-4))
        } finally {
          await scratch.drop()
        }
      }, 60_000)

      /*
       * Returns null instead of raising, and — the part that matters — does NOT
       * create the table. A health check that performs DDL changes the answer
       * it was asked for.
       */
      it('answers null for a database with no schema, without creating one', async () => {
        const scratch = await createTestDatabase('unmigrated')
        try {
          await migrateDown(scratch.pool, await loadMigrations(MIGRATIONS_DIR), 99)
          await scratch.pool.query('DROP TABLE schema_migrations')

          expect(await appliedMigrations(scratch.pool)).toBeNull()

          const { rows } = await scratch.pool.query(
            "SELECT to_regclass('public.schema_migrations') AS t",
          )
          expect(rows[0]).toEqual({ t: null })
        } finally {
          await scratch.drop()
        }
      }, 60_000)
    })
  })

  describe('finding a card by a name that is nearly right', () => {
    it('finds it by substring, as before', async () => {
      await upsertCards(db.pool, [card("Ashnod's Altar")])
      const found = await searchCardsByName(db.pool, 'Ashnod')
      expect(found.map((c) => c.name)).toContain("Ashnod's Altar")
    })

    it('finds it through a typo no LIKE could reach', async () => {
      // "Ashnods" — the wrong character is in the MIDDLE, so no substring
      // pattern gets there. Trigrams degrade gracefully instead.
      await upsertCards(db.pool, [card("Ashnod's Altar")])
      const found = await searchCardsByName(db.pool, 'Ashnods')
      expect(found.map((c) => c.name)).toContain("Ashnod's Altar")
    })

    it('finds a long name from a short mistyped word', async () => {
      // The reason this uses `word_similarity` and not `similarity`: the latter
      // normalises over the whole string, and this name is long enough that a
      // dozen unrelated four-letter cards would outrank it.
      await upsertCards(db.pool, [card("Sekki, Seasons' Guide")])
      const found = await searchCardsByName(db.pool, 'Sekii')
      expect(found.map((c) => c.name)).toContain("Sekki, Seasons' Guide")
    })

    it('invents nothing for text that is not a card name', async () => {
      // The threshold has to refuse as well as accept, or every typo produces a
      // confident wrong suggestion.
      await upsertCards(db.pool, [card("Ashnod's Altar")])
      expect(await searchCardsByName(db.pool, 'zzzznotacardatall')).toEqual([])
    })

    it('prefers the literal match when there is one', async () => {
      // Fuzzy is a FALLBACK. A real substring hit must never be reordered by
      // similarity, or searching "Altar" stops putting Altars first.
      await upsertCards(db.pool, [card('Altar of Dementia'), card("Ashnod's Altar")])
      const found = await searchCardsByName(db.pool, 'Altar')
      expect(found.length).toBeGreaterThanOrEqual(2)
      expect(found.every((c) => c.name.toLowerCase().includes('altar'))).toBe(true)
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

    it('round-trips the faces of a multi-faced card', async () => {
      // The newline inside the second face is the point: it is an ability break
      // within one face, and the array is what keeps it from being read as a
      // second face. A column that flattened to text would lose exactly this.
      const faces = ['Fire deals 2 damage.', 'Tap target permanent.\nDraw a card.']
      const c = card('Fire // Ice', { oracleText: faces.join('\n'), oracleTextFaces: faces })
      await upsertCards(db.pool, [c])
      expect((await getCard(db.pool, c.oracleId))?.oracleTextFaces).toEqual(faces)
    })

    it('writes the faces onto a card that is already in the corpus', async () => {
      // Not the same path as the test above, and this is the one that matters:
      // the re-ingest that fills this column in meets 34k existing rows, so the
      // faces arrive through ON CONFLICT DO UPDATE rather than through the
      // INSERT. A column left out of that clause writes nothing for every card
      // that already exists, which is all of them — and the insert-only test
      // passes the whole time.
      const id = uuid()
      const faces = ['Fire deals 2 damage.', 'Tap target permanent.\nDraw a card.']
      await upsertCards(db.pool, [card('Fire // Ice', { oracleId: id })])
      await upsertCards(db.pool, [
        card('Fire // Ice', { oracleId: id, oracleText: faces.join('\n'), oracleTextFaces: faces }),
      ])
      expect((await getCard(db.pool, id))?.oracleTextFaces).toEqual(faces)
    })

    it('round-trips the Game Changers flag', async () => {
      const c = card('Rhystic Study', { gameChanger: true })
      await upsertCards(db.pool, [c])
      expect((await getCard(db.pool, c.oracleId))?.gameChanger).toBe(true)
    })

    it('sets the Game Changers flag on a card that is already in the corpus', async () => {
      // The path a re-ingest actually takes. Migration 0011 defaults 34k existing
      // rows to false, so every one of them learns its flag through
      // ON CONFLICT DO UPDATE and not through the INSERT. Leave the column out of
      // that clause and the flag is never written for a single real card, while
      // an insert-only test stays green throughout.
      const id = uuid()
      await upsertCards(db.pool, [card('Rhystic Study', { oracleId: id })])
      await upsertCards(db.pool, [card('Rhystic Study', { oracleId: id, gameChanger: true })])
      expect((await getCard(db.pool, id))?.gameChanger).toBe(true)
    })

    it('clears the Game Changers flag when Wizards removes a card from the list', async () => {
      // Ten cards came off the list in one October update, so the flag has to be
      // able to go back down. A clause that only ever ORs the flag upward would
      // pass the test above and leave a removed card flagged forever.
      const id = uuid()
      await upsertCards(db.pool, [card('Food Chain', { oracleId: id, gameChanger: true })])
      await upsertCards(db.pool, [card('Food Chain', { oracleId: id, gameChanger: false })])
      expect((await getCard(db.pool, id))?.gameChanger).toBe(false)
    })

    it('lists exactly the Game Changers in the corpus', async () => {
      const scratch = await createTestDatabase('gamechangers')
      try {
        // Its own database because the assertion is about the WHOLE corpus, and
        // the shared one is full of cards other tests wrote.
        expect(await gameChangerOracleIds(scratch.pool)).toEqual([])

        const listed = card('Rhystic Study', { gameChanger: true })
        await upsertCards(scratch.pool, [listed, card('Llanowar Elves')])
        expect(await gameChangerOracleIds(scratch.pool)).toEqual([listed.oracleId])
      } finally {
        await scratch.drop()
      }
      // Same 60 s as the other test that builds its own database: creating and
      // migrating one is well past the 5 s default.
    }, 60_000)

    it('reads a single-faced card back with no faces, not an empty list', async () => {
      // NULL must not become `[]` on the way out: "one face" and "zero faces"
      // are different claims, and the renderer rules a line off the difference.
      const c = card('Sol Ring')
      await upsertCards(db.pool, [c])
      expect((await getCard(db.pool, c.oracleId))?.oracleTextFaces).toBeUndefined()
    })

    it('round-trips commander eligibility, both true and false', async () => {
      const yes = card('Krenko, Mob Boss', { canBeCommander: true })
      const no = card('Sol Ring', { canBeCommander: false })
      await upsertCards(db.pool, [yes, no])
      expect((await getCard(db.pool, yes.oracleId))?.canBeCommander).toBe(true)
      // Explicitly, not "falsy": `false` and absent mean different things here
      // and the API branches on the difference.
      expect((await getCard(db.pool, no.oracleId))?.canBeCommander).toBe(false)
    })

    it('writes commander eligibility onto a card already in the corpus', async () => {
      // The path that matters. The re-ingest filling this column meets 34,492
      // rows that already exist, so every value arrives through ON CONFLICT DO
      // UPDATE rather than through the INSERT. A column left out of that clause
      // writes nothing for every card that is already there — which is all of
      // them — while the insert-only test above passes throughout.
      const id = uuid()
      await upsertCards(db.pool, [card('Krenko, Mob Boss', { oracleId: id })])
      await upsertCards(db.pool, [card('Krenko, Mob Boss', { oracleId: id, canBeCommander: true })])
      expect((await getCard(db.pool, id))?.canBeCommander).toBe(true)
    })

    it('reads a card ingested before the column as undecided, not as ineligible', async () => {
      // NULL must not come back as `false`. `false` is the claim "this card may
      // not lead a deck", and applied to a pre-0010 corpus that is every card —
      // which would reject every deck until the re-ingest ran.
      const c = card('Older Than The Column')
      await upsertCards(db.pool, [c])
      expect((await getCard(db.pool, c.oracleId))?.canBeCommander).toBeUndefined()
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

    /*
     * The eligible read names its columns instead of `SELECT *` (ADR-0046).
     *
     * That is a saving with a trap in it, and this test is the trap's lid: a
     * column left out of the list arrives as `undefined`, `toCard` maps it
     * straight through, and the field reads as `null` — which for `loyalty`
     * means "not a planeswalker" and for `defaultPrinting` means "no imagery
     * yet". Both are lies that nothing would throw on. ADR-0017 hit exactly
     * this and said so.
     *
     * So the assertion is a round trip against a card with every field
     * populated, compared to what the untrimmed single-card read returns.
     * Adding a column to `toCard` and forgetting the eligible list is a
     * failing test rather than a silent null.
     */
    it('the trimmed eligible read returns the same card as the untrimmed one', async () => {
      const full = card('Fully Populated', {
        colorIdentity: ['R'],
        manaCost: '{2}{R}',
        manaValue: 3,
        colors: ['R'],
        typeLine: 'Legendary Creature — Elf Druid',
        types: ['creature'],
        oracleText: 'Whenever this creature attacks, create a Treasure token.',
        power: '2',
        toughness: '3',
        loyalty: null,
        keywords: ['Flying', 'Trample'],
        edhrecRank: 42,
        defaultPrinting: printingId(randomUUID()),
        roles: ['ramp'],
        primaryRole: 'ramp',
        synergyProduces: ['treasure', 'subtype:elf'],
        synergyWants: ['subtype:forest'],
        gameChanger: false,
        canBeCommander: true,
      })
      await upsertCards(db.pool, [full])

      const viaEligible = (await findEligibleCards(db.pool, ['R'])).find(
        (c) => c.name === 'Fully Populated',
      )
      const viaSingle = await getCard(db.pool, full.oracleId)

      expect(viaEligible).toBeDefined()
      expect(viaSingle).not.toBeNull()
      // `oracleTextFaces` is the one field deliberately left out, and absent is
      // already its documented meaning ("single-faced, or ingested before the
      // column existed") rather than a wrong value. Everything else must match.
      const expected: Record<string, unknown> = { ...(viaSingle as Card) }
      delete expected['oracleTextFaces']
      expect(viaEligible).toEqual(expected)
    })

    /*
     * The coupling the trim creates, enforced rather than remembered.
     *
     * `synergyHas` is DERIVED in `toCard` from `type_line` and `keywords`
     * (ADR-0048) rather than stored, which is what keeps a third array off the
     * wire. The cost is that those two columns are now load-bearing for
     * something a reader of the SELECT would not guess: drop either and every
     * card's tribe and evasion tags silently become `[]`, tribal matching stops
     * working, and nothing throws.
     *
     * The next person to trim this read will be doing exactly what the comment
     * above it recommends. This is what stops them.
     */
    it('derives the membership tags from columns the trimmed read still carries', async () => {
      const elf = card('Trimmed Elf Druid', {
        colorIdentity: ['G'],
        typeLine: 'Legendary Creature — Elf Druid',
        types: ['creature'],
        keywords: ['Flying'],
      })
      await upsertCards(db.pool, [elf])

      const found = (await findEligibleCards(db.pool, ['G'])).find(
        (c) => c.name === 'Trimmed Elf Druid',
      )

      // If `type_line` left the column list, these two go quiet.
      expect(found?.synergyHas).toContain('subtype:elf')
      expect(found?.synergyHas).toContain('subtype:druid')
      // And this one is `keywords`.
      expect(found?.synergyHas).toContain('ability:flying')
    })

    it('agrees with the domain about what a card is, rather than storing an answer', async () => {
      // The claim is that the column was not needed, so the read has to produce
      // exactly what the domain would compute from the same card. Asserted
      // against `semanticMembership` itself rather than a retyped list, so a
      // vocabulary regeneration cannot make the two drift apart.
      const beast = card('Trimmed Beast', {
        colorIdentity: ['G'],
        typeLine: 'Creature — Beast Warrior',
        types: ['creature'],
        keywords: ['Trample', 'Vigilance'],
      })
      await upsertCards(db.pool, [beast])

      const found = (await findEligibleCards(db.pool, ['G'])).find(
        (c) => c.name === 'Trimmed Beast',
      )

      expect(found?.synergyHas).toEqual(semanticMembership(beast))
    })

    it('does not silently null a column the trimmed list forgot', async () => {
      // The specific fields whose null is indistinguishable from a real answer.
      // Named one by one so a failure says which claim broke.
      const withPrinting = card('Has A Printing', {
        colorIdentity: ['R'],
        defaultPrinting: printingId(randomUUID()),
        edhrecRank: 7,
        primaryRole: 'ramp',
        roles: ['ramp'],
        canBeCommander: true,
        keywords: ['Flying'],
      })
      await upsertCards(db.pool, [withPrinting])

      const found = (await findEligibleCards(db.pool, ['R'])).find(
        (c) => c.name === 'Has A Printing',
      )

      expect(found?.defaultPrinting).toBe(withPrinting.defaultPrinting)
      expect(found?.edhrecRank).toBe(7)
      expect(found?.primaryRole).toBe('ramp')
      expect(found?.canBeCommander).toBe(true)
      expect(found?.keywords).toEqual(['Flying'])
      expect(found?.universesBeyond).toBe(false)
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

  /*
   * Printings, and the column a corrected ingest has to actually reach.
   *
   * The Scryfall mapper read art only from the top level of a card record, so
   * every transform and modal-DFC printing ingested with none — 1,393 rows,
   * leaving 501 cards with no art on their default printing. That fix lives in
   * `packages/clients`, but it reaches a player only through this table, and
   * the re-ingest carrying it meets 110,577 rows that already exist. Every
   * corrected URL therefore arrives through ON CONFLICT DO UPDATE and not
   * through the INSERT, which is the half that a test written the obvious way
   * never touches.
   */
  describe('printings', () => {
    const ART = 'https://cards.scryfall.io/art_crop/front/1/1/fable.jpg?1'
    const NORMAL = 'https://cards.scryfall.io/normal/front/1/1/fable.jpg?1'

    const printing = (
      oracleId: OracleId,
      over: Partial<Printing> = {},
    ): Printing & { printingId: PrintingId } => ({
      printingId: printingId(randomUUID()),
      oracleId,
      setCode: 'neo',
      setName: 'Kamigawa: Neon Dynasty',
      collectorNumber: '1',
      rarity: 'rare',
      imageUris: { artCrop: '', normal: '' },
      priceUsd: null,
      reserved: false,
      ...over,
    })

    const owner = async (name: string): Promise<OracleId> => {
      const c = card(name)
      await upsertCards(db.pool, [c])
      return c.oracleId
    }

    it('writes art on insert', async () => {
      const id = await owner('Fable of the Mirror-Breaker // Reflection of Kiki-Jiki')
      await upsertPrintings(db.pool, [
        printing(id, { imageUris: { artCrop: ART, normal: NORMAL } }),
      ])

      const [back] = await printingsFor(db.pool, id)
      expect(back?.imageUris).toEqual({ artCrop: ART, normal: NORMAL })
    })

    it('replaces the art of a printing already in the corpus', async () => {
      // The path the re-ingest takes for all 1,393 broken rows: they exist,
      // with NULL art, and the corrected URL has to survive ON CONFLICT DO
      // UPDATE. Drop either image column from that clause and this is the only
      // test that notices — the insert above stays green while production
      // keeps every one of its blank cards.
      const id = await owner('Treasure Map // Treasure Cove')
      const before = printing(id)
      await upsertPrintings(db.pool, [before])
      expect((await printingsFor(db.pool, id))[0]?.imageUris.normal).toBe('')

      await upsertPrintings(db.pool, [{ ...before, imageUris: { artCrop: ART, normal: NORMAL } }])

      const [after] = await printingsFor(db.pool, id)
      expect(after?.printingId).toBe(before.printingId)
      expect(after?.imageUris).toEqual({ artCrop: ART, normal: NORMAL })
    })

    it('stores absent art as NULL rather than as an empty string', async () => {
      // `''` reaching an `<img src>` resolves against the page URL and draws a
      // broken image exactly where the no-art panel should have drawn a name.
      // NULL in the column is what lets a query ask "which cards have no art".
      const id = await owner('A Card With No Art')
      await upsertPrintings(db.pool, [printing(id)])

      const { rows } = await db.pool.query<{ image_normal: string | null }>(
        'SELECT image_normal FROM printings WHERE oracle_id = $1',
        [id],
      )
      expect(rows[0]?.image_normal).toBeNull()
    })

    it('serves the default printing’s art to the candidate pool', async () => {
      // `printingFactsForAll` is what the API reads, and it joins art through
      // `cards.default_printing` rather than through the cheapest printing. The
      // 501 cards were blank at exactly this seam.
      const c = card('Delver of Secrets // Insectile Aberration')
      const id = printingId(randomUUID())
      await upsertCards(db.pool, [{ ...c, defaultPrinting: id }])
      await upsertPrintings(db.pool, [
        { ...printing(c.oracleId), printingId: id, imageUris: { artCrop: ART, normal: NORMAL } },
      ])

      const facts = await printingFactsForAll(db.pool)
      expect(facts.get(c.oracleId)?.imageUris).toEqual({ artCrop: ART, normal: NORMAL })
    })

    /*
     * The BACK face's art (0016, ADR-0027).
     *
     * Two nullable columns holding three states, which is the whole difficulty:
     * both NULL is "one physical face", both set is "there is a back", and `''`
     * inside a set pair is "there is a back and its art did not resolve". A
     * flip control draws a button for the last two and none for the first, so
     * the round trip has to keep them apart in both directions.
     */
    describe('the back face, which most cards do not have', () => {
      const BACK_ART = 'https://cards.scryfall.io/art_crop/back/1/1/fable.jpg?1'
      const BACK_NORMAL = 'https://cards.scryfall.io/normal/back/1/1/fable.jpg?1'

      it('round-trips a two-faced printing’s back art', async () => {
        const id = await owner('Delver of Secrets // Insectile Aberration')
        await upsertPrintings(db.pool, [
          printing(id, {
            imageUris: { artCrop: ART, normal: NORMAL },
            backImageUris: { artCrop: BACK_ART, normal: BACK_NORMAL },
          }),
        ])

        const [row] = await printingsFor(db.pool, id)
        expect(row?.backImageUris).toEqual({ artCrop: BACK_ART, normal: BACK_NORMAL })
        // The front must not have moved. It is the card.
        expect(row?.imageUris).toEqual({ artCrop: ART, normal: NORMAL })
      })

      it('leaves a single-faced printing with NULL columns and no back at all', async () => {
        // Absent, not an empty pair. Sol Ring does not have a back whose
        // picture is missing, and NULL is what lets a query ask how many cards
        // have a second side.
        const id = await owner('Sol Ring, Which Has One Side')
        await upsertPrintings(db.pool, [
          printing(id, { imageUris: { artCrop: ART, normal: NORMAL } }),
        ])

        const [row] = await printingsFor(db.pool, id)
        expect(row?.backImageUris).toBeUndefined()

        const { rows } = await db.pool.query<{
          image_back_art_crop: string | null
          image_back_normal: string | null
        }>('SELECT image_back_art_crop, image_back_normal FROM printings WHERE oracle_id = $1', [
          id,
        ])
        expect(rows[0]?.image_back_art_crop).toBeNull()
        expect(rows[0]?.image_back_normal).toBeNull()
      })

      it('keeps a two-faced printing whose back art is missing DISTINCT from a single-faced one', async () => {
        /*
         * The state the two columns exist to express, and the one an obvious
         * implementation loses.
         *
         * `''` is stored rather than collapsed to NULL — deliberately unlike
         * the front columns, where `upsertPrintings` writes NULL for `''`. Here
         * NULL is already taken: it means "no second side". Collapsing would
         * make a transform card with an unresolved image read as Sol Ring.
         */
        const id = await owner('A Transform Card Whose Back Art Failed')
        await upsertPrintings(db.pool, [
          printing(id, { backImageUris: { artCrop: '', normal: '' } }),
        ])

        const [row] = await printingsFor(db.pool, id)
        expect(row?.backImageUris).toEqual({ artCrop: '', normal: '' })

        const { rows } = await db.pool.query<{ image_back_normal: string | null }>(
          'SELECT image_back_normal FROM printings WHERE oracle_id = $1',
          [id],
        )
        expect(rows[0]?.image_back_normal).toBe('')
      })

      it('replaces back art on re-ingest', async () => {
        // The path every one of the 501 rows takes: they exist with NULL back
        // columns, and the URL the fixed mapper reads has to survive ON
        // CONFLICT DO UPDATE. Drop either column from that clause and this is
        // the only test that notices — the insert above stays green.
        const id = await owner('Treasure Map // Treasure Cove, Reingested')
        const before = printing(id)
        await upsertPrintings(db.pool, [before])
        expect((await printingsFor(db.pool, id))[0]?.backImageUris).toBeUndefined()

        await upsertPrintings(db.pool, [
          { ...before, backImageUris: { artCrop: BACK_ART, normal: BACK_NORMAL } },
        ])

        const [after] = await printingsFor(db.pool, id)
        expect(after?.printingId).toBe(before.printingId)
        expect(after?.backImageUris).toEqual({ artCrop: BACK_ART, normal: BACK_NORMAL })
      })

      it('refuses a half-written pair, so the three states stay three', async () => {
        // The constraint is what makes "both NULL means one face" a fact rather
        // than a convention. One column set and the other NULL is a row that
        // answers neither question.
        const id = await owner('A Card With Half A Back')
        await expect(
          db.pool.query(
            `INSERT INTO printings (printing_id, oracle_id, set_code, set_name,
                                    collector_number, rarity, image_back_art_crop,
                                    image_back_normal, price_usd, reserved)
             VALUES ($1, $2, 'tst', 'Test Set', '1', 'common', $3, NULL, NULL, false)`,
            [randomUUID(), id, BACK_ART],
          ),
        ).rejects.toThrow(/printings_back_face_pair/)
      })

      it('serves the default printing’s back art to the candidate pool', async () => {
        // `printingFactsForAll` is what `/cards/batch` reads, and it joins art
        // through `cards.default_printing`. A back face that stops at the
        // repository never reaches a flip control.
        const c = card('Tergrid, God of Fright // Tergrid’s Lantern')
        const id = printingId(randomUUID())
        await upsertCards(db.pool, [{ ...c, defaultPrinting: id }])
        await upsertPrintings(db.pool, [
          {
            ...printing(c.oracleId),
            printingId: id,
            imageUris: { artCrop: ART, normal: NORMAL },
            backImageUris: { artCrop: BACK_ART, normal: BACK_NORMAL },
          },
        ])

        const facts = await printingFactsForAll(db.pool)
        expect(facts.get(c.oracleId)?.backImageUris).toEqual({
          artCrop: BACK_ART,
          normal: BACK_NORMAL,
        })
      })

      it('gives the candidate pool no back for a single-faced card', async () => {
        const c = card('Black Lotus, Which Has One Side')
        const id = printingId(randomUUID())
        await upsertCards(db.pool, [{ ...c, defaultPrinting: id }])
        await upsertPrintings(db.pool, [
          {
            ...printing(c.oracleId),
            printingId: id,
            imageUris: { artCrop: ART, normal: NORMAL },
          },
        ])

        const facts = await printingFactsForAll(db.pool)
        expect(facts.get(c.oracleId)?.backImageUris).toBeUndefined()
        // …while still serving the front, which is the part that must not move.
        expect(facts.get(c.oracleId)?.imageUris).toEqual({ artCrop: ART, normal: NORMAL })
      })

      it('reports a stored empty back as null on the way out, never as “”', async () => {
        // The same trap `imageUrl` exists for on the front: `''` reaching an
        // `<img src>` resolves against the page URL and draws a broken image.
        // The PRESENCE of the object survives; the empty string does not.
        const c = card('A Default Printing Whose Back Art Failed')
        const id = printingId(randomUUID())
        await upsertCards(db.pool, [{ ...c, defaultPrinting: id }])
        await upsertPrintings(db.pool, [
          {
            ...printing(c.oracleId),
            printingId: id,
            backImageUris: { artCrop: '', normal: '' },
          },
        ])

        const facts = await printingFactsForAll(db.pool)
        expect(facts.get(c.oracleId)?.backImageUris).toEqual({ artCrop: null, normal: null })
      })
    })

    it('handles an empty batch without a query', async () => {
      expect(await upsertPrintings(db.pool, [])).toBe(0)
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

    /*
     * Removing a row a previous run wrote (ADR-0038).
     *
     * The table had only an UPSERT, so a variant the ingest stopped accepting
     * kept its row forever. That is how the reported Moritte + Ashnod's Altar
     * combo survived the fix that refused it: the refusal worked, the run said
     * so, and the row it was about never moved.
     */
    describe('removing rows a later run decides against', () => {
      const doomed = uuid()

      it('removes exactly the ids it is given', async () => {
        await insertCombos(db.pool, [
          combo('withdrawn-by-spellbook', [doomed]),
          combo('still-good', [doomed]),
        ])
        expect((await combosContaining(db.pool, [doomed])).map((c) => c.id).sort()).toEqual([
          'still-good',
          'withdrawn-by-spellbook',
        ])

        const removed = await deleteCombos(db.pool, [comboId('withdrawn-by-spellbook')])

        expect(removed).toBe(1)
        expect((await combosContaining(db.pool, [doomed])).map((c) => c.id)).toEqual(['still-good'])
      })

      it('reports zero for an id that was never stored', async () => {
        // The common case on a healthy corpus: the variant was rejected on this
        // run and on every earlier one, so there is nothing to remove. A count
        // that lied here would make "removed 0" unreadable.
        expect(await deleteCombos(db.pool, [comboId('never-existed')])).toBe(0)
      })

      it('deletes NOTHING when given no ids', async () => {
        /*
         * What this pins is the CONTRACT, not the current implementation.
         *
         * Measured, because the claim was nearly overstated: with today's
         * `combo_id = ANY($1)` the early return is dead weight — removing it on
         * its own leaves every test green, since `ANY('{}')` matches nothing
         * anyway. It is kept for the round trip it saves and to match
         * `insertCombos`, not for safety.
         *
         * The pair is what has teeth. Rewrite the predicate the way a "prune
         * everything the run did not write" refactor would — `combo_id <> ALL($1)`
         * — and drop the early return, and an empty list empties the table. That
         * combined mutation IS caught, and only by this test.
         */
        const before = await combosContaining(db.pool, [kiki, unrelated, doomed])

        expect(await deleteCombos(db.pool, [])).toBe(0)

        expect(await combosContaining(db.pool, [kiki, unrelated, doomed])).toHaveLength(
          before.length,
        )
      })
    })

    /*
     * The rows the id-by-id prune could never reach (ADR-0049).
     *
     * ADR-0038's prune removes ids the run READ AND POSITIVELY REJECTED, which
     * cannot touch the 41 rows left over from variants Spellbook has withdrawn
     * from the feed entirely: a variant nobody reads is a variant nobody
     * rejects. Reaching those by id needs "delete everything this run did not
     * write", which empties the table on a truncated download.
     *
     * This is the third way, and it is neither. `--` in a `combo_id` is
     * Spellbook's mark for a template piece — a piece that is a card CLASS —
     * and `variantSkipReason` refuses to let one be written at all, on the
     * `requires[]` array AND on the id. So a `--` row is stale by construction,
     * no feed comparison is involved, and a run that read one variant or none
     * removes exactly the same rows as a run that read all of them.
     */
    describe('pruning rows for template variants', () => {
      const templated = uuid()

      it('removes every row whose id carries a template segment', async () => {
        // Two real ids from the 41 left after ADR-0038, and a real three-card
        // sibling that must survive them.
        await insertCombos(db.pool, [
          combo('1957-4050-6273--129', [templated]),
          combo('1680-2395-4508-7863--165', [templated]),
          combo('2034-3388-3607', [templated]),
        ])

        const removed = await pruneTemplateVariantCombos(db.pool)

        expect(removed).toBe(2)
        expect((await combosContaining(db.pool, [templated])).map((c) => c.id)).toEqual([
          '2034-3388-3607',
        ])
      })

      it('leaves ordinary hyphenated ids alone — one hyphen is not two', async () => {
        /*
         * The mutation that would empty the table, pinned.
         *
         * Every variant id in the feed is hyphen-separated card ids, so
         * `LIKE '%-%'` matches all 104,616 rows and `LIKE '%--%'` matches 41.
         * That single character is the entire difference between a cleanup and
         * a truncation, and nothing else in this suite would notice it.
         */
        const total = async (): Promise<number> => {
          const { rows } = await db.pool.query<{ n: string }>('SELECT count(*) AS n FROM combos')
          return Number(rows[0]?.n ?? 0)
        }
        // Its own row, so this does not depend on the case above having run.
        const ordinary = uuid()
        await insertCombos(db.pool, [combo('2034-3388-3607-x', [ordinary])])
        const before = await total()
        expect(before).toBeGreaterThan(0)

        // Every id in this table is hyphen-separated, so a one-hyphen predicate
        // takes all of them and this call would report `before` rather than 0.
        expect(await pruneTemplateVariantCombos(db.pool)).toBe(0)
        expect(await total()).toBe(before)
        expect((await combosContaining(db.pool, [ordinary])).map((c) => c.id)).toEqual([
          '2034-3388-3607-x',
        ])
      })

      it('is idempotent: it removes them once and then reports none', async () => {
        /*
         * Sets up its own rows rather than leaning on the case above, and
         * asserts the transition rather than the resting state.
         *
         * The first version of this asserted only `toBe(0)` on an already-clean
         * table, which a function whose whole body was `return 0` would pass.
         * What actually needs pinning is the shape the operator reads across
         * two runs — a number on the first ingest after this change and 0 on
         * every one after it, so that `removed 0` is legible as "there were
         * none" rather than as "the prune did not run".
         */
        const twice = uuid()
        await insertCombos(db.pool, [
          combo('4444-5555--77', [twice]),
          combo('4444-5555-6666', [twice]),
        ])

        expect(await pruneTemplateVariantCombos(db.pool)).toBe(1)
        expect(await pruneTemplateVariantCombos(db.pool)).toBe(0)
        expect((await combosContaining(db.pool, [twice])).map((c) => c.id)).toEqual([
          '4444-5555-6666',
        ])
      })
    })

    /*
     * Scoping the pull to the deck's colours, which is what took production
     * down.
     *
     * `allCombos` moved the whole table on every recommendation and analysis
     * request — 108,046 rows and 79.7 MB against the real corpus. On a metered
     * database that exhausted a 5 GB monthly transfer allowance in about sixty
     * requests. A combo with a blue piece cannot be assembled in a mono-red
     * deck, so the rows were not merely surplus, they were unusable.
     *
     * The filter reads the STORED `combos.color_identity` (ADR-0017), so these
     * fixtures set it truthfully rather than letting every combo claim red —
     * a fixture that lies about its own identity would pass whatever the query
     * did.
     */
    describe('scoped to a colour identity', () => {
      const redPiece = uuid()
      const bluePiece = uuid()

      const scoped = (
        id: string,
        pieces: OracleId[],
        identity: NonNullable<Combo['colorIdentity']>,
      ): Combo => ({ ...combo(id, pieces), colorIdentity: identity })

      beforeAll(async () => {
        await insertCombos(db.pool, [
          scoped('mono-red-combo', [redPiece], ['R']),
          scoped('izzet-combo', [redPiece, bluePiece], ['R', 'U']),
          scoped('colorless-combo', [redPiece], []),
        ])
      })

      it('keeps a combo every piece of which is castable', async () => {
        const found = await combosInIdentity(db.pool, ['R'])
        expect(found.map((c) => c.id)).toContain('mono-red-combo')
      })

      it('drops a combo whose identity reaches outside the deck', async () => {
        const found = await combosInIdentity(db.pool, ['R'])
        expect(found.map((c) => c.id)).not.toContain('izzet-combo')
      })

      it('keeps it once the identity covers it', async () => {
        const found = await combosInIdentity(db.pool, ['R', 'U'])
        expect(found.map((c) => c.id)).toContain('izzet-combo')
      })

      it('keeps a colourless combo in every deck', async () => {
        // An empty array is contained by every identity, which is correct: a
        // combo of colourless pieces is castable anywhere.
        for (const identity of [['R'], ['U'], []] as const)
          expect((await combosInIdentity(db.pool, identity)).map((c) => c.id)).toContain(
            'colorless-combo',
          )
      })

      it('carries only the fields scoring reads', async () => {
        // ADR-0017: `steps` and `prerequisites` are two thirds of the table's
        // bytes and are read by nothing. Undefined, not empty — "not fetched"
        // is a different claim from "this combo has no steps".
        const found = await combosInIdentity(db.pool, ['R'])
        const one = found.find((c) => c.id === 'mono-red-combo')
        expect(one?.pieces).toEqual([redPiece])
        expect(one?.produces).toEqual(['infinite-damage'])
        expect(one?.steps).toBeUndefined()
        expect(one?.prerequisites).toBeUndefined()
        expect(one?.colorIdentity).toBeUndefined()
      })

      it('is served by the identity index rather than a scan', async () => {
        // Without the index the filter is a sequential scan over the table it
        // exists to avoid reading, which trades transfer for CPU.
        //
        // `enable_seqscan = off` for the same reason the `pieces` test does it:
        // a handful of fixture rows are cheaper to scan than to index, so the
        // planner would rightly refuse the index and the assertion would be
        // about the table's size rather than about the index existing.
        const client = await db.pool.connect()
        try {
          await client.query('BEGIN')
          await client.query('SET LOCAL enable_seqscan = off')
          const { rows } = await client.query<{ 'QUERY PLAN': string }>(
            "EXPLAIN SELECT combo_id FROM combos WHERE color_identity <@ '{R}'::char(1)[]",
          )
          await client.query('ROLLBACK')
          expect(rows.map((r) => r['QUERY PLAN']).join(' ')).toMatch(/combos_identity_idx/)
        } finally {
          client.release()
        }
      })
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

    /**
     * Per-deck target overrides (doc 16, migration 0013).
     *
     * Both write paths are covered, because they are different statements: the
     * INSERT in `createDeck` never names the column and relies on the migration
     * default, and the UPDATE in `PATCH /decks/:id` sets it explicitly. A test
     * that only covered one would leave the other free to be wrong.
     */
    describe('target overrides', () => {
      it('starts empty on a freshly inserted deck', async () => {
        // The INSERT path. `createDeck` does not name the column, so this is
        // asserting the migration's DEFAULT and the row-to-deck mapping at once.
        const fresh = deckId(randomUUID())
        await createDeck(db.pool, {
          id: fresh,
          ownerId: owner,
          name: 'Fresh',
          commanders: [uuid()],
          targetBracket: 3,
          archetype: 'midrange',
          colorIdentity: ['R'],
        })
        expect((await getDeck(db.pool, fresh))?.targetOverrides).toEqual({})
      })

      it('round-trips a sparse override through the UPDATE path', async () => {
        await db.pool.query('UPDATE decks SET target_overrides = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify({ roles: { 'role:ramp': 14 }, curve: { 2: 15 }, tolerance: 0.2 }),
        ])
        expect((await getDeck(db.pool, id))?.targetOverrides).toEqual({
          roles: { 'role:ramp': 14 },
          curve: { 2: 15 },
          tolerance: 0.2,
        })
      })

      it('can be cleared back to the archetype', async () => {
        // The way out has to exist. An override a builder cannot get rid of is
        // a trap, and this is the statement `PATCH` issues to undo one.
        await db.pool.query("UPDATE decks SET target_overrides = '{}'::jsonb WHERE id = $1", [id])
        expect((await getDeck(db.pool, id))?.targetOverrides).toEqual({})
      })

      it('survives a malformed row rather than poisoning the deck', async () => {
        // jsonb holds whatever was written — including by a build that knew a
        // different shape. A cast would push "twelve" into `compositionTargets`
        // and produce a NaN target nothing downstream can render, so the parse
        // drops the bad key and keeps the good one.
        await db.pool.query('UPDATE decks SET target_overrides = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify({ roles: { 'role:ramp': 'twelve', 'role:draw': 9 }, tolerance: 'loose' }),
        ])
        expect((await getDeck(db.pool, id))?.targetOverrides).toEqual({ roles: { 'role:draw': 9 } })
      })

      it('reads a non-object jsonb as no overrides at all', async () => {
        await db.pool.query('UPDATE decks SET target_overrides = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify([1, 2, 3]),
        ])
        expect((await getDeck(db.pool, id))?.targetOverrides).toEqual({})
      })

      it('refuses a null, so no reader has to decide what one means', async () => {
        await expect(
          db.pool.query('UPDATE decks SET target_overrides = NULL WHERE id = $1', [id]),
        ).rejects.toThrow(/null value|not-null/i)
      })
    })

    /**
     * Per-deck semantic emphasis (migration 0014).
     *
     * Both write paths again, and here they are genuinely different statements:
     * `createDeck`'s INSERT now NAMES the column and normalises the value on the
     * way in, while `PATCH /decks/:id` writes it with a COALESCE. Covering only
     * the INSERT would leave the update free to be wrong, which is exactly how a
     * mutation survived here last week.
     */
    describe('semantic emphasis', () => {
      it('starts empty on a freshly inserted deck that names none', async () => {
        const fresh = deckId(randomUUID())
        await createDeck(db.pool, {
          id: fresh,
          ownerId: owner,
          name: 'Fresh',
          commanders: [uuid()],
          targetBracket: 3,
          archetype: 'midrange',
          colorIdentity: ['B'],
        })
        expect((await getDeck(db.pool, fresh))?.semanticEmphasis).toEqual([])
      })

      it('stores the emphasis the start screen chose, through the INSERT path', async () => {
        // The user is asked before the deck exists, so this has to be settable
        // at creation and not only by a follow-up PATCH.
        const fresh = deckId(randomUUID())
        await createDeck(db.pool, {
          id: fresh,
          ownerId: owner,
          name: 'Tergrid',
          commanders: [uuid()],
          targetBracket: 3,
          archetype: 'midrange',
          colorIdentity: ['B'],
          semanticEmphasis: ['opponent-sacrifice', 'opponent-discard'],
        })
        // Canonical order, not click order — see `parseSemanticEmphasis`.
        expect((await getDeck(db.pool, fresh))?.semanticEmphasis).toEqual([
          'opponent-discard',
          'opponent-sacrifice',
        ])
      })

      it('normalises duplicates and unknown tags on the way in', async () => {
        const fresh = deckId(randomUUID())
        await createDeck(db.pool, {
          id: fresh,
          ownerId: owner,
          name: 'Noisy',
          commanders: [uuid()],
          targetBracket: 3,
          archetype: 'midrange',
          colorIdentity: ['B'],
          semanticEmphasis: ['untap', 'untap', 'not-a-tag'] as never,
        })
        expect((await getDeck(db.pool, fresh))?.semanticEmphasis).toEqual(['untap'])
      })

      it('round-trips an emphasis through the UPDATE path', async () => {
        await db.pool.query('UPDATE decks SET semantic_emphasis = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify(['opponent-discard', 'untap']),
        ])
        expect((await getDeck(db.pool, id))?.semanticEmphasis).toEqual([
          'untap',
          'opponent-discard',
        ])
      })

      it('can be cleared, because de-emphasising is the point', async () => {
        // The way out has to exist. This is the statement `PATCH` issues for
        // `semanticEmphasis: null`.
        await db.pool.query('UPDATE decks SET semantic_emphasis = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify(['untap']),
        ])
        await db.pool.query("UPDATE decks SET semantic_emphasis = '[]'::jsonb WHERE id = $1", [id])
        expect((await getDeck(db.pool, id))?.semanticEmphasis).toEqual([])
      })

      it('survives a tag a newer build wrote rather than poisoning the deck', async () => {
        await db.pool.query('UPDATE decks SET semantic_emphasis = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify(['opponent-discard', 'mill-yourself']),
        ])
        expect((await getDeck(db.pool, id))?.semanticEmphasis).toEqual(['opponent-discard'])
      })

      it('reads a non-array jsonb as no emphasis at all', async () => {
        await db.pool.query('UPDATE decks SET semantic_emphasis = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify({ untap: true }),
        ])
        expect((await getDeck(db.pool, id))?.semanticEmphasis).toEqual([])
      })

      it('refuses a null, so no reader has to decide what one means', async () => {
        await expect(
          db.pool.query('UPDATE decks SET semantic_emphasis = NULL WHERE id = $1', [id]),
        ).rejects.toThrow(/null value|not-null/i)
      })
    })

    /**
     * The columns saved with a deck (doc 18 §18.7, migration 0015).
     *
     * Both write paths again — `createDeck`'s INSERT names the column and
     * normalises through the parser, `PATCH /decks/:id` writes it with a CASE
     * flag — and one thing neither of the two columns above has to test: NULL is
     * a MEANINGFUL value here and `[]` is a different one. Every assertion below
     * that distinguishes them is the point of the column, not a detail.
     */
    describe('columns', () => {
      it('is null on a freshly inserted deck that names none', async () => {
        // The INSERT path with the field absent. Null, not `[]`: the deck has
        // never said anything, so it draws `DEFAULT_COLUMNS`.
        const fresh = deckId(randomUUID())
        await createDeck(db.pool, {
          id: fresh,
          ownerId: owner,
          name: 'Fresh',
          commanders: [uuid()],
          targetBracket: 3,
          archetype: 'midrange',
          colorIdentity: ['U'],
        })
        const deck = await getDeck(db.pool, fresh)
        expect(deck?.columns).toBeNull()
        expect(columnsFor(deck?.columns)).toEqual(DEFAULT_COLUMNS)
      })

      it('stores columns given at creation, through the INSERT path', async () => {
        const fresh = deckId(randomUUID())
        await createDeck(db.pool, {
          id: fresh,
          ownerId: owner,
          name: 'Cloned',
          commanders: [uuid()],
          targetBracket: 3,
          archetype: 'midrange',
          colorIdentity: ['U'],
          columns: [
            { kind: 'query', query: 't:creature' },
            { kind: 'metric', metric: 'efficiency' },
          ],
        })
        expect((await getDeck(db.pool, fresh))?.columns).toEqual([
          { kind: 'query', query: 't:creature' },
          { kind: 'metric', metric: 'efficiency' },
        ])
      })

      it('stores an EMPTY list at creation as empty, not as null', async () => {
        // "Created with no columns" is a real request and must not be silently
        // turned into "never set", which would hand the deck the defaults.
        const fresh = deckId(randomUUID())
        await createDeck(db.pool, {
          id: fresh,
          ownerId: owner,
          name: 'Bare',
          commanders: [uuid()],
          targetBracket: 3,
          archetype: 'midrange',
          colorIdentity: ['U'],
          columns: [],
        })
        const deck = await getDeck(db.pool, fresh)
        expect(deck?.columns).toEqual([])
        expect(columnsFor(deck?.columns)).toEqual([])
      })

      it('normalises duplicates and unknown metrics on the way in', async () => {
        const fresh = deckId(randomUUID())
        await createDeck(db.pool, {
          id: fresh,
          ownerId: owner,
          name: 'Noisy',
          commanders: [uuid()],
          targetBracket: 3,
          archetype: 'midrange',
          colorIdentity: ['U'],
          columns: [
            { kind: 'metric', metric: 'impact' },
            { kind: 'metric', metric: 'impact' },
            { kind: 'metric', metric: 'not-a-metric' },
          ] as never,
        })
        expect((await getDeck(db.pool, fresh))?.columns).toEqual([
          { kind: 'metric', metric: 'impact' },
        ])
        /*
         * And the ROW itself is canonical, not just what `getDeck` hands back.
         *
         * Read straight out of the database rather than through `toDeck`,
         * because `toDeck` parses too — so an unparsed INSERT would look
         * identical through the repository and the only place the difference is
         * visible is here. It matters because the row is what a migration, a
         * dashboard or a future reader sees, and a stored duplicate is a stored
         * duplicate whatever this build happens to filter on the way out.
         */
        const { rows } = await db.pool.query<{ columns: unknown }>(
          'SELECT columns FROM decks WHERE id = $1',
          [fresh],
        )
        expect(rows[0]?.columns).toEqual([{ kind: 'metric', metric: 'impact' }])
      })

      it('round-trips columns through the UPDATE path', async () => {
        await db.pool.query('UPDATE decks SET columns = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify([{ kind: 'query', query: 'mv<=2' }]),
        ])
        expect((await getDeck(db.pool, id))?.columns).toEqual([{ kind: 'query', query: 'mv<=2' }])
      })

      it('keeps an emptied list emptied through the UPDATE path', async () => {
        // The statement `PATCH … {"columns": []}` issues. If this came back as
        // null the builder's cleared columns would reappear on the next load —
        // the exact failure the nullable column exists to prevent.
        await db.pool.query("UPDATE decks SET columns = '[]'::jsonb WHERE id = $1", [id])
        expect((await getDeck(db.pool, id))?.columns).toEqual([])
      })

      it('accepts a SQL null, which is how a builder gets back to the defaults', async () => {
        // The opposite of `target_overrides` and `semantic_emphasis`, which both
        // reject one. Here it is the statement `PATCH … {"columns": null}`
        // issues, and it must be reachable.
        await db.pool.query('UPDATE decks SET columns = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify([{ kind: 'query', query: 'mv<=2' }]),
        ])
        await db.pool.query('UPDATE decks SET columns = NULL WHERE id = $1', [id])
        const deck = await getDeck(db.pool, id)
        expect(deck?.columns).toBeNull()
        expect(columnsFor(deck?.columns)).toEqual(DEFAULT_COLUMNS)
      })

      it('survives a malformed row rather than poisoning the deck', async () => {
        await db.pool.query('UPDATE decks SET columns = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify([{ kind: 'metric', metric: 'from-a-newer-build' }, { kind: 'query' }]),
        ])
        expect((await getDeck(db.pool, id))?.columns).toEqual([])
      })

      it('reads a non-array jsonb as never set, so the deck falls back to the defaults', async () => {
        // Not as `[]`. A corrupt value must not be read as a claim about the
        // builder's intent.
        await db.pool.query('UPDATE decks SET columns = $2::jsonb WHERE id = $1', [
          id,
          JSON.stringify({ impact: true }),
        ])
        expect((await getDeck(db.pool, id))?.columns).toBeNull()
      })
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

  /**
   * The per-deck command log that makes a 409 replayable (API-06, doc 12 §12.7).
   */
  describe('deck command log', () => {
    const owner = randomUUID()
    const AT = '2026-08-30T12:00:00.000Z'

    /** Not every command names a card, so the union has to be narrowed. */
    const oracleIdsOf = (since: { batches: readonly { commands: readonly DeckCommand[] }[] }) =>
      since.batches.flatMap((b) => b.commands.flatMap((c) => ('oracleId' in c ? [c.oracleId] : [])))

    /** A deck plus `count` logged batches, one card accepted per batch. */
    const deckWithHistory = async (count: number): Promise<{ id: DeckId; ids: OracleId[] }> => {
      const id = deckId(randomUUID())
      await createDeck(db.pool, {
        id,
        ownerId: owner,
        name: 'Logged',
        commanders: [],
        targetBracket: 2,
        archetype: 'midrange',
        colorIdentity: [],
      })
      const ids: OracleId[] = []
      for (let n = 0; n < count; n += 1) {
        const oracle = uuid()
        ids.push(oracle)
        const version = 1 + n
        const outcome = await applyBatch(db.pool, id, version, async (client) => {
          await appendCommandLog(
            client,
            id,
            version + 1,
            [{ type: 'accept', oracleId: oracle, origin: 'manual' }],
            AT,
          )
        })
        expect(outcome.kind).toBe('applied')
      }
      return { id, ids }
    }

    it('reports the commands after the client’s version, oldest first', async () => {
      const { id, ids } = await deckWithHistory(3)

      const since = await commandsSince(db.pool, id, 1, 4)

      expect(since.complete).toBe(true)
      expect(since.batches.map((b) => b.version)).toEqual([2, 3, 4])
      expect(oracleIdsOf(since)).toEqual(ids)
      expect(since.batches[0]?.appliedAt).toBe(AT)
    })

    it('excludes the client’s own version — `since` is what it has NOT seen', async () => {
      const { id, ids } = await deckWithHistory(3)

      const since = await commandsSince(db.pool, id, 3, 4)

      expect(since.complete).toBe(true)
      expect(since.batches).toHaveLength(1)
      expect(oracleIdsOf(since)).toEqual([ids[2]])
    })

    it('is complete and empty when the client is already current', async () => {
      const { id } = await deckWithHistory(2)

      const since = await commandsSince(db.pool, id, 3, 3)

      expect(since).toEqual({ batches: [], complete: true })
    })

    /*
     * The dangerous case. A deck edited before this table existed has version
     * bumps with no log rows, and an empty `since` there means "I cannot tell
     * you", not "nothing happened". A client that could not tell the two apart
     * would rebase against a history it never saw.
     */
    it('is INCOMPLETE when the log does not reach back to the client’s version', async () => {
      const { id } = await deckWithHistory(2)
      // Simulate the pre-API-06 rows: drop the oldest batch from the log.
      await db.pool.query('DELETE FROM deck_command_log WHERE deck_id = $1 AND version = 2', [id])

      const since = await commandsSince(db.pool, id, 1, 3)

      expect(since.batches).toHaveLength(1)
      expect(since.complete).toBe(false)
    })

    it('is INCOMPLETE when a version in the middle of the gap has no log row', async () => {
      const { id } = await deckWithHistory(3)
      await db.pool.query('DELETE FROM deck_command_log WHERE deck_id = $1 AND version = 3', [id])

      const since = await commandsSince(db.pool, id, 1, 4)

      expect(since.complete).toBe(false)
    })

    it('is INCOMPLETE when the gap is longer than the limit', async () => {
      const { id } = await deckWithHistory(3)

      const since = await commandsSince(db.pool, id, 1, 4, { limit: 2 })

      expect(since.batches).toHaveLength(2)
      expect(since.complete).toBe(false)
    })

    it('reports a client claiming to be AHEAD of the server as incomplete, not empty', async () => {
      const { id } = await deckWithHistory(1)

      expect(await commandsSince(db.pool, id, 9, 2)).toEqual({ batches: [], complete: false })
    })

    it('keeps one deck’s history out of another’s', async () => {
      const a = await deckWithHistory(2)
      const b = await deckWithHistory(2)

      const since = await commandsSince(db.pool, a.id, 1, 3)

      expect(oracleIdsOf(since)).toEqual(a.ids)
      expect(oracleIdsOf(since)).not.toContain(b.ids[0])
    })

    it('refuses two batches claiming the same version', async () => {
      const { id } = await deckWithHistory(1)

      await expect(
        applyBatch(db.pool, id, 2, async (client) => {
          await appendCommandLog(client, id, 2, [], AT)
        }),
      ).rejects.toThrow()
    })

    it('goes with the deck when the deck is deleted', async () => {
      const { id } = await deckWithHistory(1)

      await db.pool.query('DELETE FROM decks WHERE id = $1', [id])

      const { rows } = await db.pool.query('SELECT 1 FROM deck_command_log WHERE deck_id = $1', [
        id,
      ])
      expect(rows).toHaveLength(0)
    })

    it('rolls the log back with the batch it describes', async () => {
      const { id } = await deckWithHistory(1)

      await expect(
        applyBatch(db.pool, id, 2, async (client) => {
          await appendCommandLog(client, id, 3, [], AT)
          throw new Error('boom')
        }),
      ).rejects.toThrow('boom')

      const since = await commandsSince(db.pool, id, 1, 2)
      expect(since.batches.map((b) => b.version)).toEqual([2])
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
