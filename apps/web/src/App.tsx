import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'

/** Human-readable label for a composition dimension. */
const dimensionName = (d: { role?: string; type?: string }): string => d.role ?? d.type ?? '—'

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
    case 'curve-fit':
      return `curve fit at ${String(r.manaValue ?? 0)}`
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
        .searchCards(`${term} type:legendary type:creature`)
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
  }, [term])

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

      <button className="primary" disabled={chosen === null || busy} onClick={create}>
        {busy ? 'Creating…' : 'Start building'}
      </button>
      {error !== null ? <p className="problem">{error}</p> : null}
    </div>
  )
}

const Workspace = ({ deck: initial }: { deck: api.Deck }): React.JSX.Element => {
  const [deck, setDeck] = useState(initial)
  const [groups, setGroups] = useState<api.Group[]>([])
  const [unavailable, setUnavailable] = useState<api.Unavailable[]>([])
  const [analysis, setAnalysis] = useState<api.Analysis | null>(null)
  const [cards, setCards] = useState<Map<string, api.Card>>(new Map())
  const [query, setQuery] = useState('')
  const [queryError, setQueryError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)
  const deckRef = useRef(deck)
  deckRef.current = deck

  const refresh = useCallback(async (current: api.Deck, q: string): Promise<void> => {
    const mine = ++seq.current
    const [recs, ana] = await Promise.all([
      api.getRecommendations(current.id, { limitPerGroup: 8, ...(q === '' ? {} : { query: q }) }),
      api.getAnalysis(current.id),
    ])
    // A slower earlier request must not overwrite a newer answer.
    if (mine !== seq.current) return

    setGroups(recs.groups)
    setUnavailable(recs.unavailable)
    setAnalysis(ana)
    setQueryError(recs.query.errors[0]?.message ?? null)

    const needed = [
      ...current.commanders,
      ...current.entries.map((e) => e.oracleId),
      ...recs.groups.flatMap((g) => g.items.map((i) => i.oracleId)),
    ]
    setCards(await api.hydrate(needed))
  }, [])

  // Keyed on the deck id and version rather than the object: a refetch that
  // returns an identical deck must not trigger another round.
  const deckKey = `${deck.id}:${String(deck.version)}`
  useEffect(() => {
    void refresh(deckRef.current, query).catch(() => undefined)
  }, [deckKey, query, refresh])

  const act = (oracleId: string, type: 'accept' | 'exclude'): void => {
    setBusy(true)
    const command =
      type === 'accept' ? { type, oracleId, origin: 'recommended' } : { type, oracleId }
    void api
      .sendCommands(deck.id, [command], deck.version)
      .then((result) => {
        setDeck(result.deck)
        setBusy(false)
      })
      .catch(() => setBusy(false))
  }

  const accepted = deck.entries.filter((e) => e.zone === 'accepted')
  const excluded = deck.entries.filter((e) => e.zone === 'excluded')
  const deckSize = accepted.length + deck.commanders.length

  const deficits = useMemo(
    () => (analysis?.deficits ?? []).filter((d) => d.delta < 0).slice(0, 8),
    [analysis],
  )

  return (
    <>
      <header className="masthead">
        <h1 className="wordmark">
          Round<span>table</span>
        </h1>
        <span className="meta">
          {deck.name.toUpperCase()} · {deck.colorIdentity.join('') || 'C'} · BRACKET{' '}
          {deck.targetBracket} · {deck.archetype.toUpperCase()}
        </span>
        <span className="meta" style={{ marginLeft: 'auto' }}>
          {deckSize} / 100 CARDS
        </span>
      </header>

      <div className="workspace">
        <section className="region" aria-label="Deck">
          <h2>Deck · {deckSize}</h2>
          {deck.commanders.map((id) => (
            <CardRow key={id} card={cards.get(id)} actions={[]} />
          ))}
          {accepted.map((e, i) => (
            <CardRow
              key={`${e.oracleId}-${String(i)}`}
              card={cards.get(e.oracleId)}
              actions={[
                { label: 'Remove', kind: 'exclude', onClick: () => act(e.oracleId, 'exclude') },
              ]}
            />
          ))}
          {accepted.length === 0 ? (
            <p className="note">Nothing accepted yet. Suggestions are on the right.</p>
          ) : null}

          {excluded.length > 0 ? (
            <>
              <h2 style={{ marginTop: '1rem' }}>Excluded · {excluded.length}</h2>
              <p className="note">These are never suggested again.</p>
              {excluded.map((e) => (
                <CardRow key={e.oracleId} card={cards.get(e.oracleId)} actions={[]} />
              ))}
            </>
          ) : null}
        </section>

        <section className="region" aria-label="Suggestions">
          <h2>Suggestions</h2>
          <div className="field">
            <input
              type="text"
              value={query}
              placeholder="Filter — try  t:creature  or  mv<=3"
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
                <CardRow
                  key={item.oracleId}
                  card={cards.get(item.oracleId)}
                  item={item}
                  actions={[
                    {
                      label: 'Add',
                      kind: 'accept',
                      onClick: () => act(item.oracleId, 'accept'),
                    },
                    {
                      label: 'Never',
                      kind: 'exclude',
                      onClick: () => act(item.oracleId, 'exclude'),
                    },
                  ]}
                />
              ))}
            </div>
          ))}
          {groups.length === 0 ? <p className="note">Working…</p> : null}
          {busy ? <p className="note">Saving…</p> : null}
        </section>

        <section className="region" aria-label="Analysis">
          <h2>Composition</h2>
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
                  <h2 style={{ marginTop: '1.25rem' }}>Combos assembled</h2>
                  {analysis.deckCombos.slice(0, 6).map((c) => (
                    <p className="note" key={c.comboId}>
                      {c.pieces.map((p) => cards.get(p)?.name ?? p.slice(0, 6)).join(' + ')} →{' '}
                      {c.produces.join(', ')}
                    </p>
                  ))}
                </>
              ) : null}

              <h2 style={{ marginTop: '1.25rem' }}>Legality</h2>
              {analysis.legality.problems.length === 0 ? (
                <p className="note">No problems found.</p>
              ) : (
                analysis.legality.problems.slice(0, 6).map((p, i) => (
                  <p className="problem" key={i}>
                    {p.kind}
                  </p>
                ))
              )}
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
