import { configFromEnv, createPool } from '@roundtable/db'
import { ingestScryfall } from './scryfall-ingest.js'

/**
 * CLI entry point: `node dist/main.js [--limit N]`.
 *
 * The User-Agent must identify this application (ADR-0009 Q2), so it is built
 * here rather than left to the HTTP library.
 */
const main = async (): Promise<void> => {
  const config = configFromEnv()
  if (config === null) {
    console.error('DATABASE_URL is not set')
    process.exit(1)
  }

  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg === -1 ? undefined : Number(process.argv[limitArg + 1])

  const pool = createPool(config)
  const started = Date.now()
  try {
    const report = await ingestScryfall(pool, {
      userAgent: process.env['SCRYFALL_USER_AGENT'] ?? 'Roundtable/0.1',
      ...(limit !== undefined && Number.isFinite(limit) ? { limit } : {}),
      onProgress: (read) => process.stdout.write(`\r  ${read} records…`),
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
          `${report.skippedNonPlayable} non-playable layouts (art series, tokens)`,
      )
    }
    // Failures are printed, never swallowed (AGENTS.md §8).
    if (report.failed.length > 0) {
      console.error(`  FAILED to map ${report.failed.length} records:`)
      for (const f of report.failed.slice(0, 20)) console.error(`    ${f.id}: ${f.reason}`)
      process.exitCode = 1
    }
  } finally {
    await pool.end()
  }
}

await main()
