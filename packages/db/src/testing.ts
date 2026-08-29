import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import { loadMigrations, migrateUp } from './migrate.js'

/**
 * Integration-test harness.
 *
 * Tests run against a REAL PostgreSQL server (AGENTS.md §4) — never a mock and
 * never an in-memory substitute. Array containment, partial unique indexes and
 * `SELECT ... FOR UPDATE` are exactly the behaviours worth testing, and none of
 * them exist in a fake.
 *
 * The server is whatever `DATABASE_URL` points at: a container service in CI, a
 * local instance in development. Each test file gets its own throwaway database,
 * so files can run in parallel without seeing each other's rows.
 */

export const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations')

export const databaseUrl = (): string | null => {
  const url = process.env['DATABASE_URL']
  return url === undefined || url === '' ? null : url
}

export interface TestDatabase {
  readonly pool: Pool
  readonly name: string
  readonly drop: () => Promise<void>
}

/** Create a migrated, isolated database. Caller must `drop()` it. */
export const createTestDatabase = async (label: string): Promise<TestDatabase> => {
  const url = databaseUrl()
  if (url === null) throw new Error('DATABASE_URL is not set')

  const name = `rt_test_${label}_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  const admin = new Pool({ connectionString: url })
  try {
    // Identifier is built from a UUID and a caller-supplied label, so it is
    // quoted rather than interpolated raw.
    await admin.query(`CREATE DATABASE "${name}"`)
  } finally {
    await admin.end()
  }

  const target = new URL(url)
  target.pathname = `/${name}`
  const pool = new Pool({ connectionString: target.toString() })

  const drop = async (): Promise<void> => {
    await pool.end()
    const cleanup = new Pool({ connectionString: url })
    try {
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`)
    } finally {
      await cleanup.end()
    }
  }

  try {
    await migrateUp(pool, await loadMigrations(MIGRATIONS_DIR))
  } catch (error) {
    // A migration failure must not leak the database or leave the pool open —
    // an open pool keeps vitest's process alive after the run finishes.
    await drop().catch(() => undefined)
    throw error
  }

  return { pool, name, drop }
}
