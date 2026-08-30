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
  colorIdentity: string[]
  primaryRole: string
  edhrecRank: number | null
}

export interface Reason {
  kind: string
  combos?: string[]
  distance?: number
  dimension?: { role?: string; type?: string }
  deficit?: number
  manaValue?: number
}

export interface Recommendation {
  oracleId: string
  score: number
  comboDegree: number
  nearCombosAt1: number
  completedCombos: string[]
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
  commanders: string[]
  colorIdentity: string[]
  targetBracket: number
  archetype: string
  version: number
  entries: { oracleId: string; zone: 'accepted' | 'excluded'; locked: boolean }[]
}

export interface Unavailable {
  key: string
  reason: string
}

const request = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  if (!response.ok) {
    // Errors are RFC 9457 problem+json (doc 10 §10.1); surface `detail`, which
    // is the part written for a person.
    const problem = (await response.json().catch(() => null)) as { detail?: string } | null
    throw new Error(problem?.detail ?? `Request failed (${String(response.status)})`)
  }
  return (await response.json()) as T
}

export const searchCards = (q: string, limit = 12): Promise<{ items: Card[] }> =>
  request(`/cards/search?q=${encodeURIComponent(q)}&limit=${String(limit)}`)

export const hydrate = async (oracleIds: string[]): Promise<Map<string, Card>> => {
  if (oracleIds.length === 0) return new Map()
  const { items } = await request<{ items: Card[] }>('/cards/batch', {
    method: 'POST',
    body: JSON.stringify({ oracleIds: [...new Set(oracleIds)].slice(0, 500) }),
  })
  return new Map(items.map((c) => [c.oracleId, c]))
}

export const createDeck = (body: {
  name: string
  commanders: string[]
  targetBracket: number
  archetype: string
}): Promise<Deck> => request('/decks', { method: 'POST', body: JSON.stringify(body) })

export const getDeck = (id: string): Promise<Deck> => request(`/decks/${id}`)

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
  unavailable: Unavailable[]
  query: { matched: number; total: number; errors: { message: string; position: number }[] }
}

export const getRecommendations = (
  id: string,
  body: { limitPerGroup?: number; query?: string },
): Promise<Recommendations> =>
  request(`/decks/${id}/recommendations`, { method: 'POST', body: JSON.stringify(body) })

export interface Analysis {
  counts: { total: number; byRole: Record<string, number> }
  targets: {
    dimension: { role?: string; type?: string }
    ideal: number
    min: number
    max: number
  }[]
  deficits: { dimension: { role?: string; type?: string }; delta: number }[]
  archetype: { declared: string; assessed: string; confidence: number }
  curve: { averageManaValue: number }
  legality: { legal: boolean; problems: { kind: string; oracleId?: string }[] }
  deckCombos: { comboId: string; pieces: string[]; produces: string[] }[]
  unavailable: Unavailable[]
}

export const getAnalysis = (id: string): Promise<Analysis> => request(`/decks/${id}/analysis`)
