/**
 * Write `tokens.css` from `tokens.ts`.
 *
 * One source of truth. The TypeScript is where contrast is asserted, so the CSS
 * is derived from it rather than maintained beside it — a hand-edited stylesheet
 * would ship a colour no test had ever looked at.
 *
 * Run: pnpm --filter @roundtable/ui tokens
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { COLORS, SPACE, TYPE } from '../dist/tokens.js'

const here = dirname(fileURLToPath(import.meta.url))

const css = [
  '/*',
  ' * Design tokens as custom properties (FOUND-02).',
  ' *',
  ' * GENERATED from `tokens.ts` by `pnpm --filter @roundtable/ui tokens`. Edit the',
  ' * TypeScript, not this file: the values are asserted for contrast there, and a',
  ' * hand-edit here would ship a colour no test had looked at.',
  ' */',
  '',
  ':root {',
  ...COLORS.map((c) => `  --${c.name}: ${c.value};`),
  '',
  ...Object.entries(TYPE).map(([k, v]) => `  --${k}: ${v};`),
  '',
  ...Object.entries(SPACE).map(([k, v]) => `  --${k}: ${v};`),
  '',
  '  color-scheme: dark;',
  '}',
  '',
].join('\n')

writeFileSync(join(here, '..', 'src', 'tokens.css'), css, 'utf8')
console.log(`wrote tokens.css (${String(COLORS.length)} colours)`)
