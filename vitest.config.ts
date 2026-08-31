import { defineConfig } from 'vitest/config'

/**
 * Two projects, because six of the suites share one Postgres server.
 *
 * `createTestDatabase` issues `CREATE DATABASE` and `DROP DATABASE ... WITH
 * (FORCE)` per suite, and Postgres serialises those against the whole cluster.
 * Run six of them at once and they queue behind each other while their own
 * timeouts keep running: the symptom was `Hook timed out in 10000ms` and
 * `runs up and down cleanly 60003ms` on runs where every assertion passed, and
 * it moved from file to file between runs. Worse than the noise, a teardown
 * that times out never reaches its `DROP`, so each flake LEAKS a database —
 * ten had accumulated on the development server before anyone counted.
 *
 * So the database suites get a project of their own with `fileParallelism`
 * off: they wait for each other rather than fight. Everything else — 46 files
 * of pure domain logic and jsdom components that never open a socket — stays
 * fully parallel, because serialising those would buy nothing and cost the
 * whole suite's wall time.
 *
 * The alternative was `fileParallelism: false` globally, which was measured:
 * 55 s parallel against 124 s serial. Paying 69 seconds on every run to fix
 * contention among six files is the wrong trade when the contention can be
 * confined to the six.
 *
 * An advisory lock around just the CREATE/DROP was the other candidate. It
 * keeps more parallelism, but it puts the fix inside the test harness where it
 * is invisible to anyone reading the config and wondering why these suites are
 * slow — and it would still let six suites hold six live databases and six
 * connection pools against one server at once. This says what is happening in
 * the place someone looks for it.
 */

/** Every suite that stands up its own database. Kept literal, not a glob. */
const DATABASE_SUITES = [
  'apps/api/src/api.test.ts',
  'apps/api/src/api-02.test.ts',
  'apps/api/src/api-06.test.ts',
  'apps/api/src/recommendations.perf.test.ts',
  'apps/ingest/src/scryfall-ingest.test.ts',
  'packages/db/src/db.test.ts',
  // Not a database suite itself — it is the guard that fails when they were
  // skipped — but it belongs in the same project so it cannot run in a worker
  // that sees a different environment from the suites it is speaking for.
  'packages/db/src/database-required.test.ts',
]

const shared = {
  // No network in tests (AGENTS.md §3). Third-party responses come from
  // recorded fixtures in packages/clients/fixtures/.
  //
  // Node by default because almost nothing here needs a DOM; the component
  // tests in packages/ui opt into jsdom with a `@vitest-environment` docblock.
  // Making jsdom the default would slow every domain test down to buy nothing.
  environment: 'node' as const,
  // Fills in the browser APIs jsdom leaves out. See the file for why it is
  // here and not behind a guard in the app.
  setupFiles: ['./vitest.setup.ts'],
}

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          ...shared,
          name: 'unit',
          include: ['{packages,apps}/*/src/**/*.test.{ts,tsx}'],
          exclude: DATABASE_SUITES,
        },
      },
      {
        test: {
          ...shared,
          name: 'database',
          include: DATABASE_SUITES,
          /*
           * The whole point. One database suite at a time, so `CREATE DATABASE`
           * and `DROP DATABASE` never queue behind each other while a hook
           * timeout is counting down.
           */
          fileParallelism: false,
        },
      },
    ],
    coverage: { provider: 'v8', reportsDirectory: 'coverage' },
  },
})
