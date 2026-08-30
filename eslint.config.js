// @ts-check
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

/** Modules that would make `packages/domain` impure. See AGENTS.md R1. */
const IO_MODULES = [
  'node:fs',
  'node:fs/promises',
  'node:net',
  'node:http',
  'node:https',
  'node:dns',
  'node:child_process',
  'node:worker_threads',
  'node:os',
  'node:process',
  'fs',
  'net',
  'http',
  'https',
  'dns',
  'child_process',
  'os',
  'process',
  'undici',
  'axios',
  'node-fetch',
  'pg',
  'ioredis',
  'redis',
]

export default tseslint.config(
  { ignores: ['**/dist/**', '**/.turbo/**', 'design/**', 'coverage/**'] },

  tseslint.configs.recommended,

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-expect-error': 'allow-with-description', minimumDescriptionLength: 10 },
      ],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'off',
      eqeqeq: ['error', 'always'],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },

  // ---- R1: packages/domain is pure. No IO, no ambient non-determinism. ----
  // AGENTS.md §2 R1 — this rule is what stops the purity guarantee eroding.
  {
    files: ['packages/domain/**/*.ts'],
    ignores: ['packages/domain/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: IO_MODULES.map((name) => ({
            name,
            message: 'packages/domain must stay pure (AGENTS.md R1). Inject IO from the caller.',
          })),
          patterns: [
            {
              group: ['@roundtable/clients', '@roundtable/db', '@roundtable/ui'],
              message: 'packages/domain may not depend on IO packages (AGENTS.md R1).',
            },
          ],
        },
      ],
      'no-restricted-properties': [
        'error',
        {
          object: 'Date',
          property: 'now',
          message: 'Non-deterministic (AGENTS.md R1). Take a clock as a parameter.',
        },
        {
          object: 'Math',
          property: 'random',
          message: 'Non-deterministic (AGENTS.md R1). Take a seeded RNG as a parameter.',
        },
      ],
      'no-restricted-globals': [
        'error',
        { name: 'fetch', message: 'No network in packages/domain (AGENTS.md R1, R3).' },
        { name: 'process', message: 'No environment access in packages/domain (AGENTS.md R1).' },
      ],
      'no-restricted-syntax': [
        'error',
        {
          selector: "NewExpression[callee.name='Date'][arguments.length=0]",
          message: 'new Date() is non-deterministic (AGENTS.md R1). Take a clock as a parameter.',
        },
      ],
    },
  },

  // ---- R3: third-party network access lives only in packages/clients ----
  //
  // `packages/domain` is deliberately NOT listed. Flat config REPLACES a rule
  // rather than merging it, so listing it here overwrote the R1 block's
  // `no-restricted-globals` — which bans `process` as well as `fetch` — and left
  // half of R1's guard inert. Domain purity is covered by the R1 block above,
  // which already bans `fetch`.
  {
    files: ['apps/**/*.ts', 'packages/db/**/*.ts', 'packages/ui/**/*.ts'],
    rules: {
      'no-restricted-globals': [
        'error',
        {
          name: 'fetch',
          message:
            'All third-party network access goes through packages/clients (AGENTS.md R3, doc 04 §4.0).',
        },
      ],
    },
  },

  { files: ['**/*.test.ts'], rules: { 'no-console': 'off' } },

  // A CLI's stdout is its product, not a stray debug statement. Only the entry
  // points, so a stray console.log in a library still warns.
  { files: ['apps/*/src/main.ts'], rules: { 'no-console': 'off' } },

  prettier,
)
