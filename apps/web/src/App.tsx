import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import { usePipeline, type Phase } from './pipeline'
import { formatDecklist } from '@roundtable/domain'
import type { Card } from './api'

/** Human-readable label for a composition dimension. */
const dimensionName = (d: { role?: string; type?: string }): string => d.role ?? d.type ?? '—'

/** Prices are estimates, and the interface has to say so (ADR-0009 Q7). */
const usd = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `$${value.toFixed(2)}`

const plural = (n: number, word: string): string => `${String(n)} ${word}${n === 1 ? '' : 's'}`

/**
 * A reason, said in words. The UI never shows a bare reason kind.
 *
 * `near-combo` takes its count from the recommendation rather than the reason:
 * the domain emits `combos: []` for it deliberately (`recommend.ts`), since
 * listing the ids for every near miss would cost far more than the count, and
 * the count is what the row needs. Reading the empty array instead printed
 * "1 card away from 0 combos", which is worse than saying nothing.
 */
const reasonText = (r: api.Reason, item: api.Recommendation): string => {
  switch (r.kind) {
    case 'completes-combos':
      return `completes ${plural(r.combos?.length ?? item.comboDegree, 'combo')}`
    case 'near-combo':
      return `one card from ${plural(item.nearCombosAt1, 'combo')}`
    case 'fills-deficit':
      return `fills ${dimensionName(r.dimension ?? {})} gap`
    case 'curve-fit': {
      const mv = String(r.manaValue ?? 0)
      if (r.direction === 'short' && (r.delta ?? 0) > 0) {
        return `${plural(r.delta ?? 0, 'card')} short at ${mv}`
      }
      if (r.direction === 'over' && (r.delta ?? 0) < 0) {
        return `${plural(-(r.delta ?? 0), 'card')} too many at ${mv}`
      }
      return `curve fit at ${mv}`
    }
    case 'keyword-synergy': {
      // Said as a mechanism, not a score: "why" is what P4 asks the reason for.
      const tag = (r.tag ?? '').replace(/-/g, ' ')
      return r.direction === 'payoff' ? `pays off your ${tag}` : `enables your ${tag}`
    }
    case 'corpus-inclusion':
      return 'played in similar decks'
    case 'top-by-type':
      return 'top by type'
    case 'bracket-warning':
      return 'bracket warning'
    default:
      return r.kind
  }
}

/**
 * The combo degree pip.
 *
 * The one genuinely hard-won number on the screen, so it gets the only brass.
 * Filled means the card completes a combo outright; outlined means it is one
 * card away; hollow means neither, and it is still shown so the absence reads
 * as a measured zero rather than missing data.
 */
const Degree = ({ degree, near }: { degree: number; near: number }): React.JSX.Element => {
  const value = degree > 0 ? degree : near
  const label =
    degree > 0
      ? `Completes ${String(degree)} combos`
      : near > 0
        ? `One card away from ${String(near)} combos`
        : 'No combos'
  return (
    <span
      className="degree"
      data-completes={degree > 0}
      data-empty={value === 0}
      title={label}
      aria-label={label}
    >
      {value === 0 ? '·' : value}
    </span>
  )
}

/**
 * The two costs a card has: what it costs to cast, and what it costs to buy.
 *
 * Fixed-width columns so both read straight down the list rather than jittering
 * with each card's name length. Mana cost keeps Scryfall's brace notation —
 * rendering real pips needs the symbol artwork, which is ING-04's job.
 */
const Costs = ({
  manaCost,
  price,
}: {
  manaCost: string | null | undefined
  price: number | null | undefined
}): React.JSX.Element => (
  <>
    <span className="mana" title={manaCost ?? 'No mana cost'}>
      {manaCost ?? ''}
    </span>
    <span className="cash" title="Cheapest printing — an estimate">
      {usd(price)}
    </span>
  </>
)

const CardRow = ({
  card,
  item,
  actions,
}: {
  card: api.Card | undefined
  item?: api.Recommendation
  actions: { label: string; kind: string; onClick: () => void }[]
}): React.JSX.Element => {
  const degree = item?.comboDegree
  const near = item?.nearCombosAt1
  const reasons = item?.reasons
  return (
    <div className="card-row">
      {degree !== undefined ? <Degree degree={degree} near={near ?? 0} /> : null}
      <span className="name">
        {card?.name ?? 'Loading…'}
        {reasons !== undefined && reasons.length > 0 ? (
          <span className="reasons">
            {reasons.map((r, i) => (
              <span className="reason" data-kind={r.kind} key={i}>
                {item === undefined ? r.kind : reasonText(r, item)}
              </span>
            ))}
          </span>
        ) : null}
      </span>
      <span className="cost">{card?.manaCost ?? ''}</span>
      {actions.map((a) => (
        <button
          key={a.label}
          className={`act ${a.kind}`}
          onClick={a.onClick}
          aria-label={card === undefined ? a.label : `${a.label} ${card.name}`}
        >
          {a.label}
        </button>
      ))}
    </div>
  )
}

/**
 * Deck sections, in the order the rail shows them.
 *
 * `enchantment` and `other` are here although they were not asked for: the
 * domain has eight card types, and without them every enchantment would vanish
 * from the rail — a silent drop, which is the one thing this codebase will not
 * do. `other` catches Battles and anything a future set invents.
 */
const DECK_SECTIONS = [
  { key: 'commander', label: 'Commander' },
  { key: 'planeswalker', label: 'Planeswalkers' },
  { key: 'creature', label: 'Creatures' },
  { key: 'sorcery', label: 'Sorceries' },
  { key: 'instant', label: 'Instants' },
  { key: 'enchantment', label: 'Enchantments' },
  { key: 'artifact', label: 'Artifacts' },
  { key: 'land', label: 'Lands' },
  { key: 'other', label: 'Other' },
] as const

/**
 * One home per card, most-specific first.
 *
 * An Artifact Creature is both; decklists file it under Creatures, so Creature
 * wins. Land wins outright because a creature-land is counted as a land by
 * everyone. Mirrors `ROLE_PRECEDENCE` in the domain, for the same reason.
 */
const SECTION_PRECEDENCE = [
  'land',
  'creature',
  'planeswalker',
  'artifact',
  'enchantment',
  'instant',
  'sorcery',
] as const

const sectionOf = (card: Card | undefined): string => {
  if (card === undefined) return 'other'
  for (const type of SECTION_PRECEDENCE) {
    if (card.types.includes(type)) return type
  }
  return 'other'
}

const ARCHETYPES = [
  'aggro',
  'midrange',
  'control',
  'combo',
  'ramp',
  'aristocrats',
  'voltron',
  'tokens',
  'stax',
]

const Start = ({ onCreated }: { onCreated: (deck: api.Deck) => void }): React.JSX.Element => {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<api.Card[]>([])
  const [chosen, setChosen] = useState<api.Card | null>(null)
  const [archetype, setArchetype] = useState('midrange')
  const [bracket, setBracket] = useState(3)
  const [noUB, setNoUB] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (term.trim().length < 2) {
      setResults([])
      return
    }
    let cancelled = false
    const timer = setTimeout(() => {
      void api
        // Only legendary creatures can lead a deck, so the search says so
        // rather than offering every card and rejecting the choice later.
        .searchCards(`${term} type:legendary type:creature`, {
          excludeUniversesBeyond: noUB,
        })
        .then((r) => {
          if (!cancelled) setResults(r.items)
        })
        .catch(() => {
          if (!cancelled) setResults([])
        })
    }, 180)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [term, noUB])

  const create = (): void => {
    if (chosen === null) return
    setBusy(true)
    setError(null)
    void api
      .createDeck({
        name: `${chosen.name} deck`,
        commanders: [chosen.oracleId],
        targetBracket: bracket,
        archetype,
        excludeUniversesBeyond: noUB,
      })
      .then(onCreated)
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not create the deck')
        setBusy(false)
      })
  }

  return (
    <div className="start">
      <h1>
        Build a Commander deck around
        <br />
        the combos it can actually assemble.
      </h1>
      <p>Pick a commander. Every suggestion tells you why it is there.</p>

      <div className="field">
        <label htmlFor="commander">Commander</label>
        <input
          id="commander"
          type="text"
          value={chosen?.name ?? term}
          placeholder="Search legendary creatures…"
          onChange={(e) => {
            setChosen(null)
            setTerm(e.target.value)
          }}
        />
      </div>

      {chosen === null && results.length > 0 ? (
        <div style={{ marginBottom: '1rem' }}>
          {results.slice(0, 8).map((c) => (
            <CardRow
              key={c.oracleId}
              card={c}
              actions={[{ label: 'Choose', kind: 'accept', onClick: () => setChosen(c) }]}
            />
          ))}
        </div>
      ) : null}

      <div className="row">
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="archetype">Archetype</label>
          <select id="archetype" value={archetype} onChange={(e) => setArchetype(e.target.value)}>
            {ARCHETYPES.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label htmlFor="bracket">Bracket</label>
          <select id="bracket" value={bracket} onChange={(e) => setBracket(Number(e.target.value))}>
            {[1, 2, 3, 4, 5].map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
      </div>

      <label className="check">
        <input type="checkbox" checked={noUB} onChange={(e) => setNoUB(e.target.checked)} />
        Exclude Universes Beyond cards
      </label>

      <button className="primary" disabled={chosen === null || busy} onClick={create}>
        {busy ? 'Creating…' : 'Start building'}
      </button>
      {error !== null ? <p className="problem">{error}</p> : null}
    </div>
  )
}

/** Cards the deck holds, collapsed to one row per card with a count. */
interface DeckLine {
  oracleId: string
  copies: number
}

const Preview = ({
  detail,
  price,
  onClose,
}: {
  detail: api.CardDetail | null
  price: number | null | undefined
  onClose: () => void
}): React.JSX.Element | null => {
  if (detail === null) return null
  return (
    <aside className="preview" aria-label={`${detail.name} details`}>
      <div className="preview-head">
        <h3>{detail.name}</h3>
        <button className="act" onClick={onClose} aria-label="Close preview">
          Close
        </button>
      </div>
      <p className="type-line">
        {detail.typeLine}
        {detail.manaCost !== null ? <span className="cost"> {detail.manaCost}</span> : null}
      </p>
      {/* Oracle text is the card. Newlines are meaningful — they separate
          abilities — so it is rendered pre-wrapped rather than collapsed. */}
      <p className="oracle">{detail.oracleText === '' ? 'No rules text.' : detail.oracleText}</p>
      <p className="note">
        {usd(price)} <span className="estimate">est.</span> · {detail.printings.length} printing
        {detail.printings.length === 1 ? '' : 's'}
        {detail.universesBeyond ? ' · Universes Beyond' : ''}
      </p>
      {detail.combos.length > 0 ? (
        <>
          <h4>In {plural(detail.combos.length, 'combo')}</h4>
          <p className="note">
            {[...new Set(detail.combos.flatMap((c) => c.produces))].slice(0, 6).join(', ')}
          </p>
        </>
      ) : null}
    </aside>
  )
}

/**
 * The mana curve, actual against the archetype's target.
 *
 * A bar per mana value with the target drawn ON the column as a hairline, so
 * the comparison needs no second axis. Colour is diverging, not categorical:
 * sage where the deck is short, rust where it is over-full, muted where it sits
 * on target. Identity never rests on colour alone — every column states its
 * numbers in its `aria-label` and its tooltip.
 */
const Curve = ({ curve }: { curve: api.Analysis['curve'] }): React.JSX.Element => {
  const peak = Math.max(1, ...curve.histogram, ...curve.deltas.map((d) => d.max))

  return (
    <>
      <div className="curve" role="img" aria-label="Mana curve against the archetype target">
        {curve.deltas.map((d) => {
          // The band decides, not the ideal: inside it the bucket is fine.
          const direction = d.withinRange ? 'balanced' : d.delta > 0 ? 'short' : 'over'
          const label = d.withinRange
            ? `in range (${String(d.min)}–${String(d.max)})`
            : direction === 'short'
              ? `${plural(d.delta, 'card')} short of ${String(d.min)}`
              : `${plural(-d.delta, 'card')} over ${String(d.max)}`
          return (
            <div
              className="curve-col"
              key={d.bucket}
              title={`Mana value ${String(d.bucket)}${d.bucket === 7 ? '+' : ''}: ${String(d.actual)} cards, want ${String(d.min)}–${String(d.max)} — ${label}`}
              aria-label={`Mana value ${String(d.bucket)}: ${String(d.actual)} cards, target range ${String(d.min)} to ${String(d.max)}, ${label}`}
            >
              {/* The acceptable range, drawn as a band rather than a line —
                  anywhere inside it is fine, which is what a range means. */}
              <div
                className="curve-band"
                style={{
                  bottom: `${String((d.min / peak) * 100)}%`,
                  height: `${String(((d.max - d.min) / peak) * 100)}%`,
                }}
              />
              <div
                className="curve-bar"
                data-direction={direction}
                style={{ height: `${String((d.actual / peak) * 100)}%` }}
              />
            </div>
          )
        })}
      </div>
      <div className="curve-axis" aria-hidden="true">
        {curve.deltas.map((d) => (
          <span key={d.bucket}>{d.bucket === 7 ? '7+' : d.bucket}</span>
        ))}
      </div>
      <p className="curve-key">
        <i className="short">short</i>
        <i className="over">too many</i>
        <span>— band is the target range</span>
      </p>
    </>
  )
}

interface PendingCommand {
  readonly type: 'accept' | 'exclude' | 'remove'
  readonly oracleId: string
}

interface QueryResult {
  readonly deck: api.Deck
  readonly recs: api.Recommendations
  readonly analysis: api.Analysis
  readonly hydrated: api.Hydrated
}

/**
 * The progress bar in the masthead.
 *
 * Two halves that mean different things, which is why it is one bar and not a
 * spinner: the left half is work the server is doing, the right half is time
 * being handed back to the user before the list moves under them. The label
 * says which half we are in, because a bar alone cannot.
 */
const ProgressBar = ({
  phase,
  progress,
  label,
}: {
  phase: Phase
  progress: number
  label: string
}): React.JSX.Element => (
  <div
    className="progress"
    data-active={phase !== 'idle'}
    role="status"
    aria-live="polite"
    aria-label={label}
  >
    <span className="progress-label">{label}</span>
    <div className="progress-track">
      <div
        className="progress-fill"
        data-phase={phase}
        style={{ width: `${String(Math.round(progress * 100))}%` }}
      />
      {/* The halfway mark is meaningful — it is where the server's answer
          arrives and the user's grace period begins — so it is drawn. */}
      <span className="progress-half" aria-hidden="true" />
    </div>
  </div>
)

/**
 * One basic land, with its count.
 *
 * A number box AND a pair of steppers, because both gestures are wanted: +1
 * repeatedly while eyeballing the curve, or type 34 when you already know. The
 * box commits on blur and on Enter so a half-typed "3" of "34" never fires.
 */
const BasicRow = ({
  card,
  count,
  onSet,
}: {
  card: api.Card
  count: number
  onSet: (next: number) => void
}): React.JSX.Element => {
  const [draft, setDraft] = useState(String(count))
  const commit = (raw: string): void => {
    const parsed = Number.parseInt(raw, 10)
    // A deck cannot hold a negative number of Mountains; anything unreadable
    // falls back to what is already there rather than to zero.
    const next = Number.isFinite(parsed) ? Math.max(0, parsed) : count
    setDraft(String(next))
    if (next !== count) onSet(next)
  }

  // Follow the deck when it changes underneath us (a batch landing, say).
  useEffect(() => setDraft(String(count)), [count])

  return (
    <div className="card-row basic-row">
      <span className="name">{card.name}</span>
      <button
        className="act step"
        onClick={() => onSet(Math.max(0, count - 1))}
        disabled={count === 0}
        aria-label={`One fewer ${card.name}`}
      >
        −
      </button>
      <input
        className="basic-count"
        type="text"
        inputMode="numeric"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value)
        }}
        aria-label={`Number of ${card.name}`}
      />
      <button
        className="act step"
        onClick={() => onSet(count + 1)}
        aria-label={`One more ${card.name}`}
      >
        +
      </button>
    </div>
  )
}

/**
 * Paste a decklist, see what it resolved to, then commit.
 *
 * The preview is not optional politeness: doc 15 §15.3 requires that nothing
 * applies before the user confirms, so a typo costs one line rather than the
 * whole paste. Unresolved lines are listed, never silently dropped.
 */
const ImportDialog = ({
  deckId,
  onCommit,
  onClose,
}: {
  deckId: string
  onCommit: (cards: { oracleId: string; quantity: number }[]) => void
  onClose: () => void
}): React.JSX.Element => {
  const [text, setText] = useState('')
  const [preview, setPreview] = useState<api.ImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = (): void => {
    setBusy(true)
    setError(null)
    void api
      .importPreview(deckId, text)
      .then((p) => {
        setPreview(p)
        setBusy(false)
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : 'Could not read that list')
        setBusy(false)
      })
  }

  const total = (preview?.resolved ?? []).reduce((n, r) => n + r.quantity, 0)

  return (
    <div className="sheet" role="dialog" aria-label="Import a decklist">
      <div className="sheet-head">
        <h3>Import a decklist</h3>
        <button className="act" onClick={onClose} aria-label="Close import">
          Close
        </button>
      </div>

      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          setPreview(null)
        }}
        placeholder={'1 Sol Ring\n1 Rhystic Study\n34 Mountain'}
        aria-label="Decklist text"
        rows={8}
      />

      {error !== null ? <p className="problem">{error}</p> : null}

      {preview === null ? (
        <button className="primary" onClick={check} disabled={busy || text.trim() === ''}>
          {busy ? 'Reading…' : 'Preview'}
        </button>
      ) : (
        <>
          <p className="note">
            {plural(total, 'card')} across {plural(preview.resolved.length, 'line')} resolved.
          </p>
          {preview.unresolved.length > 0 ? (
            <div className="unavailable">
              <strong>Not recognised — these will not be added:</strong>
              {preview.unresolved.map((u, i) => (
                <div key={i}>
                  {u.name} — {u.reason}
                </div>
              ))}
            </div>
          ) : null}
          <div className="row" style={{ marginTop: '0.5rem' }}>
            <button
              className="primary"
              onClick={() => {
                onCommit(preview.resolved)
                onClose()
              }}
              disabled={preview.resolved.length === 0}
            >
              Add {plural(total, 'card')}
            </button>
            <button className="act" onClick={() => setPreview(null)}>
              Back
            </button>
          </div>
        </>
      )}
    </div>
  )
}

const Workspace = ({ deck: initial }: { deck: api.Deck }): React.JSX.Element => {
  const [deck, setDeck] = useState(initial)
  const [groups, setGroups] = useState<api.Group[]>([])
  const [unavailable, setUnavailable] = useState<api.Unavailable[]>([])
  const [analysis, setAnalysis] = useState<api.Analysis | null>(null)
  const [cards, setCards] = useState<Map<string, api.Card>>(new Map())
  const [prices, setPrices] = useState<Map<string, number | null>>(new Map())
  const [query, setQuery] = useState('')
  const [queryError, setQueryError] = useState<string | null>(null)
  const [detail, setDetail] = useState<api.CardDetail | null>(null)
  /**
   * Clicks the server has not seen yet.
   *
   * The deck view is rendered from `deck` PLUS this, so a card lands the instant
   * it is clicked — long before the buffer closes. It is also what drives the
   * per-card spinner, so a card in flight cannot be clicked twice.
   */
  const [pending, setPending] = useState<readonly PendingCommand[]>([])
  const [basics, setBasics] = useState<api.Card[]>([])
  const [importing, setImporting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const deckRef = useRef(deck)
  const queryRef = useRef(query)
  deckRef.current = deck
  queryRef.current = query

  const load = useCallback(async (commands: readonly PendingCommand[]): Promise<QueryResult> => {
    let current = deckRef.current

    // Commands first, as ONE batch — four accepts are one round trip, and one
    // atomic unit the server can reject or apply as a whole (doc 10 §10.3).
    if (commands.length > 0) {
      const result = await api.sendCommands(
        current.id,
        commands.map((c) =>
          c.type === 'accept'
            ? { type: 'accept', oracleId: c.oracleId, origin: 'manual' }
            : { type: c.type, oracleId: c.oracleId },
        ),
        current.version,
      )
      current = result.deck
    }

    const [recs, ana] = await Promise.all([
      api.getRecommendations(current.id, {
        limitPerGroup: 8,
        ...(queryRef.current === '' ? {} : { query: queryRef.current }),
      }),
      api.getAnalysis(current.id),
    ])
    const hydrated = await api.hydrate([
      ...current.commanders,
      ...current.entries.map((e) => e.oracleId),
      ...recs.groups.flatMap((g) => g.items.map((i) => i.oracleId)),
    ])
    return { deck: current, recs, analysis: ana, hydrated }
  }, [])

  const pipeline = usePipeline<PendingCommand>({
    run: (commands) => load(commands),
    apply: (value) => {
      const r = value as QueryResult | null
      if (r === null) {
        // The run failed; its error is already on the bar. Drop the optimistic
        // overlay rather than leaving cards that were never saved.
        setPending([])
        return
      }
      setDeck(r.deck)
      setGroups(r.recs.groups)
      setUnavailable(r.recs.unavailable)
      setAnalysis(r.analysis)
      setQueryError(r.recs.query.errors[0]?.message ?? null)
      setCards(r.hydrated.cards)
      setPrices(r.hydrated.prices)
      setPending([])
    },
  })

  // Initial load, and whenever the filter changes. No settle on this path —
  // there is nothing to keep adding to, so holding the result back would be lag.
  const { refresh } = pipeline
  useEffect(() => {
    refresh()
  }, [query, refresh])

  // Basics never change for a deck — its colour identity is fixed by its
  // commanders — so this is fetched once rather than with every recompute.
  useEffect(() => {
    void api
      .basicLands(deck.id)
      .then((r) => setBasics(r.items))
      .catch(() => setBasics([]))
  }, [deck.id])

  const act = (oracleId: string, type: PendingCommand['type']): void => {
    // Applied to the view immediately. This is the whole point of the buffer:
    // the click is instant and the recompute catches up.
    setPending((current) => [...current, { type, oracleId }])
    pipeline.schedule({ type, oracleId })
  }

  /**
   * Move a basic to an exact count.
   *
   * Emitted as N discrete commands rather than a "set count" verb: the batch is
   * already atomic (doc 10 §10.3), and `remove` means one copy (ADR-0012), so
   * the difference IS the command list. Decrement uses `remove`, never
   * `exclude` — reducing Mountains must not ban Mountains.
   */
  const setBasicCount = (oracleId: string, next: number): void => {
    const current = optimistic.entries.filter(
      (e) => e.oracleId === oracleId && e.zone === 'accepted',
    ).length
    const delta = next - current
    if (delta === 0) return

    const type: PendingCommand['type'] = delta > 0 ? 'accept' : 'remove'
    const commands = Array.from({ length: Math.abs(delta) }, () => ({ type, oracleId }))
    setPending((queued) => [...queued, ...commands])
    for (const c of commands) pipeline.schedule(c)
  }

  const setDeckOption = (body: Parameters<typeof api.patchDeck>[1]): void => {
    void api
      .patchDeck(deck.id, body)
      .then((d) => {
        setDeck(d)
        pipeline.refresh()
      })
      .catch(() => undefined)
  }

  /**
   * Export the deck as plain text, formatted by the DOMAIN's own formatter.
   *
   * No endpoint for it: `web` and `api` share `packages/domain`, so the client
   * formats the list itself and the two cannot produce different files. Copy
   * first, because copying is what people actually do with a decklist
   * (doc 15 §15.4).
   */
  const exportDeck = (): void => {
    const counts = new Map<string, number>()
    for (const e of optimistic.entries) {
      if (e.zone !== 'accepted') continue
      counts.set(e.oracleId, (counts.get(e.oracleId) ?? 0) + 1)
    }
    const nameOf = (id: string): string =>
      cards.get(id)?.name ?? basics.find((b) => b.oracleId === id)?.name ?? 'Unknown card'

    const text = formatDecklist(
      {
        name: deck.name,
        entries: [
          ...deck.commanders.map((id) => ({
            oracleId: id as never,
            name: nameOf(id),
            quantity: 1,
            isCommander: true,
            category: null,
            setCode: null,
            collectorNumber: null,
          })),
          ...[...counts].map(([id, quantity]) => ({
            oracleId: id as never,
            name: nameOf(id),
            quantity,
            isCommander: false,
            category: null,
            setCode: null,
            collectorNumber: null,
          })),
        ],
      },
      'text',
    )

    void navigator.clipboard
      .writeText(text)
      .then(() => setNotice(`Copied ${plural(counts.size + deck.commanders.length, 'line')}`))
      .catch(() => setNotice('Could not copy — the browser blocked clipboard access'))
  }

  const open = (oracleId: string): void => {
    void api
      .getCardDetail(oracleId)
      .then(setDetail)
      .catch(() => setDetail(null))
  }

  /** The deck as the user sees it: saved entries plus what is still in flight. */
  const optimistic = useMemo(() => {
    let entries = [...deck.entries]
    for (const p of pending) {
      if (p.type === 'accept') {
        entries.push({ oracleId: p.oracleId, zone: 'accepted', locked: false })
      } else if (p.type === 'remove') {
        // One copy, and nothing recorded — the card stays suggestible.
        const at = entries.findIndex((e) => e.oracleId === p.oracleId && e.zone === 'accepted')
        if (at >= 0) entries.splice(at, 1)
      } else {
        const at = entries.findIndex((e) => e.oracleId === p.oracleId && e.zone === 'accepted')
        if (at >= 0) entries.splice(at, 1)
        entries = entries.filter((e) => e.oracleId !== p.oracleId)
        entries.push({ oracleId: p.oracleId, zone: 'excluded', locked: false })
      }
    }
    return { ...deck, entries }
  }, [deck, pending])

  const inFlight = useMemo(() => new Set(pending.map((p) => p.oracleId)), [pending])
  const basicIds = useMemo(() => new Set(basics.map((b) => b.oracleId)), [basics])

  const accepted = optimistic.entries.filter((e) => e.zone === 'accepted')
  const excluded = optimistic.entries.filter((e) => e.zone === 'excluded')
  const deckSize = accepted.length + optimistic.commanders.length

  /** Group the deck by card type, collapsing duplicates to a count. */
  const sections = useMemo(() => {
    const byKey = new Map<string, Map<string, number>>()
    const put = (key: string, oracleId: string): void => {
      const lines = byKey.get(key) ?? new Map<string, number>()
      lines.set(oracleId, (lines.get(oracleId) ?? 0) + 1)
      byKey.set(key, lines)
    }
    for (const id of deck.commanders) put('commander', id)
    for (const e of accepted) {
      // Basics have their own section with its own controls; listing them twice
      // would make the counts disagree with each other.
      if (basicIds.has(e.oracleId)) continue
      put(sectionOf(cards.get(e.oracleId)), e.oracleId)
    }

    return DECK_SECTIONS.map((section) => ({
      ...section,
      lines: [...(byKey.get(section.key) ?? new Map<string, number>())]
        .map(([oracleId, copies]): DeckLine => ({ oracleId, copies }))
        .sort((a, b) =>
          (cards.get(a.oracleId)?.name ?? '').localeCompare(cards.get(b.oracleId)?.name ?? ''),
        ),
    })).filter((section) => section.lines.length > 0)
  }, [deck.commanders, accepted, cards])

  const deficits = useMemo(
    () => (analysis?.deficits ?? []).filter((d) => d.delta < 0).slice(0, 8),
    [analysis],
  )

  const budget = deck.budget
  const overCard =
    budget?.maxCardUsd !== null && budget?.maxCardUsd !== undefined
      ? accepted.filter((e) => (prices.get(e.oracleId) ?? 0) > budget.maxCardUsd!).length
      : 0

  return (
    <>
      <header className="masthead">
        <h1 className="wordmark">
          Lotus <span>Wizard</span>
        </h1>
        <span className="meta">
          {deck.name.toUpperCase()} · {deck.colorIdentity.join('') || 'C'} · BRACKET{' '}
          {deck.targetBracket} · {deck.archetype.toUpperCase()}
        </span>
        <ProgressBar phase={pipeline.phase} progress={pipeline.progress} label={pipeline.label} />
        <span className="meta deck-count">{deckSize} / 100 CARDS</span>
        <button className="act" onClick={() => setImporting(true)}>
          Import
        </button>
        <button className="act" onClick={exportDeck}>
          Export
        </button>
      </header>

      {importing ? (
        <ImportDialog
          deckId={deck.id}
          onClose={() => setImporting(false)}
          onCommit={(resolved) => {
            // Straight through the ordinary command path, so an import is one
            // batch and is undone exactly like any other (doc 10 §10.3).
            const commands = resolved.flatMap((r) =>
              Array.from({ length: r.quantity }, () => ({
                type: 'accept' as const,
                oracleId: r.oracleId,
              })),
            )
            setPending((queued) => [...queued, ...commands])
            for (const c of commands) pipeline.schedule(c)
          }}
        />
      ) : null}

      {notice !== null ? (
        <p className="banner note" role="status">
          {notice}
        </p>
      ) : null}

      {pipeline.error !== null ? (
        <p className="banner problem" role="status">
          {pipeline.error}
        </p>
      ) : null}

      <div className="workspace">
        <section className="region" aria-label="Deck">
          <h2>Deck · {deckSize}</h2>
          {sections.map((section) => (
            <div className="deck-section" key={section.key}>
              <h3>
                {section.label}
                <span className="count">{section.lines.reduce((n, l) => n + l.copies, 0)}</span>
              </h3>
              {section.lines.map((line) => (
                <div className="card-row" key={line.oracleId}>
                  {line.copies > 1 ? <span className="copies">{line.copies}×</span> : null}
                  <button
                    className="name as-link"
                    onClick={() => open(line.oracleId)}
                    aria-label={`Preview ${cards.get(line.oracleId)?.name ?? 'card'}`}
                  >
                    {cards.get(line.oracleId)?.name ?? 'Loading…'}
                  </button>
                  <Costs
                    manaCost={cards.get(line.oracleId)?.manaCost}
                    price={prices.get(line.oracleId)}
                  />
                  {section.key === 'commander' ? null : (
                    <button
                      className="act exclude"
                      onClick={() => act(line.oracleId, 'exclude')}
                      aria-label={`Remove ${cards.get(line.oracleId)?.name ?? 'card'}`}
                    >
                      Remove
                    </button>
                  )}
                </div>
              ))}
            </div>
          ))}
          {accepted.length === 0 ? (
            <p className="note">Nothing accepted yet. Suggestions are in the middle.</p>
          ) : null}

          {basics.length > 0 ? (
            <div className="deck-section">
              <h3>
                Basic lands
                <span className="count">
                  {accepted.filter((e) => basicIds.has(e.oracleId)).length}
                </span>
              </h3>
              {basics.map((b) => (
                <BasicRow
                  key={b.oracleId}
                  card={b}
                  count={accepted.filter((e) => e.oracleId === b.oracleId).length}
                  onSet={(next) => setBasicCount(b.oracleId, next)}
                />
              ))}
            </div>
          ) : null}

          {excluded.length > 0 ? (
            <div className="deck-section">
              <h3>
                Excluded<span className="count">{excluded.length}</span>
              </h3>
              <p className="note">These are never suggested again.</p>
              {excluded.map((e) => (
                <div className="card-row" key={e.oracleId}>
                  <span className="name">{cards.get(e.oracleId)?.name ?? 'Loading…'}</span>
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="region" aria-label="Suggestions">
          <h2>Deck options</h2>
          <div className="options" aria-label="Deck options">
            <label className="check">
              <input
                type="checkbox"
                checked={deck.excludeUniversesBeyond}
                onChange={(e) => setDeckOption({ excludeUniversesBeyond: e.target.checked })}
              />
              Exclude Universes Beyond
            </label>

            <label className="option-field">
              <span>Max per card</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={budget?.maxCardUsd ?? ''}
                placeholder="any"
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  setDeckOption({
                    budget: {
                      maxCardUsd: value === '' ? null : Number(value),
                      maxTotalUsd: budget?.maxTotalUsd ?? null,
                    },
                  })
                }}
              />
            </label>

            <label className="option-field">
              <span>Max deck total</span>
              <input
                type="text"
                inputMode="decimal"
                defaultValue={budget?.maxTotalUsd ?? ''}
                placeholder="any"
                onBlur={(e) => {
                  const value = e.target.value.trim()
                  setDeckOption({
                    budget: {
                      maxCardUsd: budget?.maxCardUsd ?? null,
                      maxTotalUsd: value === '' ? null : Number(value),
                    },
                  })
                }}
              />
            </label>

            {analysis !== null ? (
              <p
                className="option-total"
                title="Scryfall prices are daily estimates and go stale within a day. Not a purchase price."
              >
                Deck total {usd(analysis.prices.deckTotalUsd)}{' '}
                <span className="estimate">est.</span>
                {analysis.prices.unpricedCards > 0
                  ? ` · ${String(analysis.prices.unpricedCards)} unpriced`
                  : ''}
                {budget?.maxTotalUsd !== null &&
                budget?.maxTotalUsd !== undefined &&
                analysis.prices.deckTotalUsd > budget.maxTotalUsd
                  ? ' · over budget'
                  : ''}
                {overCard > 0 ? ` · ${String(overCard)} over the per-card limit` : ''}
              </p>
            ) : null}
          </div>

          <p className="note estimate-note">
            Prices are daily estimates from Scryfall and go stale within a day. Not a purchase
            price.
          </p>

          <h2>Suggestions</h2>
          <div className="field">
            <input
              type="text"
              value={query}
              placeholder="Filter — try  t:creature  or  mv<=3  or  price<=5"
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Filter suggestions"
            />
            {queryError !== null ? <p className="problem">{queryError}</p> : null}
          </div>

          {groups.map((g) => (
            <div className="group" key={g.key}>
              <div className="group-head">
                <h3>{g.label}</h3>
                <span className="count">{g.total}</span>
                <span className="rationale">{g.rationale}</span>
              </div>
              {g.items.map((item) => (
                <div className="card-row" key={item.oracleId}>
                  <Degree degree={item.comboDegree} near={item.nearCombosAt1} />
                  <button
                    className="name as-link"
                    onClick={() => open(item.oracleId)}
                    aria-label={`Preview ${cards.get(item.oracleId)?.name ?? 'card'}`}
                  >
                    {cards.get(item.oracleId)?.name ?? 'Loading…'}
                    <span className="reasons">
                      {item.reasons.map((r, i) => (
                        <span className="reason" data-kind={r.kind} key={i}>
                          {reasonText(r, item)}
                        </span>
                      ))}
                    </span>
                  </button>
                  <Costs
                    manaCost={cards.get(item.oracleId)?.manaCost}
                    price={prices.get(item.oracleId)}
                  />
                  {inFlight.has(item.oracleId) ? (
                    // Already in the deck as far as the user is concerned; the
                    // spinner says the suggestions have not caught up yet, and
                    // it stops the same card being clicked twice.
                    <span
                      className="spinner"
                      role="status"
                      aria-label={`${cards.get(item.oracleId)?.name ?? 'Card'} added, updating suggestions`}
                    />
                  ) : (
                    <>
                      <button
                        className="act accept"
                        onClick={() => act(item.oracleId, 'accept')}
                        aria-label={`Add ${cards.get(item.oracleId)?.name ?? 'card'}`}
                      >
                        Add
                      </button>
                      <button
                        className="act exclude"
                        onClick={() => act(item.oracleId, 'exclude')}
                        aria-label={`Never suggest ${cards.get(item.oracleId)?.name ?? 'card'}`}
                      >
                        Never
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))}
          {groups.length === 0 ? <p className="note">Working…</p> : null}
        </section>

        <section className="region analysis" aria-label="Analysis">
          <div className="analysis-scroll">
            <Preview
              detail={detail}
              price={prices.get(detail?.oracleId ?? '')}
              onClose={() => setDetail(null)}
            />

            <h2 style={{ marginTop: '1.25rem' }}>Composition</h2>
            {deficits.map((d) => {
              const name = dimensionName(d.dimension)
              const target = analysis?.targets.find((t) => dimensionName(t.dimension) === name)
              const have = (target?.ideal ?? 0) + d.delta
              const pct = target?.ideal ? Math.min(100, (have / target.ideal) * 100) : 0
              return (
                <div className="meter" key={name}>
                  <div className="meter-label">
                    <span>{name}</span>
                    <span className="delta">
                      {have} / {target?.ideal ?? 0}
                    </span>
                  </div>
                  <div className="meter-track">
                    <div className="meter-fill" data-short={true} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
            {deficits.length === 0 && analysis !== null ? (
              <p className="note">No shortfalls.</p>
            ) : null}

            {analysis !== null ? (
              <>
                <h2 style={{ marginTop: '1.25rem' }}>Reads as</h2>
                <p className="note">
                  {analysis.archetype.assessed} ({Math.round(analysis.archetype.confidence * 100)}%
                  confidence) · avg mana value {analysis.curve.averageManaValue.toFixed(2)}
                </p>

                {analysis.deckCombos.length > 0 ? (
                  <>
                    <h2 style={{ marginTop: '1.25rem' }}>
                      Combos assembled
                      <span className="count">{analysis.deckCombos.length}</span>
                    </h2>
                    {/* Its own scroller: a deck can assemble dozens, and letting
                      them push the rest of the rail off-screen would bury the
                      things next to them. No slice — every combo the deck
                      actually has is listed. */}
                    <div className="combo-list">
                      {analysis.deckCombos.map((c) => (
                        <p className="note" key={c.comboId}>
                          {c.pieces.map((p) => cards.get(p)?.name ?? p.slice(0, 6)).join(' + ')} →{' '}
                          {c.produces.join(', ')}
                        </p>
                      ))}
                    </div>
                  </>
                ) : null}
              </>
            ) : null}

            {unavailable.length > 0 ? (
              <div className="unavailable">
                <strong>Not computed:</strong>
                {unavailable.map((u) => (
                  <div key={u.key}>
                    {u.key} — {u.reason}
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {/* Pinned to the bottom of the rail. The curve and the legality
              verdict are the two things a builder checks constantly, so they
              stay on screen however far the notes above them scroll. */}
          {analysis !== null ? (
            <div className="analysis-pinned">
              <h2>Mana curve</h2>
              <Curve curve={analysis.curve} />
              <p className="note">
                Average mana value {analysis.curve.averageManaValue.toFixed(2)}
              </p>

              <h2 style={{ marginTop: '0.75rem' }}>Legality</h2>
              {analysis.legality.problems.length === 0 ? (
                <p className="note">No problems found.</p>
              ) : (
                analysis.legality.problems.slice(0, 4).map((p, i) => (
                  <p className="problem" key={i}>
                    {p.kind}
                  </p>
                ))
              )}
            </div>
          ) : null}
        </section>
      </div>
    </>
  )
}

export const App = (): React.JSX.Element => {
  const [deck, setDeck] = useState<api.Deck | null>(null)

  useEffect(() => {
    // Survive a reload without needing the deck library (API-05).
    const saved = localStorage.getItem('roundtable.deck')
    if (saved !== null) {
      void api
        .getDeck(saved)
        .then(setDeck)
        .catch(() => localStorage.removeItem('roundtable.deck'))
    }
  }, [])

  if (deck === null) {
    return (
      <Start
        onCreated={(d) => {
          localStorage.setItem('roundtable.deck', d.id)
          setDeck(d)
        }}
      />
    )
  }
  return <Workspace deck={deck} key={deck.id} />
}
