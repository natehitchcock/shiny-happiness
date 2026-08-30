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
