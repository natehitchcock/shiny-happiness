#!/usr/bin/env node
/**
 * Regenerate `packages/domain/src/efficiency/effect-prices.data.json` (ADR-0070).
 *
 * `pnpm --filter @roundtable/ingest effect-prices [outPath]`
 *
 * The database shell. All of the arithmetic is in `effect-prices-fit.ts`, which
 * is pure and importable without an environment; this file does one query, one
 * call and one write.
 *
 * READ-ONLY against the database. It runs no ingest, writes no card, and
 * touches nothing but one file in the repository. It is safe to run against
 * production data and is not part of the scheduled worker in `main.ts`.
 *
 * THE FILE IT WRITES IS THE ONLY SUPPORTED PROVENANCE. `efficiency.ts` reads
 * `source` off the shipped file and `efficiency.test.ts` fails on anything that
 * is not `corpus-database`, so a stand-in cannot ship quietly.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configFromEnv, createPool } from '@roundtable/db'
import { FILE_COMMENT, asCard, fitEffectPrices, type Row } from './effect-prices-fit.js'

const main = async (): Promise<number> => {
  const config = configFromEnv()
  if (config === null) {
    console.error('DATABASE_URL is not set.')
    return 1
  }
  const pool = createPool(config)
  try {
    const { rows } = await pool.query<Row>(
      `SELECT name, mana_cost, mana_value, type_line, oracle_text, types, power_num, toughness_num,
              roles, synergy_produces
         FROM cards WHERE legality_commander = 'legal'`,
    )
    if (rows.length === 0) {
      // Refusing rather than writing a file of zeroes. An empty corpus would
      // produce prices under which every card is worth nothing and efficiency
      // is exactly minus its mana value — every column sorted by cheapness and
      // nothing downstream failing to say so. `efficiency.ts` throws on such a
      // file too; this is the same refusal one step earlier, where the reason
      // can actually be reported.
      console.error('corpus is empty — run the ingest before regenerating the effect prices')
      return 1
    }

    const fitted = fitEffectPrices(rows.map(asCard))

    const data = {
      $comment: FILE_COMMENT,
      source: 'corpus-database',
      generatedAt: new Date().toISOString().slice(0, 10),
      corpus: { commanderLegal: rows.length },
      fit: fitted.fit,
      roles: fitted.roles,
      produces: fitted.produces,
      rate: fitted.rate,
      body: fitted.body,
    }

    const here = dirname(fileURLToPath(import.meta.url))
    const out =
      process.argv[2] ??
      join(
        here,
        '..',
        '..',
        '..',
        'packages',
        'domain',
        'src',
        'efficiency',
        'effect-prices.data.json',
      )
    writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    console.error(`wrote ${out}`)
    console.error(
      `  ${rows.length} commander-legal cards, ${fitted.fit.features} features,`,
      `MAE ${String(fitted.fit.meanAbsoluteError)} mana`,
      `(cross-validated ${String(fitted.fit.crossValidatedMeanAbsoluteError)})`,
    )
    return 0
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
