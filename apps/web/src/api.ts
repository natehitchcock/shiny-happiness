/**
 * The API seam (doc 10).
 *
 * Relative paths throughout: Vite proxies `/api` in development and the API is
 * same-origin in production, so no base URL is ever configured in the client.
 */

export interface Card {
  oracleId: string
  name: string
  manaCost: string | null
  manaValue: number
  typeLine: string
  types: string[]
  oracleText: string
  /** Printed values, as text — Magic prints `*` and `1+*`. */
  power: string | null
  toughness: string | null
  loyalty: string | null
  colorIdentity: string[]
  primaryRole: string
  edhrecRank: number | null
  universesBeyond: boolean
  /**
   * The events this card causes and pays off (ADR-0011).
   *
   * Already on the wire — the detail route spreads the whole domain card — the
   * client type simply never declared them.
   */
  synergyProduces: string[]
  synergyWants: string[]
}

export interface CardDetail extends Card {
  printings: {
    printingId: string
    setCode: string
    setName: string
    rarity: string
    priceUsd: number | null
  }[]
  /**
   * Pieces carry their names so the preview can name a combo piece that is not
   * in the deck — which is the piece worth naming.
   */
  combos: {
    id: string
    pieces: { oracleId: string; name: string | null }[]
    produces: string[]
  }[]
}

export interface Reason {
  kind: string
  combos?: string[]
  distance?: number
  dimension?: { role?: string; type?: string }
  deficit?: number
  manaValue?: number
  direction?: 'short' | 'over' | 'balanced' | 'enables' | 'payoff' | 'theme'
  delta?: number
  tag?: string
  withOracleIds?: string[]
}

export interface Recommendation {
  oracleId: string
  score: number
  comboDegree: number
  nearCombosAt1: number
  completedCombos: string[]
  /**
   * The completed combos, expanded.
   *
   * `completedCombos` counts; this reads. Pieces are oracle ids, and every
   * piece of a COMPLETED combo is already in the deck, so the client names them
   * from its own hydrated cards without another request.
   */
  combos: { id: string; pieces: string[]; produces: string[] }[]
  reasons: Reason[]
}

export interface Group {
  key: string
  label: string
  rationale: string
  total: number
  items: Recommendation[]
}

export interface Deck {
  id: string
  name: string
  description: string
  commanders: string[]
  colorIdentity: string[]
  targetBracket: number
  archetype: string
  version: number
  excludeUniversesBeyond: boolean
  budget: { maxTotalUsd: number | null; maxCardUsd: number | null } | null
  entries: { oracleId: string; zone: 'accepted' | 'excluded'; locked: boolean }[]
}

export interface Unavailable {
  key: string
  reason: string
}

/**
 * This browser's id, generated once and kept in localStorage (ADR-0014).
 *
 * It is what a deck belongs to. There is no account and nothing to sign in to —
 * the fastest path to a usable tool is not asking anyone to register — and this
 * is the whole of that mechanism.
 *
 * It is NOT a credential. Anyone holding it can read this device's decks, which
 * is acceptable for a deck list and would not be for anything else. Clearing
 * site data loses it, and with it every deck on this device; export is the
 * backup, which is why it sits in the masthead rather than in a menu.
 */
export const deviceId = ((): string => {
  const stored = localStorage.getItem('lw.deviceId')
  if (stored !== null && stored !== '') return stored
  const fresh = crypto.randomUUID()
  localStorage.setItem('lw.deviceId', fresh)
  return fresh
})()

/**
 * An HTTP failure that still knows which one it was.
 *
 * A 409 is not an error in the usual sense — it means "your view of the deck is
 * behind", which is recoverable and must be handled differently from a 500.
 * Flattening every failure to a message string made that impossible to tell.
 */
export class ApiError extends Error {
  readonly status: number
  constructor(message: string, status: number) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      'x-device-id': deviceId,
      ...(init?.headers ?? {}),
    },
  })
  if (!response.ok) {
    // Errors are RFC 9457 problem+json (doc 10 §10.1); surface `detail`, which
    // is the part written for a person.
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new ApiError(
      problem?.detail ?? `Request failed (${String(response.status)})`,
      response.status,
    )
  }
  return (await response.json()) as T
}

export const searchCards = (
  q: string,
  options: { limit?: number; excludeUniversesBeyond?: boolean } = {},
): Promise<{ items: Card[] }> =>
  request(
    `/cards/search?q=${encodeURIComponent(q)}&limit=${String(options.limit ?? 12)}` +
      (options.excludeUniversesBeyond === true ? '&excludeUniversesBeyond=true' : ''),
  )

export interface Hydrated {
  cards: Map<string, Card>
  /** Cheapest printing, in USD. An estimate — see `PriceNote`. */
  prices: Map<string, number | null>
}

export const hydrate = async (oracleIds: string[]): Promise<Hydrated> => {
  if (oracleIds.length === 0) return { cards: new Map(), prices: new Map() }
  const body = await request<{ items: Card[]; prices: Record<string, number | null> }>(
    '/cards/batch',
    {
      method: 'POST',
      body: JSON.stringify({ oracleIds: [...new Set(oracleIds)].slice(0, 500) }),
    },
  )
  return {
    cards: new Map(body.items.map((c) => [c.oracleId, c])),
    prices: new Map(Object.entries(body.prices)),
  }
}

export const basicLands = (deckId: string): Promise<{ items: Card[] }> =>
  request(`/decks/${deckId}/basic-lands`)

export interface ImportPreview {
  resolved: { oracleId: string; name: string; quantity: number }[]
  unresolved: { name: string; reason: string }[]
  problems: { line: number; text: string; reason: string }[]
}

export const importPreview = (deckId: string, text: string): Promise<ImportPreview> =>
  request(`/decks/${deckId}/import/preview`, { method: 'POST', body: JSON.stringify({ text }) })

export const getCardDetail = (oracleId: string): Promise<CardDetail> =>
  request(`/cards/${oracleId}`)

export const createDeck = (body: {
  name: string
  description?: string
  commanders: string[]
  targetBracket: number
  archetype: string
  excludeUniversesBeyond?: boolean
}): Promise<Deck> => request('/decks', { method: 'POST', body: JSON.stringify(body) })

export const patchDeck = (
  id: string,
  body: {
    name?: string
    description?: string
    excludeUniversesBeyond?: boolean
    budget?: { maxTotalUsd: number | null; maxCardUsd: number | null } | null
  },
): Promise<Deck> => request(`/decks/${id}`, { method: 'PATCH', body: JSON.stringify(body) })

export const getDeck = (id: string): Promise<Deck> => request(`/decks/${id}`)

/** A deck as the switcher shows it — never its entries (doc 12 §12.2). */
export interface DeckSummary {
  id: string
  name: string
  description: string
  commanders: string[]
  targetBracket: number
  archetype: string
  colorIdentity: string[]
  cardCount: number
  status: string
  updatedAt: string
  lastOpenedAt: string
}

export const listDecks = (): Promise<{ items: DeckSummary[] }> => request('/decks')

export interface CommandResult {
  deck: Deck
  applied: unknown[]
  rejected: { command: { type: string; oracleId?: string }; reason: { kind: string } }[]
}

export const sendCommands = (
  id: string,
  commands: unknown[],
  baseVersion: number,
): Promise<CommandResult> =>
  request(`/decks/${id}/commands`, {
    method: 'POST',
    body: JSON.stringify({
      commands,
      baseVersion,
      // Every mutation is idempotent so a retry cannot double-apply (doc 10 §10.1).
      idempotencyKey: crypto.randomUUID(),
    }),
  })

export interface Recommendations {
  datasetSnapshotId: string | null
  groups: Group[]
  columns: { query: string; matched: string[]; error?: string }[]
  unavailable: Unavailable[]
  query: { matched: number; total: number; errors: { message: string; position: number }[] }
}

export const getRecommendations = (
  id: string,
  body: { limitPerGroup?: number; query?: string; columns?: readonly string[] },
): Promise<Recommendations> =>
  request(`/decks/${id}/recommendations`, { method: 'POST', body: JSON.stringify(body) })

export interface Analysis {
  counts: { total: number; byRole: Record<string, number> }
  targets: {
    dimension: { role?: string; type?: string }
    ideal: number
    min: number
    max: number
    locked: number
    actual: number
  }[]
  cuts: {
    oracleId: string
    score: number
    reasons: {
      kind: string
      dimension?: { role?: string; type?: string }
      over?: number
      manaValue?: number
      priceUsd?: number
      limit?: number
    }[]
  }[]
  deficits: { dimension: { role?: string; type?: string }; delta: number }[]
  archetype: { declared: string; assessed: string; confidence: number }
  curve: {
    averageManaValue: number
    histogram: number[]
    target: { ideal: number; min: number; max: number }[]
    locked: number[]
    deltas: {
      bucket: number
      actual: number
      ideal: number
      min: number
      max: number
      delta: number
      withinRange: boolean
    }[]
  }
  legality: { legal: boolean; problems: { kind: string; oracleId?: string }[] }
  deckCombos: { comboId: string; pieces: string[]; produces: string[] }[]
  prices: {
    deckTotalUsd: number
    pricedCards: number
    unpricedCards: number
    budget: { maxTotalUsd: number | null; maxCardUsd: number | null } | null
  }
  unavailable: Unavailable[]
}

export const getAnalysis = (id: string): Promise<Analysis> => request(`/decks/${id}/analysis`)
