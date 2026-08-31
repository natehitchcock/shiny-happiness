import { createInterface } from 'node:readline'
import { Readable } from 'node:stream'
import type { Card, CardType, Color, ManaLetter, Printing } from '@roundtable/domain'
import {
  deriveCanBeCommander,
  deriveRoles,
  deriveSynergy,
  oracleId,
  printingId,
} from '@roundtable/domain'
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
  /**
   * How the rate limiter waits. Injected so tests do not spend ten real seconds
   * proving that twenty pages are fetched twenty times.
   *
   * A test that passed a no-op here would still be testing the pacing it cares
   * about — that the limiter is CONSULTED, and with which delay — because the
   * calls it records are the evidence. Sleeping for real would only test
   * `setTimeout`.
   */
  readonly sleepImpl?: (ms: number) => Promise<void>
}

const realSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

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
  readonly produced_mana?: string[]
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
  readonly promo_types?: string[]
  readonly game_changer?: boolean
  readonly digital?: boolean
  readonly layout?: string
  readonly prices?: Record<string, string | null>
  readonly image_uris?: Record<string, string>
  readonly power?: string
  readonly toughness?: string
  readonly loyalty?: string
  readonly card_faces?: {
    mana_cost?: string | null
    oracle_text?: string
    type_line?: string
    power?: string
    toughness?: string
    loyalty?: string
    /** Present only when the faces are two PHYSICAL faces — see `faceImages`. */
    image_uris?: Record<string, string>
  }[]
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

/** One page of `/cards/search`. Scryfall pages at 175 cards. */
interface SearchPage {
  readonly total_cards?: number
  readonly has_more?: boolean
  readonly next_page?: string
  readonly data?: readonly { readonly oracle_id?: string }[]
}

/**
 * `is:commander legal:commander`, as Scryfall's own search understands it.
 *
 * `unique=cards` and not the default `unique=art`: the default returns one row
 * per printing, so a card with fourteen printings would arrive fourteen times
 * and the twenty pages would become several hundred.
 */
export const COMMANDER_QUERY = 'is:commander legal:commander'

const commanderSearchUrl = (): string =>
  `${API}/cards/search?q=${encodeURIComponent(COMMANDER_QUERY)}&unique=cards`

/**
 * A runaway guard, not a limit anyone should reach.
 *
 * The query is twenty pages today. If Scryfall ever returns a `next_page` that
 * loops, this stops rather than paging forever inside a deploy-time command —
 * and it THROWS rather than returning what it has, because a truncated set is
 * indistinguishable from a complete one at the call site and would silently
 * mark three thousand real commanders ineligible.
 */
const MAX_SEARCH_PAGES = 100

export interface CommanderSet {
  /** Scryfall oracle ids of every card that may lead a deck. */
  readonly oracleIds: ReadonlySet<string>
  /** What Scryfall said the total was, for the caller to sanity-check. */
  readonly totalCards: number | null
  readonly pages: number
}

/**
 * Every card Scryfall considers a legal commander (doc 04 §4.1, ADR-0009).
 *
 * This is the one question the bulk export cannot answer. ADR-0009 Q3 requires
 * bulk data for anything resembling a crawl — "if you need to rapidly look up
 * card names, prices, or resolve a large number of card images, you must use
 * the bulk data files" — and the corpus ingest obeys that. But no field in
 * `oracle_cards` says whether a card may lead a deck, so the alternative to
 * these twenty requests is not a cheaper request, it is guessing.
 *
 * And guessing was measurably wrong, in both directions. `deriveCanBeCommander`
 * reads the rule off the card's own text; run against this search over the
 * whole corpus it agrees on 3,380 cards and disagrees on 36. It refuses 31 real
 * commanders — every legendary Vehicle and Spacecraft, whose eligibility is
 * written on none of them — and accepts 5 cards that cannot lead a deck at all,
 * the meld backs, which are legendary creature cards Scryfall marks legal and
 * nobody may cast. That is the whole argument for asking rather than deriving.
 *
 * Twenty requests once per ingest, paced at the 2/s ADR-0009 sets for search —
 * ten seconds inside a command that already spends minutes downloading 200 MB.
 *
 * Throws on any failed page. The caller decides what to do without an answer;
 * what it must not get is a partial set that looks whole.
 */
export const fetchCommanderOracleIds = async (
  options: ScryfallOptions = {},
): Promise<CommanderSet> => {
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleepImpl ?? realSleep

  const oracleIds = new Set<string>()
  let url: string | null = commanderSearchUrl()
  let pages = 0
  let totalCards: number | null = null

  while (url !== null) {
    // Before the request, not after, and skipped for the first: the limiter
    // exists to space requests out, and there is nothing to space the first one
    // from. `delayFor` rather than a literal, so the one table of Scryfall's
    // published limits stays the only place they are written down.
    if (pages > 0) await sleep(delayFor('/cards/search'))

    const response = await doFetch(url, { headers: headers(options) })
    if (!response.ok) {
      // Includes the 404 Scryfall returns for a search that matches nothing,
      // which for this query would mean the query itself has stopped working.
      throw new Error(`Scryfall commander search responded ${response.status} on page ${pages + 1}`)
    }
    const body = (await response.json()) as SearchPage
    pages += 1
    totalCards = body.total_cards ?? totalCards

    for (const card of body.data ?? []) {
      if (card.oracle_id !== undefined) oracleIds.add(card.oracle_id)
    }

    if (pages >= MAX_SEARCH_PAGES && body.has_more === true) {
      throw new Error(`Scryfall commander search exceeded ${MAX_SEARCH_PAGES} pages`)
    }
    url = body.has_more === true ? (body.next_page ?? null) : null
  }

  return { oracleIds, totalCards, pages }
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

/**
 * Produced mana, keeping the colourless `C` that `asColors` drops.
 *
 * Scryfall reports `produced_mana: ["C"]` for a land that taps for colourless
 * only, and `["W","U","B","R","G"]` for Command Tower. Filtering `C` out would
 * make a Wastes and a land with no mana ability at all look identical, and they
 * are not: one is a mana source and the other is a spell.
 */
const asProduced = (values: readonly string[] | undefined): readonly ManaLetter[] =>
  (values ?? []).filter((c): c is ManaLetter => COLORS.has(c) || c === 'C')

const LEGALITIES = new Set(['legal', 'not_legal', 'banned', 'restricted'])

/**
 * Map a Scryfall card to the domain's `Card`.
 *
 * Returns null for records with no `oracle_id` — tokens, art series and memorabilia
 * have none, and an oracle-keyed corpus cannot hold them. The caller counts them
 * rather than discarding them silently (doc 04 §4.2).
 */
export const toCard = (
  raw: ScryfallCard,
  provenance: {
    readonly universesBeyond?: boolean
    /**
     * Scryfall's own verdict on whether this card may lead a deck.
     *
     * Passed in rather than looked up, exactly like `universesBeyond`: both are
     * facts about the whole corpus that one record cannot see, and the ingest
     * is the only thing holding the whole corpus. Absent when the search could
     * not be reached, and absence is what selects the fallback below.
     */
    readonly canBeCommander?: boolean
  } = {},
): Card | null => {
  // `skipReason` covers the same ground, but the explicit check is what narrows
  // `oracle_id` from `string | undefined` for the compiler.
  if (raw.oracle_id === undefined || skipReason(raw) !== null) return null

  const typeLine = raw.type_line ?? ''
  /*
   * Split cards, MDFCs and adventures carry their text on faces; joining keeps
   * role heuristics working on the whole card rather than an empty front.
   *
   * The faces are kept alongside the join as well, because the join throws away
   * the only thing that says where one face ends: it uses a newline, which is
   * also the separator between two abilities of one face. Reconstructing the
   * boundary from the joined string afterwards is impossible, so it is recorded
   * here at the one moment the answer is still known.
   */
  const faces =
    raw.oracle_text === undefined ? (raw.card_faces ?? []).map((f) => f.oracle_text ?? '') : []
  const oracleText = raw.oracle_text ?? faces.join('\n')

  /*
   * A double-faced card carries power on its FACES, not on the card.
   *
   * Taking `raw.power` alone would report every transforming creature as having
   * none — and "no power" is what the app renders for a non-creature, so a
   * werewolf would silently read as a sorcery. The front face is the printed
   * side, so it wins; the card-level value is the normal case.
   */
  const face = (raw.card_faces ?? [])[0]
  const power = raw.power ?? face?.power ?? null
  const toughness = raw.toughness ?? face?.toughness ?? null
  const loyalty = raw.loyalty ?? face?.loyalty ?? null

  const id = oracleId(raw.oracle_id)
  const legality = raw.legalities?.['commander'] ?? 'not_legal'
  // An unknown legality must not read as legal (the DB CHECK enforces this
  // too); anything unrecognised is treated as not legal.
  const legalities = {
    commander: (LEGALITIES.has(legality)
      ? legality
      : 'not_legal') as Card['legalities']['commander'],
  }

  const derived = deriveRoles({ oracleId: id, typeLine, oracleText })
  // Derived here, stored by the ingest: doing it per request over 34k cards
  // would not fit API-02's 200 ms budget (ADR-0011).
  // The faces go in as well as the join: a rule whose pattern spans a gap would
  // otherwise match a subject on the front face against a verb on the back,
  // which is how Tergrid's front half read as the Lantern's (ADR-0022).
  const synergy = deriveSynergy({
    oracleId: id,
    typeLine,
    oracleText,
    ...(faces.length > 1 ? { oracleTextFaces: faces } : {}),
  })

  return {
    oracleId: id,
    power,
    toughness,
    loyalty,
    name: raw.name,
    manaCost: raw.mana_cost ?? raw.card_faces?.[0]?.mana_cost ?? null,
    manaValue: raw.cmc ?? 0,
    colorIdentity: asColors(raw.color_identity),
    colors: asColors(raw.colors),
    /*
     * What the card taps for, which for a land is the whole point of it.
     *
     * `asColors` drops anything outside WUBRG, and that includes the `C`
     * Scryfall reports for colourless producers. Kept separately below rather
     * than lost: "produces only colourless" distinguishes a utility land from a
     * land with no mana ability at all, and the two deserve different scores.
     */
    producedMana: asProduced(raw.produced_mana),
    typeLine,
    types: parseTypes(typeLine),
    oracleText,
    // Spread conditionally rather than assigned `undefined`: under
    // `exactOptionalPropertyTypes` an absent key and an explicit `undefined`
    // are different types, and "single-faced" is absence.
    ...(faces.length > 1 ? { oracleTextFaces: faces } : {}),
    keywords: raw.keywords ?? [],
    legalities,
    /*
     * Whether this card may lead a deck, decided here rather than at the point
     * of use.
     *
     * Stored at ingest like `roles` and `synergyProduces`, and for the same
     * reason: deck creation, the analysis endpoint and `is:commander` all need
     * the answer, and re-reading 34k type lines per request does not fit
     * API-02's 200 ms budget.
     *
     * TWO sources, in order of authority, and which one answered is recorded on
     * `IngestReport.commanderEligibility` rather than left for a reader to
     * infer:
     *
     *   1. Scryfall's `is:commander`, fetched once per ingest and passed in.
     *      It is the authority, and the only thing that knows a legendary
     *      Vehicle may lead a deck.
     *   2. `deriveCanBeCommander`, reading the rule off the card's own text.
     *      Agrees with the search on 3,380 cards, and is the answer whenever
     *      the search cannot be reached — an ingest that shipped no eligibility
     *      at all would leave the API unable to reject Sol Ring again.
     *
     * `??` and not `||`: a fetched `false` is an answer and must not fall
     * through to the derivation, which would put the two back in disagreement
     * on exactly the 36 cards this fetch exists for — including the five meld
     * backs, where the fetched answer is `false` and the derived one is `true`.
     */
    canBeCommander:
      provenance.canBeCommander ?? deriveCanBeCommander({ typeLine, oracleText, legalities }),
    edhrecRank: raw.edhrec_rank ?? null,
    defaultPrinting: printingId(raw.id),
    roles: derived.roles,
    primaryRole: derived.primary,
    // Cannot be decided from one printing (ADR-0011); the ingest computes it
    // across all of them and passes it in. Defaulting to false is the safe
    // direction: an unknown card stays visible rather than silently vanishing.
    universesBeyond: provenance.universesBeyond ?? false,
    synergyProduces: synergy.produces,
    synergyWants: synergy.wants,
    /*
     * Wizards' Game Changers list, carried on the card record we already
     * download (DATA-05).
     *
     * Scryfall writes `game_changer: false` explicitly on cards that are not on
     * the list (checked against Llanowar Elves on 2026-08-30), so the `?? false`
     * is only for an older mirror predating the field — not the normal path.
     *
     * Unlike `universesBeyond` this needs no fold across printings: the list
     * names cards, so the flag is oracle-level and one record answers it.
     */
    gameChanger: raw.game_changer ?? false,
  }
}

/** True when this printing is a Universes Beyond printing. */
export const isUniversesBeyondPrinting = (raw: ScryfallCard): boolean =>
  (raw.promo_types ?? []).includes('universesbeyond')

/**
 * Fold every printing of every card into "is this card Universes Beyond".
 *
 * A card qualifies only when EVERY printing carries the flag. Sol Ring has
 * ordinary printings and survives; `Bill the Pony` has only Universes Beyond
 * printings and does not.
 */
export interface ProvenanceTally {
  total: number
  universesBeyond: number
}

export const tallyPrinting = (into: Map<string, ProvenanceTally>, raw: ScryfallCard): void => {
  if (raw.oracle_id === undefined) return
  const entry = into.get(raw.oracle_id) ?? { total: 0, universesBeyond: 0 }
  entry.total += 1
  if (isUniversesBeyondPrinting(raw)) entry.universesBeyond += 1
  into.set(raw.oracle_id, entry)
}

export const isUniversesBeyondCard = (tally: ProvenanceTally | undefined): boolean =>
  tally !== undefined && tally.total > 0 && tally.total === tally.universesBeyond

/**
 * Where a printing's art lives, which depends on how many PHYSICAL faces it has.
 *
 * Scryfall puts `image_uris` on the card object for anything printed on one
 * physical face — ordinary cards, and also split, adventure and flip cards,
 * which are one face carrying two halves. `transform` and `modal_dfc` cards
 * have two physical faces, so there is no single image OF THE CARD and the URLs
 * live on `card_faces[]` instead. Reading only the top level is why 501 of the
 * corpus's 890 `//` cards had no art at all on their default printing; checked
 * on 2026-08-31 against the raw Scryfall record for every one of them, all 501
 * are `transform` (401) or `modal_dfc` (100), none has a card-level
 * `image_uris`, and all 501 carry both `normal` and `art_crop` on face 0.
 *
 * `Fire // Ice` is the contrast that fixes the shape of this: a split card DOES
 * have top-level art, so a blanket "read the face" would have broken the cards
 * that were already right.
 *
 * The `??` order is defensive rather than load-bearing, and no test pins it,
 * because the two are mutually exclusive in Scryfall's data: checked across
 * every layout with faces on 2026-08-31, `reversible_card`, `transform` and
 * `modal_dfc` put images ONLY on the faces, while `split`, `adventure`, `flip`,
 * `meld`, `mutate`, `prototype` and `case` put them ONLY on the card. Reversing
 * the two operands is an equivalent mutant; a test asserting a preference
 * between them would be asserting a case real data never produces.
 *
 * The FRONT face is the card. It is the side that enters the battlefield, the
 * side Scryfall sorts and names the card by, and the side `default_printing`
 * means when a caller asks "which card is this" — so it is what a tile, a
 * detail panel and a deck-web art crop must draw.
 *
 * The BACK face's art is deliberately NOT carried. `Card.oracleTextFaces` is
 * the precedent for per-face data, but it earned its place: `OracleText` draws
 * both faces' rules, so there is a reader. Nothing reads a back image —
 * `imageFor(card, level)` picks one asset from a single `{artCrop, normal}`
 * pair and there is no flip affordance anywhere in the UI. Adding it would cost
 * two `Printing` fields, two columns and a migration, a wire-contract change on
 * `/cards/batch`, and would feed nobody. It belongs with the flip control, not
 * before it.
 */
const faceImages = (raw: ScryfallCard): Record<string, string> | undefined =>
  raw.image_uris ?? raw.card_faces?.[0]?.image_uris

/** The printing carried alongside an oracle record. Prices are estimates only. */
export const toPrinting = (raw: ScryfallCard): Printing | null => {
  if (raw.oracle_id === undefined || skipReason(raw) !== null) return null
  const usd = raw.prices?.['usd']
  const images = faceImages(raw)
  return {
    printingId: printingId(raw.id),
    oracleId: oracleId(raw.oracle_id),
    setCode: raw.set ?? '',
    setName: raw.set_name ?? '',
    collectorNumber: raw.collector_number ?? '',
    rarity: (raw.rarity ?? 'common') as Printing['rarity'],
    imageUris: {
      artCrop: images?.['art_crop'] ?? '',
      normal: images?.['normal'] ?? '',
    },
    // "Dangerously stale after 24 hours … consume at your own risk" (ADR-0009
    // Q7). Estimates only; never presented as a purchase price.
    priceUsd: usd === undefined || usd === null ? null : Number(usd),
    reserved: raw.reserved ?? false,
  }
}
