#!/usr/bin/env node
/**
 * Migration CLI: `pnpm --filter @roundtable/db migrate <up|down|status>`.
 *
 * DB-01's definition of done is "migrations up/down clean", which needs a way for
 * an operator to actually run them.
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configFromEnv, createPool } from './client.js'
import { loadMigrations, migrateDown, migrateUp, migrationStatus } from './migrate.js'

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

const main = async (): Promise<number> => {
  const command = process.argv[2] ?? 'status'
  const config = configFromEnv()
  if (config === null) {
    console.error('DATABASE_URL is not set.')
    return 1
  }

  const pool = createPool(config)
  try {
    const migrations = await loadMigrations(MIGRATIONS_DIR)
    switch (command) {
      case 'up': {
        const applied = await migrateUp(pool, migrations)
        console.error(
          applied.length === 0 ? 'already up to date' : `applied: ${applied.join(', ')}`,
        )
        return 0
      }
      case 'down': {
        const count = Number(process.argv[3] ?? 1)
        const reverted = await migrateDown(pool, migrations, count)
        console.error(
          reverted.length === 0 ? 'nothing to revert' : `reverted: ${reverted.join(', ')}`,
        )
        return 0
      }
      case 'status': {
        for (const { version, applied } of await migrationStatus(pool, migrations)) {
          console.error(`${applied ? '  applied' : '  PENDING'}  ${version}`)
        }
        return 0
      }
      default:
        console.error(`unknown command "${command}" — expected up, down or status`)
        return 1
    }
  } finally {
    await pool.end()
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
