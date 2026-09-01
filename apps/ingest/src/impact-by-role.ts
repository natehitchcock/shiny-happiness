#!/usr/bin/env node
/**
 * Regenerate `packages/domain/src/impact/by-role.data.json` (doc 18 §18.12).
 *
 * `pnpm --filter @roundtable/ingest impact-roles [outPath]`
 *
 * What impact actually looks like FOR EACH ROLE. Impact is a property of the
 * card and is not comparable across roles — Sol Ring scores 0.68 and Wrath of
 * God 6.12, and neither number means what a reader would guess from the other.
 * A single bar ("aim for 6") would tell a builder their whole mana base is bad.
 * So the interface places a card against the cards that share its role, and the
 * only honest source for "what is normal for a ramp card" is the corpus.
 *
 * READ-ONLY against the database, exactly like `efficiency-baseline.ts`: it runs
 * no ingest, writes no card, queries no third party (ADR-0008), and touches
 * nothing but one file in the repository.
 *
 * It imports `cardImpact` from the domain package rather than reimplementing the
 * classifier, for the reason the baseline generator gives: the quartiles are
 * quartiles OF THAT MODEL, and two copies of it would drift the day either
 * changed.
 *
 * A CARD COUNTS TOWARD EVERY ROLE IT HOLDS, not only its `primaryRole`. Two
 * reasons, and the second is fatal to the alternative:
 *
 *   - "what does a board wipe score" is a question about board wipes, and a
 *     card that wipes the board is a board wipe whether or not some
 *     higher-precedence role wins the badge. `ROLE_PRECEDENCE` exists to stop
 *     composition counting double-counting a card, which is a different job.
 *   - grouping by `primaryRole` leaves `graveyard-hate` with ZERO cards —
 *     measured: all 100 of them hold a role that outranks it — so that role
 *     would have no distribution at all and the pane would silently show
 *     nothing for it.
 *
 * The renderer still shows only the card's `primaryRole`, and that pairing is
 * safe in one direction that matters: `primaryRole(roles)` is always a member of
 * `roles`, so the card being placed is always inside the population it is placed
 * against.
 */
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { configFromEnv, createPool } from '@roundtable/db'
import { cardImpact } from '@roundtable/domain'
import type { ImpactInput } from '@roundtable/domain'

interface Row {
  readonly name: string
  readonly mana_cost: string | null
  readonly type_line: string
  readonly oracle_text: string | null
  readonly roles: string[]
}

/**
 * Only the four fields the classifier reads.
 *
 * Selected straight from `cards` rather than hydrated through the repository,
 * the same trade `efficiency-baseline.ts` makes: this needs all 31,782 rows and
 * the repository would carry printings, synergy tags and combos that no part of
 * this calculation looks at. `ImpactInput` is the narrow type that makes it safe
 * — no cast to `Card` and no invented fields.
 */
const asCard = (row: Row): ImpactInput => ({
  name: row.name,
  manaCost: row.mana_cost,
  typeLine: row.type_line,
  oracleText: row.oracle_text ?? '',
})

/**
 * The p-th percentile, interpolating between the two neighbouring cards.
 *
 * The ordinary "type 7" definition — what R, NumPy and every spreadsheet's
 * `PERCENTILE` mean by the word — chosen because it is the one a reader who
 * checks this against their own tooling will get. Rejected: nearest-rank, which
 * always returns a value some card actually scored and is therefore prettier in
 * the file, but which jumps by a whole tier at the boundaries; `spot-removal`'s
 * q1 and median are both 1.2 under either method, and the interpolated one at
 * least says WHERE between two rungs a role sits.
 */
const percentile = (sorted: readonly number[], p: number): number => {
  const i = (sorted.length - 1) * p
  const lo = Math.floor(i)
  const hi = Math.ceil(i)
  const low = sorted[lo] ?? 0
  const high = sorted[hi] ?? low
  return low + (high - low) * (i - lo)
}

/** Three places, matching the quantisation `cardImpact` already applies. */
const round = (n: number): number => Math.round(n * 1000) / 1000

const main = async (): Promise<number> => {
  const config = configFromEnv()
  if (config === null) {
    console.error('DATABASE_URL is not set.')
    return 1
  }
  const pool = createPool(config)
  try {
    const { rows } = await pool.query<Row>(
      `SELECT name, mana_cost, type_line, oracle_text, roles
         FROM cards WHERE legality_commander = 'legal'`,
    )
    if (rows.length === 0) {
      // Refusing rather than writing quartiles of nothing, the same argument
      // `efficiency-baseline.ts` makes: an empty corpus produces a file in which
      // every role's band is undefined and nothing downstream would fail to say
      // so.
      console.error('corpus is empty — run the ingest before regenerating the role bands')
      return 1
    }

    /** score, and whether the model found anything at all to count. */
    const byRole = new Map<string, { scores: number[]; noCountableEffect: number }>()
    for (const row of rows) {
      const impact = cardImpact(asCard(row))
      for (const role of row.roles) {
        let bucket = byRole.get(role)
        if (bucket === undefined) {
          bucket = { scores: [], noCountableEffect: 0 }
          byRole.set(role, bucket)
        }
        bucket.scores.push(impact.score)
        // `breadth: 'none'` is the model saying the text names nothing to affect
        // — the blindness doc 18 §18.2 accepts rather than patches. Counted per
        // role so the pane can say "this metric cannot see three quarters of
        // these cards" instead of leaving a reader to infer it from a low band.
        if (impact.breadth === 'none') bucket.noCountableEffect += 1
      }
    }

    // Sorted by role name so a regeneration produces a minimal diff: an
    // insertion-ordered file would reshuffle every time the corpus changed which
    // card was read first.
    const roles: Record<string, unknown> = {}
    for (const [role, bucket] of [...byRole].sort((a, b) => a[0].localeCompare(b[0]))) {
      const sorted = [...bucket.scores].sort((a, b) => a - b)
      roles[role] = {
        n: sorted.length,
        q1: round(percentile(sorted, 0.25)),
        median: round(percentile(sorted, 0.5)),
        q3: round(percentile(sorted, 0.75)),
        noCountableEffect: bucket.noCountableEffect,
      }
    }

    const data = {
      $comment: [
        'GENERATED. Do not edit by hand — run `pnpm --filter @roundtable/ingest impact-roles`',
        'against a corpus database and commit what it writes (doc 18 §18.12).',
        '',
        'What impact looks like for each role, so a card can be placed against the',
        'cards that share its job rather than against the whole format. Impact is',
        'NOT comparable across roles: Sol Ring scores 0.68 and Wrath of God 6.12,',
        'and a single bar for all eighteen roles would tell a builder their entire',
        'mana base was bad.',
        '',
        'DESCRIPTIVE, NOT PRESCRIPTIVE. These are quartiles of the corpus, not',
        'targets. doc 18 §18.9 declined to give the model bands and that still',
        'holds — nothing here says what a card SHOULD score. q1 and q3 are printed',
        'in the interface beside any verdict drawn from them, so the cutoff is the',
        "corpus's own and a reader can disagree with it on sight.",
        '',
        'A card counts toward EVERY role it holds, not only its primaryRole:',
        '`primaryRole` exists to stop composition counting double-counting a card,',
        'and grouping by it leaves `graveyard-hate` with no cards at all.',
        '',
        '`noCountableEffect` is how many of them the model reads as naming nothing',
        'to affect (`breadth: none`) — the blindness doc 18 §18.2 accepts rather',
        'than patches, measured per role so the interface can state it.',
      ],
      generatedAt: new Date().toISOString().slice(0, 10),
      corpus: { commanderLegal: rows.length },
      roles,
    }

    const here = dirname(fileURLToPath(import.meta.url))
    const out =
      process.argv[2] ??
      join(here, '..', '..', '..', 'packages', 'domain', 'src', 'impact', 'by-role.data.json')
    writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
    console.error(`wrote ${out}`)
    console.error(`  ${rows.length} commander-legal cards, ${Object.keys(roles).length} roles`)
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
