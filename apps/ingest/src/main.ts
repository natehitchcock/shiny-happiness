import type { Pool } from 'pg'
import { configFromEnv, createPool } from '@roundtable/db'
import { ingestScryfall } from './scryfall-ingest.js'
import { ingestSpellbook } from './spellbook-ingest.js'

/**
 * CLI entry point: `node dist/main.js [cards|combos|all] [--limit N]`.
 *
 * The User-Agent must identify this application (ADR-0009 Q2), so it is built
 * here rather than left to the HTTP library.
 */

const runCards = async (pool: Pool, limit: number | undefined): Promise<void> => {
  const started = Date.now()
  const report = await ingestScryfall(pool, {
    userAgent: process.env['SCRYFALL_USER_AGENT'] ?? 'Roundtable/0.1',
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    onProgress: (read) => process.stdout.write(`\r  ${read} records...`),
  })
  process.stdout.write('\r')
  console.log(
    `ingested ${report.cards} cards, ${report.printings} printings from ${report.read} records ` +
      `in ${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
  console.log(`  source updated ${report.sourceUpdatedAt}, snapshot ${report.snapshotId}`)
  if (report.skippedNoOracleId > 0 || report.skippedNonPlayable > 0) {
    console.log(
      `  skipped ${report.skippedNoOracleId} with no oracle_id, ` +
        `${report.skippedNonPlayable} non-playable layouts (art series, tokens, stickers)`,
    )
  }
  // Failures are printed, never swallowed (AGENTS.md §8).
  if (report.failed.length > 0) {
    console.error(`  FAILED to map ${report.failed.length} records:`)
    for (const f of report.failed.slice(0, 20)) console.error(`    ${f.id}: ${f.reason}`)
    process.exitCode = 1
  }
}

const runCombos = async (pool: Pool, limit: number | undefined): Promise<void> => {
  const started = Date.now()
  const report = await ingestSpellbook(pool, {
    userAgent: process.env['SCRYFALL_USER_AGENT'] ?? 'Roundtable/0.1',
    ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
    onProgress: (read) => process.stdout.write(`\r  ${read} variants...`),
  })
  process.stdout.write('\r')
  console.log(
    `ingested ${report.combos} combos from ${report.read} variants in ` +
      `${((Date.now() - started) / 1000).toFixed(1)}s`,
  )
  if (report.skippedNotOk > 0 || report.skippedNoPieces > 0) {
    console.log(
      `  skipped ${report.skippedNotOk} not-OK status, ${report.skippedNoPieces} with no pieces`,
    )
  }
  // Unmapped pieces are reported loudly, never dropped quietly (doc 04 §4.2).
  if (report.unmapped.length > 0) {
    console.error(`  ${report.unmapped.length} combos name cards not in the corpus:`)
    for (const u of report.unmapped.slice(0, 10)) {
      console.error(`    ${u.comboId} missing ${u.missing.join(', ')}`)
    }
    console.error('    (usually means the Scryfall ingest is older than the Spellbook one)')
  }
}

const main = async (): Promise<void> => {
  const config = configFromEnv()
  if (config === null) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const which = process.argv[2] ?? 'all'
  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg === -1 ? undefined : Number(process.argv[limitArg + 1])

  const pool = createPool(config)
  try {
    if (which === 'cards' || which === 'all') await runCards(pool, limit)
    if (which === 'combos' || which === 'all') await runCombos(pool, limit)
  } finally {
    await pool.end()
  }
}

await main()
