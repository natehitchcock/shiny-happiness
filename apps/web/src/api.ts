/**
 * The API seam (doc 10).
 *
 * Relative paths throughout: Vite proxies `/api` in development and the API is
 * same-origin in production, so no base URL is ever configured in the client.
 */
import type { DeckCommand, DeckCommandBatch } from '@roundtable/domain'

export interface Card {
  oracleId: string
  name: string
  manaCost: string | null
  manaValue: number
  typeLine: string
  types: string[]
  oracleText: string
  /**
   * The rules text of each face, for a multi-faced card. Absent for a card with
   * one face, and for any row ingested before the column existed — the
   * boundary between faces is unrecoverable from `oracleText`, which joins them
   * with the newline that also separates two abilities of one face.
   */
  oracleTextFaces?: string[]
  /** Printed values, as text — Magic prints `*` and `1+*`. */
  power: string | null
  toughness: string | null
  loyalty: string | null
  colorIdentity: string[]
  /**
   * Whether this card may lead a deck.
   *
   * Absent for a row ingested before the flag existed, which is why it is
   * optional rather than defaulted here: `false` would claim the card cannot be
   * a commander, and the server draws that distinction too.
   */
  canBeCommander?: boolean
  primaryRole: string
  edhrecRank: number | null
  universesBeyond: boolean
  /**
   * The events this card causes and benefits from (ADR-0011).
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
    /**
     * Art for THIS printing. Already on the wire — `printingsFor` maps the
     * `image_art_crop` / `image_normal` columns onto every row — the client
     * type simply never declared it, so the preview had no source of art for a
     * card that was never hydrated and drew an empty panel instead.
     *
     * Empty string, not null, for "this printing has no cached art": that is
     * the shape `packages/db` writes (see `toPrinting`), and reading it as a
     * URL would put `<img src="">` on screen. Optional because a server from
     * before the printings ingest sends rows without it.
     */
    imageUris?: { artCrop: string; normal: string }
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
  /** : how many of the deck colours this land taps for, and of how many. */
  coloursCovered?: number
  of?: number
  direction?: 'short' | 'over' | 'balanced' | 'enables' | 'payoff' | 'theme'
  delta?: number
  tag?: string
  withOracleIds?: string[]
  /** Whose target a `fills-deficit` gap is measured against (doc 16). */
  source?: 'archetype' | 'custom'
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
  /** The per-deck target sheet (doc 16). `{}` for a deck on its preset. */
  targetOverrides?: TargetOverrides
  entries: { oracleId: string; zone: 'accepted' | 'excluded'; locked: boolean }[]
}

/**
 * Sparse target overrides, in the wire shape (doc 16).
 *
 * Restated here rather than imported from the domain because every other type
 * in this file is the JSON the server sends, and mixing one branded domain type
 * into that set is how a `Deck` here starts pretending to be a `Deck` there.
 * Counts, never shares: the client sends the number the builder typed.
 */
export interface TargetOverrides {
  /** Keyed by dimension key — `role:ramp`, `type:creature`. */
  roles?: Record<string, number>
  /** Keyed by mana-value bucket, 0–7. */
  curve?: Record<string, number>
  tolerance?: number
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
  /**
   * The parsed response body, when there was one.
   *
   * A 409 is not a problem document: it carries the current deck AND the
   * commands the server accepted while we were behind (doc 10 §10.3). Reducing
   * every failure to a message string threw that away, which is why the 409
   * handler could only re-read and re-send blindly.
   */
  readonly body: unknown
  constructor(message: string, status: number, body: unknown = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

/**
 * The body of a 409 (doc 10 §10.3, doc 12 §12.7).
 *
 * `since` is the flat list of what we missed; `sinceBatches` is the same data
 * grouped by version, each with the wall clock doc 12 §12.7's tie-break needs.
 *
 * `sinceComplete` is the one field that must not be ignored: `false` means the
 * log does not cover the whole gap, so `since` is a partial account and the
 * client must refetch rather than rebase against it. Optional because a server
 * from before API-06 does not send it, and absent must read as "cannot tell".
 */
export interface CommandConflict {
  deck: Deck
  since: DeckCommand[]
  sinceBatches?: DeckCommandBatch[]
  sinceComplete?: boolean
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
    // is the part written for a person. The whole body is kept as well — a 409
    // is not a problem document and its payload is what makes it recoverable.
    const parsed: unknown = await response.json().catch(() => null)
    const detail = (parsed as { detail?: string } | null)?.detail
    throw new ApiError(
      detail ?? `Request failed (${String(response.status)})`,
      response.status,
      parsed,
    )
  }
  return (await response.json()) as T
}

/**
 * Card art, as the API sends it: beside the cards, never on them.
 *
 * A `Card` is oracle identity and an image belongs to a printing (doc 02 §2.1),
 * which is why this is a second map rather than two more fields — the same
 * arrangement `prices` has had since API-01.
 *
 * Both members are nullable and 501 cards in the corpus are null in both: they
 * have no art on any printing. That is a real answer, not a missing one, and
 * the primitives draw a readable text panel for it.
 */
export interface ImageUris {
  artCrop: string | null
  normal: string | null
}

export const searchCards = (
  q: string,
  options: { limit?: number; excludeUniversesBeyond?: boolean } = {},
): Promise<{ items: Card[]; images?: Record<string, ImageUris> }> =>
  request(
    `/cards/search?q=${encodeURIComponent(q)}&limit=${String(options.limit ?? 12)}` +
      (options.excludeUniversesBeyond === true ? '&excludeUniversesBeyond=true' : ''),
  )

export interface Hydrated {
  cards: Map<string, Card>
  /** Cheapest printing, in USD. An estimate — see `PriceNote`. */
  prices: Map<string, number | null>
  /** Art from the DEFAULT printing, which is a different printing (ADR-0021). */
  images: Map<string, ImageUris>
}

export const hydrate = async (oracleIds: string[]): Promise<Hydrated> => {
  if (oracleIds.length === 0) return { cards: new Map(), prices: new Map(), images: new Map() }
  const body = await request<{
    items: Card[]
    prices: Record<string, number | null>
    /**
     * Optional because a server from before ADR-0021 does not send it, and an
     * app talking to one must show cards with no art rather than crash on a
     * missing map.
     */
    images?: Record<string, ImageUris>
  }>('/cards/batch', {
    method: 'POST',
    body: JSON.stringify({ oracleIds: [...new Set(oracleIds)].slice(0, 500) }),
  })
  return {
    cards: new Map(body.items.map((c) => [c.oracleId, c])),
    prices: new Map(Object.entries(body.prices)),
    images: new Map(Object.entries(body.images ?? {})),
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
    /**
     * Replaced wholesale, never merged (doc 16). `null` or `{}` clears every
     * override and puts the deck back on its archetype — the way out has to
     * exist, or a tuned target is a trap.
     */
    targetOverrides?: TargetOverrides | null
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

/**
 * Typed as the domain's own `DeckCommand`, not `unknown[]`.
 *
 * The queue the client sends and the batch the server applies are the same
 * language (doc 10 §10.3) — and a 409 rebase compares one against the other, so
 * a local re-spelling of the shape is how the two come to disagree about what a
 * command meant.
 */
export const sendCommands = (
  id: string,
  commands: readonly DeckCommand[],
  baseVersion: number,
  /**
   * Supplied by the caller, NOT minted here.
   *
   * Doc 10 §10.1 makes a batch idempotent so a retry cannot double-apply, and
   * this function used to generate a fresh uuid on every call — which meant a
   * retry presented a NEW key and the server, correctly, treated it as a new
   * batch. The retry path therefore defeated the exact property the key exists
   * to provide: a 5xx that had in fact committed would be applied twice, and
   * accepting a card twice is a real change to the deck.
   *
   * Whoever owns the retry owns the key, so it is a parameter.
   */
  idempotencyKey: string,
): Promise<CommandResult> =>
  request(`/decks/${id}/commands`, {
    method: 'POST',
    body: JSON.stringify({ commands, baseVersion, idempotencyKey }),
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
  body: {
    limitPerGroup?: number
    query?: string
    columns?: readonly string[]
    /** Restrict the answer to these group keys — used to fetch more of one. */
    groups?: readonly string[]
  },
): Promise<Recommendations> =>
  request(`/decks/${id}/recommendations`, { method: 'POST', body: JSON.stringify(body) })

/**
 * One bracket rule the deck breaks (doc 03 §3.2).
 *
 * The counts travel beside the sentence so the interface can render the
 * arithmetic — `4 / 3` — instead of parsing prose to find the numbers in it.
 */
export interface BracketViolation {
  flag: string
  bracket: number
  allowed: number
  actual: number
  /** The offending cards, so the claim can be opened into names. */
  cards: string[]
  message: string
}

/**
 * The target bracket's published entry, exactly as Wizards publishes it.
 *
 * Four of the five barometers are `null`, and `null` here means "the format
 * publishes no rule", NOT "allowed" (ADR-0018). The distinction is the whole
 * reason this arrives as data rather than as a client-side list: rendering a
 * null says what is missing, and hardcoding the four names client-side would
 * be the retired ruleset AGENTS.md §8 rejects.
 *
 * The permissions are typed as plain strings rather than the domain's union
 * because every one of them is null today — narrowing a field nobody has seen
 * a value for would be inventing the vocabulary Wizards has not published.
 */
export interface BracketRules {
  bracket: number
  name: string
  gameChangersAllowed: number | 'unlimited'
  massLandDenial: string | null
  extraTurnChaining: string | null
  twoCardInfinites: string | null
  tutorDensity: string | null
}

export interface BracketReport {
  /** The bracket the builder is aiming at. Their choice, never enforced. */
  target: number
  /**
   * What the deck reads as — and it is `null`, permanently for now.
   *
   * One barometer of five is not a verdict (ADR-0018), so nothing in the
   * interface may render a bracket pass. The `bracket-assessment` entry in
   * `Analysis.unavailable` says which part is missing, in the server's own
   * words, and that sentence is what the panel shows.
   */
  assessed: number | null
  /*
   * Optional, both of them, because the WIRE is not the type.
   *
   * A server from before these fields existed sends them absent, and a
   * required declaration is a claim about a current server rather than
   * protection — `bracket.gameChangers.length` on `undefined` threw and took
   * the whole React tree with it. Declared optional so the compiler makes the
   * reader handle what can actually arrive.
   */
  violations?: BracketViolation[]
  /** The deck's cards on Wizards' Game Changers list, as oracle ids. */
  gameChangers?: string[]
  rules: {
    sourceUrl: string
    retrievedAt: string
    /**
     * Optional: a server from before this field sends provenance only, and
     * the panel then falls back to the allowance a violation carries.
     */
    targetBracket?: BracketRules | null
  } | null
}

/**
 * One thing wrong with the deck, as `packages/domain`'s `LegalityProblem`
 * arrives on the wire.
 *
 * A flat record with every discriminant's payload optional, rather than the
 * domain's own tagged union restated here. Two reasons, and the second is the
 * one that matters: this file holds the JSON the server sends and nothing else
 * (see `TargetOverrides`), and a client-side union would REJECT a `kind` a
 * newer server had added — the panel would fail to compile against a shape it
 * could have rendered honestly. `kind` stays a plain string so an unknown one
 * falls through to the humanising fallback instead of to a type error.
 *
 * Every payload field the domain declares is carried, because the panel needs
 * them to write a sentence: "2 copies, and Commander allows 1" cannot be
 * derived from `kind` alone, and printing `kind` alone is what it used to do.
 */
export interface LegalityProblem {
  kind: string
  /** The offending card, when the problem is about one. Never a name. */
  oracleId?: string
  /** `wrong-card-count`. */
  actual?: number
  expected?: number
  /** `not-singleton`. */
  copies?: number
  allowed?: number
  /** `too-many-commanders`. */
  count?: number
  /** `color-identity` — the colours the card has that the commander does not. */
  offending?: string[]
  /** `invalid-commander` / `invalid-partnership`, in the domain's own words. */
  reason?: string
}

export interface Analysis {
  counts: { total: number; byRole: Record<string, number> }
  targets: {
    dimension: { role?: string; type?: string }
    ideal: number
    min: number
    max: number
    locked: number
    actual: number
    /** `custom` when the builder typed this ideal (doc 16). */
    source?: 'archetype' | 'custom'
    /** What the archetype wanted. `null` where it has no opinion at all. */
    preset?: number | null
  }[]
  /** The deck's own sparse overrides, echoed back for the sheet. */
  targetOverrides?: TargetOverrides
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
    target: { ideal: number; min: number; max: number; source?: 'archetype' | 'custom' }[]
    /** The archetype's own shape, for the buckets the builder pinned (doc 16). */
    preset?: { ideal: number; min: number; max: number }[]
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
  legality: { legal: boolean; problems: LegalityProblem[] }
  /**
   * What the bracket system can and cannot say about this deck (ADR-0018).
   *
   * Optional because a server from before DATA-05 does not send it, and the
   * panel must then say nothing rather than invent a check — the same reason
   * `images` is optional on `hydrate`.
   */
  bracket?: BracketReport
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
