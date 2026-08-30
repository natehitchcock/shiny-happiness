import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import type { Card, CardType, Color, Printing } from '@roundtable/domain'
import { deriveRoles, oracleId, printingId } from '@roundtable/domain'
import { textStreamOf } from './http.js'

/**
 * Scryfall adapter (doc 04 §4.1, ADR-0009).
 *
 * All third-party network access lives here (AGENTS.md R3). Nothing else in the
 * monorepo may `fetch` Scryfall — the lint rule enforces it.
 */

const API = 'https://api.scryfall.com'

/**
 * Per-endpoint, not one global bucket (ADR-0009 Q1).
 *
 * Scryfall publishes different limits per method — search is 2/s while most
 * methods are 10/s — and the bulk file origins on `*.scryfall.io` have no limit
 * at all. A single shared bucket would either throttle the 24 MB download to
 * search speed or hammer search at ten times its allowance.
 */
export const RATE_LIMITS_MS: Readonly<Record<string, number>> = {
  '/cards/search': 500,
  '/cards/named': 500,
  '/cards/random': 500,
  '/cards/collection': 500,
  '/cards/manifest': 6_000,
  default: 100,
  // data.scryfall.io / cards.scryfall.io — "do not have rate limits".
  files: 0,
}

export const delayFor = (path: string): number => RATE_LIMITS_MS[path] ?? RATE_LIMITS_MS['default']!

/**
 * Required by Scryfall, and it must identify this app (ADR-0009 Q2): "Do not
 * allow HTTP libraries to choose the header for you."
 */
export interface ScryfallOptions {
  readonly userAgent?: string
  readonly fetchImpl?: typeof fetch
}

const headers = (options: ScryfallOptions): Record<string, string> => ({
  'User-Agent': options.userAgent ?? 'Roundtable/0.1',
  Accept: 'application/json;q=0.9,*/*;q=0.8',
})

export interface BulkDataEntry {
  readonly type: string
  readonly updatedAt: string
  readonly compressedSize: number
  readonly downloadUri: string
}

/**
 * Locate a bulk export.
 *
 * Bulk is not merely permitted, it is required: "If you need to rapidly look up
 * card names, prices, or resolve a large number of card images, you must use the
 * bulk data files" (ADR-0009 Q3). Crawling `/cards/*` to build a corpus is
 * against the documented instruction, not just impolite.
 */
export const bulkDataEntry = async (
  type = 'oracle_cards',
  options: ScryfallOptions = {},
): Promise<BulkDataEntry> => {
  const doFetch = options.fetchImpl ?? fetch
  const response = await doFetch(`${API}/bulk-data/${type}`, { headers: headers(options) })
  if (!response.ok) {
    throw new Error(`Scryfall bulk-data/${type} responded ${response.status}`)
  }
  const body = (await response.json()) as {
    type: string
    updated_at: string
    compressed_size: number
    // The feed moved from a JSON array (`download_uri`) to newline-delimited
    // JSON. Both are read so an older mirror still works.
    jsonl_download_uri?: string
    download_uri?: string
  }
  const uri = body.jsonl_download_uri ?? body.download_uri
  if (uri === undefined) throw new Error(`Scryfall bulk-data/${type} has no download URI`)

  return {
    type: body.type,
    updatedAt: body.updated_at,
    compressedSize: body.compressed_size,
    downloadUri: uri,
  }
}

/** One raw Scryfall card, narrowed to the fields this project maps. */
export interface ScryfallCard {
  readonly oracle_id?: string
  readonly id: string
  readonly name: string
  readonly mana_cost?: string | null
  readonly cmc?: number
  readonly color_identity?: string[]
  readonly colors?: string[]
  readonly type_line?: string
  readonly oracle_text?: string
  readonly keywords?: string[]
  readonly legalities?: Record<string, string>
  readonly edhrec_rank?: number | null
  readonly set?: string
  readonly set_name?: string
  readonly collector_number?: string
  readonly rarity?: string
  readonly reserved?: boolean
  readonly game_changer?: boolean
  readonly digital?: boolean
  readonly layout?: string
  readonly prices?: Record<string, string | null>
  readonly image_uris?: Record<string, string>
  readonly card_faces?: { mana_cost?: string | null; oracle_text?: string; type_line?: string }[]
}

/**
 * Stream a gzipped JSONL export line by line.
 *
 * Streamed rather than buffered: the file is ~24 MB compressed and several
 * hundred uncompressed, and Scryfall's own docs warn against loading it whole.
 * A generator also lets the caller batch writes without holding 38k objects.
 */
export async function* streamBulkCards(
  entry: BulkDataEntry,
  options: ScryfallOptions = {},
): AsyncGenerator<ScryfallCard> {
  const doFetch = options.fetchImpl ?? fetch
  const response = await doFetch(entry.downloadUri, { headers: headers(options) })
  if (!response.ok || response.body === null) {
    throw new Error(`Scryfall bulk download responded ${response.status}`)
  }

  const lines = createInterface({
    input: Readable.from(textStreamOf(response)),
    crlfDelay: Infinity,
  })

  for await (const line of lines) {
    const trimmed = line.trim()
    // The legacy JSON-array export brackets and comma-separates its records.
    if (trimmed === '' || trimmed === '[' || trimmed === ']') continue
    const cleaned = trimmed.endsWith(',') ? trimmed.slice(0, -1) : trimmed
    yield JSON.parse(cleaned) as ScryfallCard
  }
}

const TYPE_WORDS: Readonly<Record<string, CardType>> = {
  creature: 'creature',
  instant: 'instant',
  sorcery: 'sorcery',
  artifact: 'artifact',
  enchantment: 'enchantment',
  planeswalker: 'planeswalker',
  battle: 'battle',
  land: 'land',
  // Pre-6th-edition wording. "Summon Dragon" is a creature and there are a
  // dozen of them still legal in Commander.
  summon: 'creature',
}

/**
 * Card types from the type line.
 *
 * Only the part before the em dash is the type line proper — everything after is
 * subtypes, and "Creature — Elf Druid" must not yield a type from "Druid". Both
 * dash forms appear in real data.
 */
export const parseTypes = (typeLine: string): readonly CardType[] => {
  const front = typeLine.split(/[—–-]/)[0] ?? typeLine
  const found = new Set<CardType>()
  for (const word of front.toLowerCase().split(/\s+/)) {
    const type = TYPE_WORDS[word]
    if (type !== undefined) found.add(type)
  }
  return [...found]
}

/**
 * Layouts that are not playable cards.
 *
 * The oracle export is not purely playable cards: art series entries carry an
 * `oracle_id` and a type line of "Card", so they map to a typed-as-nothing
 * "card" that pollutes name search and composition counting. Tokens and emblems
 * are the same shape of problem. Found by mapping the real bulk file — a
 * hand-written mock would never have shown it (AGENTS.md §4).
 */
const NON_PLAYABLE_LAYOUTS: ReadonlySet<string> = new Set([
  'art_series',
  'token',
  'double_faced_token',
  'emblem',
  'memorabilia',
  'vanguard',
  'scheme',
  'planar',
])

export type SkipReason = 'no-oracle-id' | 'non-playable-layout' | 'no-card-type'

/**
 * Why a bulk record is not a card, or null if it is one.
 *
 * The last rule is the general one: `CardType` is the domain's definition of
 * what can be in a deck, so a type line yielding none of them is not a deck
 * card. That catches Stickers, Conspiracies, Heroes, Dungeons and bare "Card"
 * without needing to enumerate every supplementary product Wizards invents next.
 * Scryfall marks the 49 Unfinity sticker sheets `legal` in Commander, so
 * filtering on legality alone would have let them into the candidate pool.
 */
export const skipReason = (raw: ScryfallCard): SkipReason | null => {
  if (raw.oracle_id === undefined) return 'no-oracle-id'
  if (raw.layout !== undefined && NON_PLAYABLE_LAYOUTS.has(raw.layout)) {
    return 'non-playable-layout'
  }
  if (parseTypes(raw.type_line ?? '').length === 0) return 'no-card-type'
  return null
}

const COLORS = new Set(['W', 'U', 'B', 'R', 'G'])
const asColors = (values: readonly string[] | undefined): readonly Color[] =>
  (values ?? []).filter((c): c is Color => COLORS.has(c))

const LEGALITIES = new Set(['legal', 'not_legal', 'banned', 'restricted'])

/**
 * Map a Scryfall card to the domain's `Card`.
 *
 * Returns null for records with no `oracle_id` — tokens, art series and memorabilia
 * have none, and an oracle-keyed corpus cannot hold them. The caller counts them
 * rather than discarding them silently (doc 04 §4.2).
 */
export const toCard = (raw: ScryfallCard): Card | null => {
  // `skipReason` covers the same ground, but the explicit check is what narrows
  // `oracle_id` from `string | undefined` for the compiler.
  if (raw.oracle_id === undefined || skipReason(raw) !== null) return null

  const typeLine = raw.type_line ?? ''
  // Split cards and MDFCs carry their text on faces; joining keeps role
  // heuristics working on the whole card rather than an empty front.
  const oracleText =
    raw.oracle_text ?? (raw.card_faces ?? []).map((f) => f.oracle_text ?? '').join('\n') ?? ''

  const id = oracleId(raw.oracle_id)
  const legality = raw.legalities?.['commander'] ?? 'not_legal'

  const derived = deriveRoles({ oracleId: id, typeLine, oracleText })

  return {
    oracleId: id,
    name: raw.name,
    manaCost: raw.mana_cost ?? raw.card_faces?.[0]?.mana_cost ?? null,
    manaValue: raw.cmc ?? 0,
    colorIdentity: asColors(raw.color_identity),
    colors: asColors(raw.colors),
    typeLine,
    types: parseTypes(typeLine),
    oracleText,
    keywords: raw.keywords ?? [],
    // An unknown legality must not read as legal (the DB CHECK enforces this
    // too); anything unrecognised is treated as not legal.
    legalities: {
      commander: (LEGALITIES.has(legality)
        ? legality
        : 'not_legal') as Card['legalities']['commander'],
    },
    edhrecRank: raw.edhrec_rank ?? null,
    defaultPrinting: printingId(raw.id),
    roles: derived.roles,
    primaryRole: derived.primary,
  }
}

/** The printing carried alongside an oracle record. Prices are estimates only. */
export const toPrinting = (raw: ScryfallCard): Printing | null => {
  if (raw.oracle_id === undefined || skipReason(raw) !== null) return null
  const usd = raw.prices?.['usd']
  return {
    printingId: printingId(raw.id),
    oracleId: oracleId(raw.oracle_id),
    setCode: raw.set ?? '',
    setName: raw.set_name ?? '',
    collectorNumber: raw.collector_number ?? '',
    rarity: (raw.rarity ?? 'common') as Printing['rarity'],
    imageUris: {
      artCrop: raw.image_uris?.['art_crop'] ?? '',
      normal: raw.image_uris?.['normal'] ?? '',
    },
    // "Dangerously stale after 24 hours … consume at your own risk" (ADR-0009
    // Q7). Estimates only; never presented as a purchase price.
    priceUsd: usd === undefined || usd === null ? null : Number(usd),
    reserved: raw.reserved ?? false,
  }
}
