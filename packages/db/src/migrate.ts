import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool, PoolClient } from 'pg'
import { withTransaction } from './client.js'

/**
 * Migration runner.
 *
 * Deliberately small and dependency-free: numbered `.up.sql`/`.down.sql` pairs
 * applied in order, tracked in `schema_migrations`. A migration framework would
 * be more machinery than a schema this size warrants, and plain SQL files are
 * reviewable by anyone who can read SQL.
 *
 * Each migration runs inside its own transaction, so a failure leaves the
 * database on the last complete version rather than halfway through one.
 */

export interface Migration {
  readonly version: string
  readonly up: string
  readonly down: string
}

const MIGRATION_FILE = /^(\d{4}_[a-z0-9_]+)\.(up|down)\.sql$/

export const loadMigrations = async (directory: string): Promise<Migration[]> => {
  const files = await readdir(directory)
  const parts = new Map<string, { up?: string; down?: string }>()

  for (const file of files.sort()) {
    const match = MIGRATION_FILE.exec(file)
    if (match === null) continue
    const version = match[1]!
    const direction = match[2]! as 'up' | 'down'
    const sql = await readFile(join(directory, file), 'utf8')
    const entry = parts.get(version) ?? {}
    entry[direction] = sql
    parts.set(version, entry)
  }

  const migrations: Migration[] = []
  for (const [version, { up, down }] of [...parts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (up === undefined) throw new Error(`migration ${version} has no .up.sql`)
    // A migration you cannot reverse is a migration you cannot deploy safely.
    if (down === undefined) throw new Error(`migration ${version} has no .down.sql`)
    migrations.push({ version, up, down })
  }
  return migrations
}

const MIGRATIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version    text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`

const appliedVersions = async (client: PoolClient): Promise<Set<string>> => {
  await client.query(MIGRATIONS_TABLE)
  const { rows } = await client.query<{ version: string }>(
    'SELECT version FROM schema_migrations ORDER BY version',
  )
  return new Set(rows.map((row) => row.version))
}

export const migrateUp = async (
  pool: Pool,
  migrations: readonly Migration[],
): Promise<string[]> => {
  const applied: string[] = []
  for (const migration of migrations) {
    const already = await withTransaction(pool, (client) => appliedVersions(client))
    if (already.has(migration.version)) continue
    await withTransaction(pool, async (client) => {
      await client.query(migration.up)
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [migration.version])
    })
    applied.push(migration.version)
  }
  return applied
}

/** Roll back the most recent `count` migrations, newest first. */
export const migrateDown = async (
  pool: Pool,
  migrations: readonly Migration[],
  count = 1,
): Promise<string[]> => {
  const already = await withTransaction(pool, (client) => appliedVersions(client))
  const reverted: string[] = []
  const target = [...migrations]
    .reverse()
    .filter((m) => already.has(m.version))
    .slice(0, count)

  for (const migration of target) {
    await withTransaction(pool, async (client) => {
      await client.query(migration.down)
      await client.query('DELETE FROM schema_migrations WHERE version = $1', [migration.version])
    })
    reverted.push(migration.version)
  }
  return reverted
}

export const migrationStatus = async (
  pool: Pool,
  migrations: readonly Migration[],
): Promise<{ version: string; applied: boolean }[]> => {
  const already = await withTransaction(pool, (client) => appliedVersions(client))
  return migrations.map((m) => ({ version: m.version, applied: already.has(m.version) }))
}
