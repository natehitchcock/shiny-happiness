import type { OracleId, Printing, PrintingId } from '@roundtable/domain'
import type { Pool } from 'pg'

interface PrintingRow {
  readonly printing_id: string
  readonly oracle_id: string
  readonly set_code: string
  readonly set_name: string
  readonly collector_number: string
  readonly rarity: string
  readonly image_art_crop: string | null
  readonly image_normal: string | null
  readonly price_usd: string | null
  readonly reserved: boolean
}

const toPrinting = (row: PrintingRow): Printing => ({
  printingId: row.printing_id as PrintingId,
  oracleId: row.oracle_id as OracleId,
  setCode: row.set_code,
  setName: row.set_name,
  collectorNumber: row.collector_number,
  rarity: row.rarity as Printing['rarity'],
  imageUris: {
    // Empty string, not null: the column is nullable until ING-04 populates the
    // cache, and the client's type says these are strings.
    artCrop: row.image_art_crop ?? '',
    normal: row.image_normal ?? '',
  },
  // numeric(10,2) arrives as a string from pg; Number() it once, here, rather
  // than leaving every caller to remember.
  priceUsd: row.price_usd === null ? null : Number(row.price_usd),
  reserved: row.reserved,
})

export const printingsFor = async (pool: Pool, oracleId: OracleId): Promise<Printing[]> => {
  const { rows } = await pool.query<PrintingRow>(
    'SELECT * FROM printings WHERE oracle_id = $1 ORDER BY set_code, collector_number',
    [oracleId],
  )
  return rows.map(toPrinting)
}

/** See `upsertCards` for why this is jsonb rather than unnest. */
export const upsertPrintings = async (
  pool: Pool,
  printings: readonly Printing[],
): Promise<number> => {
  if (printings.length === 0) return 0

  // `ON CONFLICT DO UPDATE` cannot touch the same row twice in one statement.
  const deduped = [...new Map(printings.map((p) => [p.printingId, p])).values()]

  const payload = deduped.map((p) => ({
    printing_id: p.printingId,
    oracle_id: p.oracleId,
    set_code: p.setCode,
    set_name: p.setName,
    collector_number: p.collectorNumber,
    rarity: p.rarity,
    image_art_crop: p.imageUris.artCrop === '' ? null : p.imageUris.artCrop,
    image_normal: p.imageUris.normal === '' ? null : p.imageUris.normal,
    price_usd: p.priceUsd,
    reserved: p.reserved,
  }))

  const { rowCount } = await pool.query(
    `INSERT INTO printings (printing_id, oracle_id, set_code, set_name, collector_number,
                            rarity, image_art_crop, image_normal, price_usd, reserved)
     SELECT printing_id, oracle_id, set_code, set_name, collector_number,
            rarity, image_art_crop, image_normal, price_usd, reserved
       FROM jsonb_to_recordset($1::jsonb) AS x(
         printing_id uuid, oracle_id uuid, set_code text, set_name text,
         collector_number text, rarity text, image_art_crop text, image_normal text,
         price_usd numeric(10,2), reserved boolean)
     ON CONFLICT (printing_id) DO UPDATE SET
       oracle_id = EXCLUDED.oracle_id, set_code = EXCLUDED.set_code,
       set_name = EXCLUDED.set_name, collector_number = EXCLUDED.collector_number,
       rarity = EXCLUDED.rarity, image_art_crop = EXCLUDED.image_art_crop,
       image_normal = EXCLUDED.image_normal, price_usd = EXCLUDED.price_usd,
       reserved = EXCLUDED.reserved`,
    [JSON.stringify(payload)],
  )
  return rowCount ?? 0
}

export interface PrintingFacts {
  readonly priceUsd: number | null
  readonly rarity: string | null
  readonly setCode: string | null
  readonly reserved: boolean
  /**
   * Art for this card, from its **default** printing — not from the cheapest
   * one the fields above describe.
   *
   * Two different printings in one record needs saying out loud, so: price,
   * rarity, set and reserved answer "how do I get this card", and the cheapest
   * printing is the honest answer to that. The image answers "which card is
   * this", and the honest answer there is the printing Scryfall itself would
   * show — `cards.default_printing`. They disagree for 10,042 of the corpus's
   * 34,492 cards, so picking one for both would be wrong about a third of them
   * in one direction or the other.
   *
   * `null` means no art. That was 501 cards until the double-faced art fix in
   * `packages/clients/src/scryfall.ts` — every one of them a `transform` or
   * `modal_dfc` card whose images the mapper read from the wrong place, not a
   * card Scryfall has no picture of — and the next ingest takes it to none. The
   * choice of printing was never what cost the reach: coverage was 33,991
   * either way. The null stays because an unresolved printing is a real state,
   * and the UI primitives draw a readable text panel for it rather than a
   * broken image.
   */
  readonly imageUris: {
    readonly artCrop: string | null
    readonly normal: string | null
  }
}

/**
 * Absent art as `null`, whichever way the row spells it.
 *
 * `upsertPrintings` writes `null` for "no image", but `toPrinting` reads it back
 * out as `''` because `Printing.imageUris` is typed as strings — so an empty
 * string is a spelling of absence that could reach this table from a caller
 * round-tripping a printing. It has to collapse to `null` here: an `''` handed
 * to the client becomes `<img src="">`, which resolves to the page URL and
 * renders a broken image where the no-art fallback should have drawn a name.
 */
const imageUrl = (raw: string | null): string | null => (raw === null || raw === '' ? null : raw)

/**
 * The printing-level facts the candidate pool needs, one row per card.
 *
 * The CHEAPEST printing is the one that matters for a budget: a card is
 * affordable if any printing of it is, and judging Sol Ring by its most
 * expensive printing would price it out of every deck. `reserved` is a property
 * of the card rather than the printing, so it is OR-ed across all of them.
 *
 * One aggregate query rather than a lookup per card — hydrating printings for
 * 30k candidates individually is the shape that only hurts at real volume.
 *
 * The image join is what makes this query cost what it costs: measured against
 * the real corpus it takes the result from 4.28 MB to 12.05 MB and 149 ms to
 * 201 ms. That is paid ONCE PER SNAPSHOT, because `cachedPrintingFacts` holds
 * the map for as long as the corpus is unchanged (see `apps/api/corpus-cache`).
 * The alternative considered and rejected was fetching art per request for the
 * ≤500 ids `/cards/batch` asks about: a smaller read, but a recurring one on a
 * route the client calls at least twice per user action, and a second
 * per-request database read on a metered database is the shape that took the
 * deployment down before.
 */
export const printingFactsForAll = async (pool: Pool): Promise<Map<OracleId, PrintingFacts>> => {
  const { rows } = await pool.query<{
    oracle_id: string
    price_usd: string | null
    rarity: string | null
    set_code: string | null
    reserved: boolean
    image_art_crop: string | null
    image_normal: string | null
  }>(
    // The CTE is the query this used to be, unchanged, so the price/rarity/set
    // answers cannot have moved. Both joins are LEFT so the row set stays
    // exactly "one row per card that has a printing" — an inner join to `cards`
    // would be equivalent today only because of the foreign key, and a row
    // silently vanishing from this map is a card that reads as unpriced.
    `WITH cheapest AS (
       SELECT DISTINCT ON (oracle_id)
              oracle_id,
              min(price_usd) OVER (PARTITION BY oracle_id) AS price_usd,
              bool_or(reserved) OVER (PARTITION BY oracle_id) AS reserved,
              rarity, set_code
         FROM printings
        ORDER BY oracle_id, price_usd NULLS LAST
     )
     SELECT ch.oracle_id, ch.price_usd, ch.reserved, ch.rarity, ch.set_code,
            d.image_art_crop, d.image_normal
       FROM cheapest ch
       LEFT JOIN cards c ON c.oracle_id = ch.oracle_id
       LEFT JOIN printings d ON d.printing_id = c.default_printing`,
  )
  return new Map(
    rows.map((r) => [
      r.oracle_id as OracleId,
      {
        priceUsd: r.price_usd === null ? null : Number(r.price_usd),
        rarity: r.rarity,
        setCode: r.set_code,
        reserved: r.reserved,
        imageUris: {
          artCrop: imageUrl(r.image_art_crop),
          normal: imageUrl(r.image_normal),
        },
      },
    ]),
  )
}
