import { describe, expect, it } from 'vitest'
import { databaseUrl } from './testing.js'

/**
 * A run that skipped the database suites must not be green.
 *
 * AGENTS.md §4 says the integration tests need a real Postgres and "SKIP
 * (loudly) without one". They skip; the loud part was missing. Measured on this
 * repository with `DATABASE_URL` unset:
 *
 *     Test Files  63 passed | 6 skipped (69)
 *     Tests       1180 passed | 229 skipped (1409)
 *     exit 0
 *
 * A green tick over 229 unrun tests is worse than a red one, because it is
 * indistinguishable from a green tick over 1,409. It also explains an
 * intermittent failure nobody could reproduce: roughly one run in eight ended
 * "51 passed (52)" with a different file missing each time, which is what a
 * worker that cannot see `DATABASE_URL` looks like from the outside.
 *
 * So the default is now RED, and skipping is something an operator ASKS for.
 * `LW_ALLOW_NO_DB=1` is for a contributor who genuinely has no Postgres: it
 * says out loud that this run proves less, which is the whole point.
 */
describe('the database suites actually ran', () => {
  it('fails rather than quietly skipping 229 tests', () => {
    if (process.env['LW_ALLOW_NO_DB'] === '1') {
      // Opted out on purpose. Recorded in the run so the reduced coverage is
      // visible in the log rather than only in a count nobody reads.
      console.warn(
        '[db] LW_ALLOW_NO_DB=1 — the PostgreSQL integration suites were skipped. ' +
          'This run does not cover the schema, the repositories or the API contract.',
      )
      expect(true).toBe(true)
      return
    }

    expect(
      databaseUrl(),
      'DATABASE_URL is not set, so the PostgreSQL suites skipped and this run ' +
        'proves far less than a green tick suggests. Start Postgres and set it, ' +
        'or set LW_ALLOW_NO_DB=1 to say you know.',
    ).not.toBeNull()
  })
})
