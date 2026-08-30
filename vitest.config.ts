import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.{ts,tsx}', 'api/**/*.test.ts'],
    // No network in tests (AGENTS.md §3). Third-party responses come from
    // recorded fixtures in packages/clients/fixtures/.
    //
    // Node by default because almost nothing here needs a DOM; the component
    // tests in packages/ui opt into jsdom with a `@vitest-environment` docblock.
    // Making jsdom the default would slow every domain test down to buy nothing.
    environment: 'node',
    coverage: { provider: 'v8', reportsDirectory: 'coverage' },
  },
})
