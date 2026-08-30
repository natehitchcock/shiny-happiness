import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { loadMigrations, migrateUp } from './index.js'
import { createTestDatabase, databaseUrl, MIGRATIONS_DIR, type TestDatabase } from './testing.js'

const url = databaseUrl()
if (url === null) {
  console.warn('\n[db] DATABASE_URL not set — SKIPPING the printings/cards ordering test.\n')
}
const describeDb = url === null ? describe.skip : describe

/**
 * `printings.oracle_id` references `cards`, so a printing cannot be written
 * before the card it belongs to.
 *
 * The Scryfall ingest READS printings first — it has to, because Universes
 * Beyond provenance is a tally over every printing (ADR-0011) and no card row
 * can be written until that tally is complete. For a long time it also WROTE
 * them first, which works on any database that already holds a corpus and fails
 * on an empty one:
 *
 *   insert or update on table "printings" violates foreign key constraint
 *   "printings_oracle_id_fkey"
 *
 * So it passed locally forever and failed the first time it was pointed at a
 * fresh Neon database — the only run where the order could possibly matter.
 * This asserts the constraint itself against a genuinely empty schema, rather
 * than asserting the ingest's internals, because the ingest is not the only
 * thing that could get the order wrong.
 */
describeDb('printings cannot outrun their cards', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase('fkorder')
    await migrateUp(db.pool, await loadMigrations(MIGRATIONS_DIR))
  }, 60_000)

  afterAll(async () => {
    await db.drop()
  })

  const insertPrinting = (oracleId: string): Promise<unknown> =>
    db.pool.query(
      `INSERT INTO printings (printing_id, oracle_id, set_code, set_name,
                              collector_number, rarity, image_art_crop,
                              image_normal, price_usd, reserved)
       VALUES ($1, $2, 'tst', 'Test Set', '1', 'common', 'a', 'b', NULL, false)`,
      ['22222222-2222-4222-8222-222222222222', oracleId],
    )

  it('refuses a printing whose oracle card has not been written yet', async () => {
    await expect(insertPrinting('11111111-1111-4111-8111-111111111111')).rejects.toThrow(
      /foreign key constraint/i,
    )
  })

  it('accepts the same printing once the card exists', async () => {
    const oracleId = '11111111-1111-4111-8111-111111111111'
    await db.pool.query(
      `INSERT INTO cards (oracle_id, name, mana_cost, mana_value, color_identity, colors,
                          type_line, types, oracle_text, keywords, legality_commander,
                          edhrec_rank, default_printing, roles, primary_role)
       VALUES ($1, 'Test Card', '{R}', 1, ARRAY['R']::char(1)[], ARRAY['R']::char(1)[],
               'Creature', ARRAY['creature'], '', ARRAY[]::text[], 'legal',
               NULL, NULL, ARRAY['wincon'], 'wincon')`,
      [oracleId],
    )
    await expect(insertPrinting(oracleId)).resolves.toBeDefined()
  })
})
