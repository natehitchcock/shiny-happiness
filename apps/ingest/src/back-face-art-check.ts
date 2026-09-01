#!/usr/bin/env node
/**
 * Does the corpus actually have back-face art? (ADR-0027, migration 0016.)
 *
 * `pnpm --filter @roundtable/ingest back-face-art`
 *
 * READ-ONLY. It runs no ingest, writes no row, performs no DDL and touches
 * nothing but `SELECT`. Safe to point at any database, including production.
 *
 * IT FAILS BEFORE THE DATA EXISTS, on purpose. A check that reported "0 cards
 * with back art" and exited 0 would be indistinguishable from a check that had
 * not noticed the columns were empty, and empty columns are exactly the state
 * this is meant to catch — the migration adds two nullable columns and every
 * pre-existing row reads as single-faced until a card ingest rewrites it. So:
 * a corpus with cards but no back art is an ERROR, not a finding.
 *
 * It also checks named cards rather than only counting. A count can be right
 * for the wrong reason; `Fire // Ice` having no back and `Delver of Secrets`
 * having one are the two halves of the rule, and a run where both hold is
 * evidence the mapper read `card_faces` the way the layout says to.
 */
import type { Pool } from 'pg'
import { configFromEnv, createPool } from '@roundtable/db'

/**
 * What the corpus said before this change, from the record in
 * `packages/clients/src/scryfall.ts`: 501 of 890 `//` cards are `transform`
 * (401) or `modal_dfc` (100), and every one of them carries face images.
 *
 * A LOWER BOUND on cards, not an equality. The 501 was measured over cards
 * whose DEFAULT printing had no art, and Scryfall keeps printing double-faced
 * cards, so the true number only goes up. Asserting equality would make this
 * fail on Wizards releasing a set.
 */
const KNOWN_TWO_FACED_CARDS = 501

/** Names checked by hand, one per layout that behaves differently. */
const EXPECTED: readonly { readonly name: string; readonly back: boolean; readonly why: string }[] =
  [
    {
      name: 'Delver of Secrets // Insectile Aberration',
      back: true,
      why: 'transform — two physical faces, images only on card_faces[]',
    },
    {
      name: 'Tergrid, God of Fright // Tergrid’s Lantern',
      back: true,
      why: 'modal_dfc — same shape as transform',
    },
    {
      name: 'Fire // Ice',
      back: false,
      why: 'split — two HALVES of one physical face, art at the top level',
    },
    {
      name: 'Bonecrusher Giant // Stomp',
      back: false,
      why: 'adventure — one physical face, same as split',
    },
    {
      name: 'Brisela, Voice of Nightmares',
      back: false,
      why: 'meld — a separate card with its own face, not the back of anything',
    },
  ]

interface Row {
  readonly name: string
  readonly has_back: boolean | null
  readonly back_normal: string | null
}

/**
 * Scryfall writes a typographic apostrophe in some names and an ASCII one in
 * others, and which one a name uses is not worth encoding in a check about
 * pictures. Compared after folding both to the same character.
 */
const foldApostrophes = (name: string): string => name.replace(/[’']/g, '’')

const main = async (): Promise<number> => {
  const config = configFromEnv()
  if (config === null) {
    console.error('DATABASE_URL is not set.')
    return 1
  }

  const pool: Pool = createPool(config)
  let failures = 0
  const fail = (message: string): void => {
    console.error(`  FAIL  ${message}`)
    failures += 1
  }

  try {
    /*
     * Asked before anything else, so an unmigrated database gets a sentence
     * rather than a `42703` stack trace.
     *
     * "The columns are not there" and "the columns are there and empty" are
     * different problems with different fixes — apply 0016, versus re-run the
     * ingest — and a check that reported them the same way would send an
     * operator to the wrong one.
     */
    const { rows: columns } = await pool.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'printings'
          AND column_name IN ('image_back_art_crop', 'image_back_normal')`,
    )
    if (columns.length < 2) {
      console.error(
        'printings has no back-face columns: migration 0016 has not been applied ' +
          'to this database. Run `pnpm --filter @roundtable/db migrate up` first.',
      )
      return 1
    }

    const { rows: counts } = await pool.query<{
      printings: string
      printings_with_back: string
      printings_with_back_art: string
      cards_with_back: string
      cards: string
    }>(
      `SELECT (SELECT count(*) FROM printings)                                    AS printings,
              (SELECT count(*) FROM printings
                WHERE image_back_art_crop IS NOT NULL)                            AS printings_with_back,
              (SELECT count(*) FROM printings
                WHERE image_back_normal IS NOT NULL AND image_back_normal <> '')  AS printings_with_back_art,
              (SELECT count(*) FROM cards c
                 JOIN printings d ON d.printing_id = c.default_printing
                WHERE d.image_back_art_crop IS NOT NULL)                          AS cards_with_back,
              (SELECT count(*) FROM cards)                                        AS cards`,
    )
    const c = counts[0]
    if (c === undefined) return 1

    const cards = Number(c.cards)
    const printings = Number(c.printings)
    const withBack = Number(c.printings_with_back)
    const withBackArt = Number(c.printings_with_back_art)
    const cardsWithBack = Number(c.cards_with_back)

    console.error(`corpus: ${cards} cards, ${printings} printings`)
    console.error(`  printings with a back face:     ${withBack}`)
    console.error(`  …of which the art resolved:     ${withBackArt}`)
    console.error(`  cards whose DEFAULT printing has a back face: ${cardsWithBack}`)
    console.error(`  (the recorded corpus count of two-faced cards is ${KNOWN_TWO_FACED_CARDS})`)

    if (cards === 0) {
      // Distinguished from "ingested and empty" so the operator is told to run
      // the ingest rather than to go looking for a mapping bug.
      fail('the corpus is EMPTY. Run the card ingest before this check.')
      return 1
    }

    if (withBack === 0) {
      fail(
        'not one printing has a back face. Either migration 0016 has been applied ' +
          'and the card ingest has not been re-run since — which is the expected ' +
          'state immediately after migrating, and the fix is to run it — or the ' +
          'mapper is not reading card_faces[1].',
      )
    }

    if (cardsWithBack < KNOWN_TWO_FACED_CARDS) {
      fail(
        `only ${cardsWithBack} cards have a back face on their default printing, ` +
          `below the ${KNOWN_TWO_FACED_CARDS} transform and modal_dfc cards the corpus ` +
          'is known to hold. Some double-faced cards did not get their back art.',
      )
    }

    if (withBack > 0 && withBackArt === 0) {
      fail(
        'every back face is present but EMPTY. The layout gate is firing and the ' +
          'URLs are not being read — check card_faces[1].image_uris in toPrinting.',
      )
    }

    console.error('named cards:')
    for (const expected of EXPECTED) {
      const { rows } = await pool.query<Row>(
        `SELECT c.name,
                d.image_back_art_crop IS NOT NULL AS has_back,
                d.image_back_normal                AS back_normal
           FROM cards c
           JOIN printings d ON d.printing_id = c.default_printing
          WHERE c.name = $1`,
        [expected.name],
      )
      // Scryfall's apostrophes vary; retry folded rather than declaring a
      // missing card when the only difference is a character.
      const row =
        rows[0] ??
        (
          await pool.query<Row>(
            `SELECT c.name,
                    d.image_back_art_crop IS NOT NULL AS has_back,
                    d.image_back_normal                AS back_normal
               FROM cards c
               JOIN printings d ON d.printing_id = c.default_printing
              WHERE replace(c.name, '''', '’') = $1`,
            [foldApostrophes(expected.name)],
          )
        ).rows[0]

      if (row === undefined) {
        // Not a failure of the feature. A corpus ingested with `--limit` will
        // not hold every named card, and saying so beats a red run that means
        // nothing.
        console.error(`  SKIP  ${expected.name} is not in this corpus`)
        continue
      }

      const has = row.has_back === true
      if (has !== expected.back) {
        fail(
          `${expected.name} ${has ? 'HAS' : 'has NO'} back face, expected ` +
            `${expected.back ? 'one' : 'none'} — ${expected.why}`,
        )
        continue
      }
      if (expected.back && (row.back_normal === null || row.back_normal === '')) {
        fail(`${expected.name} has a back face but no back art URL — ${expected.why}`)
        continue
      }
      console.error(
        `  ok    ${expected.name}: ${has ? `back art ${row.back_normal ?? ''}` : 'no back face'}`,
      )
    }

    if (failures > 0) {
      console.error(`${failures} check(s) failed.`)
      return 1
    }
    console.error('all checks passed.')
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
