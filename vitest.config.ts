import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.{ts,tsx}'],
    // No network in tests (AGENTS.md §3). Third-party responses come from
    // recorded fixtures in packages/clients/fixtures/.
    //
    // Node by default because almost nothing here needs a DOM; the component
    // tests in packages/ui opt into jsdom with a `@vitest-environment` docblock.
    // Making jsdom the default would slow every domain test down to buy nothing.
    environment: 'node',
    // Fills in the browser APIs jsdom leaves out. See the file for why it is
    // here and not behind a guard in the app.
    setupFiles: ['./vitest.setup.ts'],
    coverage: { provider: 'v8', reportsDirectory: 'coverage' },
  },
})
