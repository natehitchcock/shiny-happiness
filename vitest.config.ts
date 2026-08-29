import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['{packages,apps}/*/src/**/*.test.ts'],
    // No network in tests (AGENTS.md §3). Third-party responses come from
    // recorded fixtures in packages/clients/fixtures/.
    environment: 'node',
    coverage: { provider: 'v8', reportsDirectory: 'coverage' },
  },
})
