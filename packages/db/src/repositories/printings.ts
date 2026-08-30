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
