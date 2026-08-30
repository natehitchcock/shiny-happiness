import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import * as api from './api'
import { usePipeline, type Phase } from './pipeline'
import { AUTO_QUERY_MS, useAutoQuery } from './autoquery'
import { dimensionKeysOf, formatDecklist, interactsWith } from '@roundtable/domain'
import { ManaCost, OracleText } from '@roundtable/ui'
import type { SynergyTag } from '@roundtable/domain'
import { DeckMenu } from './DeckMenu'
import { Hint } from './Hint'
import type { Card } from './api'

/** Human-readable label for a composition dimension. */
/**
 * The wire form of a dimension, as a key.
 *
 * `dimensionKey` in the domain takes a branded `CompositionDimension`; the
 * analysis response carries the same two shapes as plain optional strings, so
 * this reads them without a cast through the brand. The FORMAT is the domain's
 * and must stay in step with it — `role:x` / `type:x`.
 */
const dimensionKeyOf = (d: { role?: string; type?: string }): string =>
  d.role === undefined ? `type:${d.type ?? ''}` : `role:${d.role}`

const dimensionName = (d: { role?: string; type?: string }): string => d.role ?? d.type ?? '—'

/** Prices are estimates, and the interface has to say so (ADR-0009 Q7). */
const usd = (value: number | null | undefined): string =>
  value === null || value === undefined ? '—' : `$${value.toFixed(2)}`

/** A cut reason, in words. The badge never shows a bare kind. */
const cutText = (r: {
  kind: string
  dimension?: { role?: string; type?: string }
  over?: number
  manaValue?: number
  limit?: number
}): string => {
  switch (r.kind) {
    case 'role-over-target':
      return `${String(r.over ?? 0)} over on ${dimensionName(r.dimension ?? {})}`
    case 'curve-crowded':
      return `crowded at ${String(r.manaValue ?? 0)}`
    case 'no-combos':
      return 'no combo line'
    case 'no-synergy':
      return 'no synergy'
    case 'unknown-synergy':
      // Deliberately not "no synergy": we derived no tags for this card, which
      // is a statement about our reading of it, not about the card.
      return 'synergy unknown'
    case 'over-budget':
      return `over $${String(r.limit ?? 0)}`
    default:
      return r.kind
  }
}

/** Hover help for the composition filter, spelled out rather than implied. */
const HIDE_SETTLED_HELP =
  'A role disappears from this list once every card in it is locked — there is ' +
  'nothing left to decide there. Tick this to also hide roles that already meet ' +
  'their target but are not locked yet, so only the roles still missing cards remain.'

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
      // Three directions, three different claims. 'theme' is the weak one —
      // the card wants what other cards in the deck want — and it says so
      // rather than borrowing the language of an enable.
      return r.direction === 'payoff'
        ? `benefits from your ${tag}`
        : r.direction === 'theme'
          ? `shares your ${tag} theme`
          : `enables your ${tag}`
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
/**
 * Which combos, not just how many.
 *
 * A number told you a card completed three combos and gave you no way to find
 * out which three — so the only way to check the app's headline claim was to go
 * looking for it elsewhere. Both the badge and the "completes N combos" reason
 * open the same list, because a reader will reach for whichever they are
 * nearest.
 *
 * Named from the client's own hydrated cards: every piece of a COMPLETED combo
 * is by definition already in the deck.
 */
const ComboList = ({
  combos,
  cards,
  lockedIds,
  self,
}: {
  combos: readonly api.Recommendation['combos'][number][]
  cards: ReadonlyMap<string, api.Card>
  lockedIds: ReadonlySet<string>
  self: string
}): React.JSX.Element => {
  if (combos.length === 0) return <span className="hint-line">No combo detail available.</span>
  return (
    <>
      {combos.slice(0, 6).map((c) => (
        <span className="hint-line" key={c.id}>
          <span className="combo-pieces">
            {c.pieces
              .filter((piece) => piece !== self)
              .map((piece) => (
                <span className="partner" data-locked={lockedIds.has(piece)} key={piece}>
                  {cards.get(piece)?.name ?? 'a card in your deck'}
                </span>
              ))}
          </span>
          <span className="combo-produces">{c.produces.join(', ')}</span>
        </span>
      ))}
      {combos.length > 6 ? (
        <span className="hint-line dim">and {combos.length - 6} more.</span>
      ) : null}
    </>
  )
}

const Degree = ({
  degree,
  near,
  combos = [],
  cards,
  lockedIds,
  self,
}: {
  degree: number
  near: number
  combos?: readonly api.Recommendation['combos'][number][]
  cards?: ReadonlyMap<string, api.Card>
  lockedIds?: ReadonlySet<string>
  self?: string
}): React.JSX.Element => {
  const value = degree > 0 ? degree : near
  const label =
    degree > 0
      ? `Completes ${String(degree)} combos`
      : near > 0
        ? `One card away from ${String(near)} combos`
        : 'No combos'

  const badge = (
    <span className="degree" data-completes={degree > 0} data-empty={value === 0}>
      {value === 0 ? '·' : value}
    </span>
  )

  // Nothing to open unless we actually hold the combos. A hint that says
  // "no detail" on every row would be worse than the plain badge.
  if (combos.length === 0 || cards === undefined) {
    return (
      <span className="degree-wrap" title={label} aria-label={label}>
        {badge}
      </span>
    )
  }

  return (
    <Hint
      className="degree-hint"
      label={label}
      content={
        <>
          <strong>{label}</strong>
          <ComboList
            combos={combos}
            cards={cards}
            lockedIds={lockedIds ?? new Set()}
            self={self ?? ''}
          />
        </>
      }
    >
      {badge}
    </Hint>
  )
}

/**
 * The two costs a card has: what it costs to cast, and what it costs to buy.
 *
 * Fixed-width columns so both read straight down the list rather than jittering
 * with each card's name length. Mana cost is drawn as symbols by `ManaCost`
 * (ADR-0015), which carries its own screen-reader text — the `title` that used
 * to be the only label here would not have survived that change.
 */
const Costs = ({
  manaCost,
  price,
}: {
  manaCost: string | null | undefined
  price: number | null | undefined
}): React.JSX.Element => (
  <>
    <span className="mana">
      <ManaCost cost={manaCost} />
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
      <span className="cost">
        <ManaCost cost={card?.manaCost} />
      </span>
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
  /**
   * What was actually searched for, as opposed to what is typed.
   *
   * The two were the same thing when every keystroke fired a request. They are
   * separate now because the search is committed — by the countdown, by the
   * button, or by Enter — which is the same arrangement the suggestion filter
   * uses, and for the same reason: a search is expensive and half a commander's
   * name is not a question worth asking.
   */
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<api.Card[]>([])
  const [chosen, setChosen] = useState<api.Card | null>(null)
  /**
   * What the search is doing, so the box is never silently empty.
   *
   * "Nothing on screen" was the same picture for four different situations:
   * still typing, request in flight, no matches, and the API failing. That is
   * how an empty database presents as a broken text box — there is nothing to
   * read and nothing to try next.
   */
  const [search, setSearch] = useState<'idle' | 'searching' | 'done' | 'failed'>('idle')
  const [searchError, setSearchError] = useState<string | null>(null)
  const [archetype, setArchetype] = useState('midrange')
  const [bracket, setBracket] = useState(3)
  const [noUB, setNoUB] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  /**
   * The same countdown the suggestion filter uses, on the same constant.
   *
   * Two characters is the floor — one letter matches most of Magic — and below
   * it nothing is pending, so nothing counts down.
   */
  const auto = useAutoQuery(
    { enabled: term.trim().length >= 2, draft: term, committed: query },
    () => setQuery(term),
  )

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setSearch('idle')
      setSearchError(null)
      return
    }
    let cancelled = false
    setSearch('searching')
    void api
      // Only legendary creatures can lead a deck, so the search says so
      // rather than offering every card and rejecting the choice later.
      .searchCards(`${query} type:legendary type:creature`, {
        excludeUniversesBeyond: noUB,
      })
      .then((r) => {
        if (cancelled) return
        setResults(r.items)
        setSearch('done')
        setSearchError(null)
      })
      .catch((e: unknown) => {
        if (cancelled) return
        // Surfaced, not swallowed. The old version discarded the error and
        // rendered an empty list, so an unreachable or empty API looked
        // exactly like a commander that does not exist.
        setResults([])
        setSearch('failed')
        setSearchError(e instanceof Error ? e.message : 'Could not reach the card search')
      })
    return () => {
      cancelled = true
    }
  }, [query, noUB])

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
        <div className="filter-bar">
          <input
            id="commander"
            type="text"
            value={chosen?.name ?? term}
            placeholder="Search legendary creatures…"
            onChange={(e) => {
              setChosen(null)
              setTerm(e.target.value)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') setQuery(term)
            }}
          />
          <SearchButton
            what="search"
            onRun={() => setQuery(term)}
            remaining={auto.remaining}
            restartKey={term}
            busy={search === 'searching'}
          />
        </div>
      </div>

      {chosen === null ? (
        <div className="start-results">
          {/* No "searching…" line here: the button IS the spinner, and saying
              it in two places is one place too many. */}
          {search === 'failed' ? (
            <p className="problem">
              {searchError} — the card search is not answering, so no commander can be picked yet.
            </p>
          ) : null}

          {search === 'done' && results.length === 0 ? (
            <p className="problem">
              Nothing found.
              <span className="note">
                {' '}
                No legendary creature matches “{query}”.
                {noUB ? ' Universes Beyond cards are excluded — try unchecking that.' : ''}
              </span>
            </p>
          ) : null}

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

      <button
        className="primary"
        disabled={chosen === null || busy}
        onClick={create}
        // A disabled button with no explanation is a dead end. This one is
        // disabled for exactly one reason, so it can say so.
        title={chosen === null ? 'Pick a commander first' : 'Create this deck'}
      >
        {busy ? 'Creating…' : 'Start building'}
      </button>
      {chosen === null ? <p className="note">Pick a commander to continue.</p> : null}
      {error !== null ? <p className="problem">{error}</p> : null}
    </div>
  )
}

/** Cards the deck holds, collapsed to one row per card with a count. */
interface DeckLine {
  oracleId: string
  copies: number
}

/**
 * What this card is keyed to, and what that pairs with.
 *
 * The scoring already reasons in these events — `enables your sacrifice fodder`
 * is a reason it gives — but they were only ever visible as the conclusion, one
 * tag at a time. This is the whole set, on the card itself.
 *
 * `produces` and `wants` are kept apart because the difference is the entire
 * model: a sacrifice outlet PRODUCES creature-death, a death trigger WANTS it,
 * and a list that merged them would say both cards were "about" the same thing
 * while hiding that one is the other's answer.
 */
const TAG_WORDS: Readonly<Record<string, string>> = {
  'creature-death': 'a creature dying',
  token: 'making tokens',
  lifegain: 'gaining life',
  lifeloss: 'opponents losing life',
  'card-draw': 'drawing cards',
  discard: 'discarding',
  'graveyard-creature': 'creatures in the graveyard',
  'artifact-etb': 'artifacts entering',
  landfall: 'lands entering',
  'plus1-counter': '+1/+1 counters',
  'attack-trigger': 'attacking',
  untap: 'untapping',
  treasure: 'treasure',
  'sacrifice-fodder': 'expendable bodies',
}

const readable = (tag: string): string => TAG_WORDS[tag] ?? tag.replace(/-/g, ' ')

const TagChip = ({
  tag,
  direction,
}: {
  tag: string
  direction: 'produces' | 'wants'
}): React.JSX.Element => {
  const partners = interactsWith(tag as SynergyTag)
  const opposite = direction === 'produces' ? 'wants' : 'produces'
  return (
    <Hint
      className="tag-hint"
      content={
        <>
          <strong>{readable(tag)}</strong>
          <span className="hint-line">
            {direction === 'produces'
              ? `This card causes it. It pairs with cards that benefit from ${readable(tag)}.`
              : `This card benefits from ${readable(tag)}. It pairs with cards that cause it.`}
          </span>
          {partners.length === 0 ? null : (
            <span className="hint-line">
              Benefits, and benefits from: {partners.map(readable).join(', ')}.
            </span>
          )}
          {/* The tag is a filter field as well as a label, and nothing else on
              screen says so. Both spellings are given because both work, and
              because `tag:` — either side — is usually what someone reading a
              chip actually wants. */}
          <span className="hint-line">
            Filter by it:{' '}
            <code>
              {direction}:{tag}
            </code>
            , or <code>tag:{tag}</code> for cards on either side.
          </span>
          <span className="hint-line dim">
            Derived from the rules text, so it is sometimes wrong — {opposite} is the other half of
            the same question.
          </span>
        </>
      }
    >
      <span className="tag" data-direction={direction}>
        {tag.replace(/-/g, ' ')}
      </span>
    </Hint>
  )
}

const Semantics = ({
  produces,
  wants,
}: {
  produces: readonly string[]
  wants: readonly string[]
}): React.JSX.Element => {
  if (produces.length === 0 && wants.length === 0) {
    // Half the corpus derives no tags at all (ADR-0013). Saying so beats an
    // empty heading, which would read as "this card interacts with nothing".
    return (
      <>
        <h4>Semantics</h4>
        <p className="note">
          None derived. Our rules-text reading misses about half of Magic, so this is a gap in what
          we can see rather than a card that does nothing.
        </p>
      </>
    )
  }
  return (
    <>
      <h4>Semantics</h4>
      {produces.length > 0 ? (
        <p className="tags">
          <span className="tags-label">Causes</span>
          {produces.map((t) => (
            <TagChip key={t} tag={t} direction="produces" />
          ))}
        </p>
      ) : null}
      {wants.length > 0 ? (
        <p className="tags">
          <span className="tags-label">Benefits from</span>
          {wants.map((t) => (
            <TagChip key={t} tag={t} direction="wants" />
          ))}
        </p>
      ) : null}
    </>
  )
}

/**
 * Who this card actually works with, in the deck the user has.
 *
 * The preview already said "in 114 combos" and "causes: token", both of which
 * are facts about the card in the abstract. Neither answers the question a
 * person opens a preview to ask, which is "does this do anything for MY deck".
 *
 * Everything here is computed on the client. The deck, the hydrated cards and
 * their synergy tags are all already in memory, and the combo pieces arrive
 * named with the card detail — so opening a preview costs one request and the
 * answer is drawn from what is already known, rather than a second round trip.
 */
interface Partner {
  readonly oracleId: string
  readonly name: string
  readonly locked: boolean
  /** Not in the deck — the piece you would have to add. */
  readonly missing?: boolean
  readonly why?: string
}

const PartnerName = ({ p }: { p: Partner }): React.JSX.Element => (
  <span
    className="partner"
    data-locked={p.locked}
    data-missing={p.missing === true}
    title={
      p.missing === true
        ? `${p.name} is not in your deck yet`
        : p.locked
          ? `${p.name} — locked`
          : p.name
    }
  >
    {p.name}
    {p.why === undefined ? null : <span className="partner-why"> {p.why}</span>}
  </span>
)

const Works = ({
  detail,
  accepted,
  lockedIds,
  cards,
}: {
  detail: api.CardDetail
  accepted: ReadonlySet<string>
  lockedIds: ReadonlySet<string>
  cards: ReadonlyMap<string, api.Card>
}): React.JSX.Element | null => {
  const self = detail.oracleId

  const partner = (oracleId: string, name: string | null, why?: string): Partner => ({
    oracleId,
    name: name ?? cards.get(oracleId)?.name ?? 'Unknown card',
    locked: lockedIds.has(oracleId),
    missing: !accepted.has(oracleId),
    ...(why === undefined ? {} : { why }),
  })

  // Combos this card completes with cards already accepted.
  const assembled: Partner[] = []
  // Combos needing exactly one more card — the near miss worth showing.
  const oneAway: { readonly needs: Partner; readonly with: readonly Partner[] }[] = []

  for (const combo of detail.combos) {
    const others = combo.pieces.filter((p) => p.oracleId !== self)
    if (others.length === 0) continue
    const missing = others.filter((p) => !accepted.has(p.oracleId))
    if (missing.length === 0) {
      for (const p of others) assembled.push(partner(p.oracleId, p.name))
    } else if (missing.length === 1 && oneAway.length < 6) {
      const need = missing[0]!
      oneAway.push({
        needs: partner(need.oracleId, need.name),
        with: others
          .filter((p) => p.oracleId !== need.oracleId)
          .map((p) => partner(p.oracleId, p.name)),
      })
    }
  }

  // Deck cards whose synergy tags pair with this card's, strongest first.
  const produces = new Set(detail.synergyProduces)
  const wants = new Set(detail.synergyWants)
  const synergy: Partner[] = []
  for (const oracleId of accepted) {
    if (oracleId === self) continue
    const other = cards.get(oracleId)
    if (other === undefined) continue
    const benefits = other.synergyWants.filter((t) => produces.has(t))
    const causes = other.synergyProduces.filter((t) => wants.has(t))
    const tag = benefits[0] ?? causes[0]
    if (tag === undefined) continue
    // Said of the OTHER card, in the same two words the Semantics headings use.
    // "wants creature death" was the odd one out and the vaguest of the three.
    synergy.push(
      partner(
        oracleId,
        other.name,
        `— ${benefits[0] !== undefined ? 'benefits from' : 'causes'} ${tag.replace(/-/g, ' ')}`,
      ),
    )
  }

  const dedupe = (list: readonly Partner[]): Partner[] => {
    const seen = new Set<string>()
    return list.filter((p) => (seen.has(p.oracleId) ? false : (seen.add(p.oracleId), true)))
  }
  const combosWith = dedupe(assembled).slice(0, 8)
  // Locked first: those are cards the user has committed to, so a pairing with
  // one is worth more than a pairing with a card they may still cut.
  const synergyWith = dedupe(synergy)
    .sort((a, b) => Number(b.locked) - Number(a.locked))
    .slice(0, 8)

  if (combosWith.length === 0 && oneAway.length === 0 && synergyWith.length === 0) return null

  return (
    <>
      <h4>Works with your deck</h4>

      {combosWith.length > 0 ? (
        <p className="partners">
          <span className="partners-label">Combos with</span>
          {combosWith.map((p) => (
            <PartnerName key={p.oracleId} p={p} />
          ))}
        </p>
      ) : null}

      {combosWith.length === 0 && oneAway.length > 0 ? (
        <>
          <p className="partners-note">
            No combo assembled yet — these need one more card, shown in rust:
          </p>
          {oneAway.map((line) => (
            <p className="partners" key={line.needs.oracleId}>
              <PartnerName p={line.needs} />
              {line.with.length === 0 ? null : (
                <>
                  <span className="partners-label">with</span>
                  {line.with.map((p) => (
                    <PartnerName key={p.oracleId} p={p} />
                  ))}
                </>
              )}
            </p>
          ))}
        </>
      ) : null}

      {synergyWith.length > 0 ? (
        <p className="partners">
          <span className="partners-label">Synergises with</span>
          {synergyWith.map((p) => (
            <PartnerName key={p.oracleId} p={p} />
          ))}
        </p>
      ) : null}
    </>
  )
}

const Preview = ({
  card,
  detail,
  price,
  onClose,
  accepted,
  lockedIds,
  cards,
}: {
  /** The hydrated card, already in memory. Everything readable comes from here. */
  card: api.Card | undefined
  /** Printings and combos. Arrives second; the panel does not wait for it. */
  detail: api.CardDetail | null
  price: number | null | undefined
  onClose: () => void
  accepted: ReadonlySet<string>
  lockedIds: ReadonlySet<string>
  cards: ReadonlyMap<string, api.Card>
}): React.JSX.Element | null => {
  // `detail` is the fallback, not the source: a card reached from somewhere that
  // never hydrated it still previews once its detail lands.
  const shown = card ?? detail
  if (shown === null || shown === undefined) return null
  return (
    <aside className="preview" aria-label={`${shown.name} details`}>
      <div className="preview-head">
        <h3>{shown.name}</h3>
        <button className="act" onClick={onClose} aria-label="Close preview">
          Close
        </button>
      </div>
      <p className="type-line">
        {shown.typeLine}
        {shown.manaCost === null ? null : (
          <span className="cost">
            <ManaCost cost={shown.manaCost} />
          </span>
        )}
        {/* Power/toughness for a creature, loyalty for a planeswalker. Printed
            as text because Magic prints `*` and `1+*`, and a card whose power
            is `*` has a power — it is simply not a number.

            `??` and not `!== null`: a card hydrated before this field existed
            has `undefined`, which is not null and so passed the old guard —
            rendering an empty box with a lone slash in it. */}
        {(shown.power ?? null) !== null && (shown.toughness ?? null) !== null ? (
          <span className="pt" aria-label={`power ${shown.power}, toughness ${shown.toughness}`}>
            {shown.power}/{shown.toughness}
          </span>
        ) : (shown.loyalty ?? null) !== null ? (
          <span className="pt" aria-label={`starting loyalty ${shown.loyalty}`}>
            {shown.loyalty}
          </span>
        ) : null}
      </p>
      {/* Oracle text is the card. Newlines are meaningful — they separate
          abilities — so it is rendered pre-wrapped rather than collapsed. */}
      <p className="oracle">
        <OracleText text={shown.oracleText} />
      </p>
      <p className="note">
        {usd(price)} <span className="estimate">est.</span>
        {/* The printing count is the one readable fact only the server has, so
            it appears when it appears rather than holding the panel back. */}
        {detail === null
          ? ''
          : ` · ${String(detail.printings.length)} printing${detail.printings.length === 1 ? '' : 's'}`}
        {shown.universesBeyond ? ' · Universes Beyond' : ''}
      </p>
      {detail !== null && detail.combos.length > 0 ? (
        <>
          <h4>In {plural(detail.combos.length, 'combo')}</h4>
          <p className="note">
            {[...new Set(detail.combos.flatMap((c) => c.produces))].slice(0, 6).join(', ')}
          </p>
        </>
      ) : null}

      {detail === null ? (
        <p className="note">Looking up combos…</p>
      ) : (
        <Works detail={detail} accepted={accepted} lockedIds={lockedIds} cards={cards} />
      )}

      <Semantics produces={shown.synergyProduces} wants={shown.synergyWants} />
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
const Curve = ({
  curve,
  locked,
}: {
  curve: api.Analysis['curve']
  /**
   * Locked cards per bucket, from the client rather than from `curve.locked`.
   *
   * The server's copy is a snapshot from the last recompute, and locking no
   * longer triggers one — so the gold has to come from the deck on screen.
   */
  locked: readonly number[]
}): React.JSX.Element => {
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
              aria-label={`Mana value ${String(d.bucket)}: ${String(d.actual)} cards (${String(locked[d.bucket] ?? 0)} locked), target range ${String(d.min)} to ${String(d.max)}, ${label}`}
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
              >
                {/* The committed portion. Gold is the colour of a decision
                    everywhere in this app, so a locked card reads the same way
                    in the curve as it does in the deck. */}
                <div
                  className="curve-locked"
                  style={{
                    height: `${String(Math.min(100, ((locked[d.bucket] ?? 0) / Math.max(1, d.actual)) * 100))}%`,
                  }}
                />
              </div>
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
        {/* All three states named, not just the two problems. The colours sit
            in the 6–8 CVD band (see tokens.ts), so the key is not a nicety —
            it is the second signal that makes them tellable apart. */}
        <i className="balanced">in range</i>
        <i className="short">short</i>
        <i className="over">too many</i>
        <span>— band is the target range</span>
      </p>
    </>
  )
}

/**
 * Send a command batch, retrying a transient failure.
 *
 * Four attempts, the delay doubling to a one-second ceiling. Losing a batch
 * means the user's clicks silently disappear, so a blip on the wire should not
 * cost them work — but a 400 will not become a 200 by being repeated, and a 409
 * needs a new version rather than patience, so only network faults and 5xx are
 * retried.
 *
 * Shared by the accept batch and the lock, which want the same behaviour for
 * the same reason.
 */
const BACKOFF_MS = [100, 200, 400, 800]

const sendWithRetry = async (
  deckId: string,
  body: Parameters<typeof api.sendCommands>[1],
  version: number,
): ReturnType<typeof api.sendCommands> => {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await api.sendCommands(deckId, body, version)
    } catch (error) {
      const status = error instanceof api.ApiError ? error.status : 0
      const transient = status === 0 || status >= 500
      if (!transient || attempt >= BACKOFF_MS.length) throw error
      await new Promise((resolve) => setTimeout(resolve, BACKOFF_MS[attempt]))
    }
  }
}

interface PendingCommand {
  readonly type: 'accept' | 'exclude' | 'remove' | 'lock' | 'restore'
  readonly oracleId: string
  readonly locked?: boolean
}

/**
 * Fetch the extra rows for every group the user has expanded.
 *
 * One request for all of them, narrowed to those keys. `combo` is a client-side
 * merge of the three `combo-N` keys the server actually emits (see
 * `shownGroups`), so it is translated on the way out and re-merged on the way
 * back — the merge is a heading decision and does not belong in the request.
 */
const expansionsFor = async (
  deckId: string,
  keys: ReadonlySet<string>,
  query = '',
  columns: readonly string[] = [],
): Promise<ReadonlyMap<string, readonly api.Recommendation[]>> => {
  if (keys.size === 0) return new Map()
  const wanted = [...keys].flatMap((k) => (k === 'combo' ? ['combo-2', 'combo-3', 'combo-4'] : [k]))
  const more = await api.getRecommendations(deckId, {
    limitPerGroup: 32,
    groups: wanted,
    ...(query === '' ? {} : { query }),
    ...(columns.length > 0 ? { columns } : {}),
  })
  const out = new Map<string, readonly api.Recommendation[]>()
  for (const key of keys) {
    out.set(
      key,
      key === 'combo'
        ? more.groups.filter((g) => g.key.startsWith('combo-')).flatMap((g) => g.items)
        : (more.groups.find((g) => g.key === key)?.items ?? []),
    )
  }
  return out
}

interface QueryResult {
  readonly deck: api.Deck
  readonly recs: api.Recommendations
  readonly analysis: api.Analysis
  readonly hydrated: api.Hydrated
  /**
   * Extra rows for groups the user has expanded, keyed by group.
   *
   * Re-fetched with every recompute rather than kept from the expand click.
   * An expansion held across a recompute is stale in the worst way: the rows
   * were chosen for a deck that no longer exists, so a card the user had just
   * added came straight back into the list — the same defect as the superseded
   * run, arriving by a different route.
   */
  readonly extra: ReadonlyMap<string, readonly api.Recommendation[]>
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

/**
 * The magnifying glass, with the auto-query countdown drawn around it.
 *
 * The ring is a CSS animation rather than a JavaScript-driven redraw: ten
 * seconds at 60 fps is six hundred renders to move one circle, and the browser
 * interpolates it for free. `key` restarts the animation whenever the draft
 * changes, which is what makes "any adjustment resets the clock" visible.
 *
 * Colour is not the signal here, and neither is the ring on its own — the
 * button's accessible name counts down in words, so someone who cannot see the
 * ring still knows a query is coming and how long they have to stop it.
 */
/**
 * The column queries, under the filter bar, each sitting over its own column.
 *
 * A chip that just says `mv<=3` in a row of chips makes you count ticks to work
 * out which column it names. Aligning it removes that step: the label is
 * directly above the column it describes.
 *
 * Measured from the DOM rather than reconstructed in CSS. The columns sit in a
 * flex row after a flexible name and before the costs and the buttons, so their
 * position depends on text that only the browser knows the width of. Mirroring
 * that with a second set of spacers would be a copy that silently drifts the
 * first time a button's label changes; asking where the column actually IS
 * cannot drift.
 *
 * Each chip gets its own line, right-aligned to its column's centre, because
 * columns are 1.6rem apart and the queries are not.
 */
const ColumnLegend = ({
  columns,
  onRemove,
  measureRoot,
}: {
  columns: readonly string[]
  onRemove: (query: string) => void
  measureRoot: React.RefObject<HTMLElement | null>
}): React.JSX.Element | null => {
  const barRef = useRef<HTMLDivElement>(null)
  /** Distance from the bar's right edge to each column's centre, in px. */
  const [insets, setInsets] = useState<readonly number[] | null>(null)

  useLayoutEffect(() => {
    if (columns.length === 0) {
      setInsets(null)
      return
    }
    const measure = (): void => {
      const bar = barRef.current
      const root = measureRoot.current
      if (bar === null || root === null) return
      const cells = [...root.querySelectorAll('.card-row .col-cell')].slice(0, columns.length)
      // Before the first result lands there is nothing to align to. Falling
      // back to the plain row is better than pinning chips to a guess.
      if (cells.length !== columns.length) {
        setInsets(null)
        return
      }
      const barRight = bar.getBoundingClientRect().right
      setInsets(
        cells.map((cell) => {
          const box = cell.getBoundingClientRect()
          return barRight - (box.left + box.width / 2)
        }),
      )
    }
    measure()

    // The columns move whenever the pane is resized or the rows reflow, and
    // neither fires a React render.
    const observer = new ResizeObserver(measure)
    if (barRef.current !== null) observer.observe(barRef.current)
    if (measureRoot.current !== null) observer.observe(measureRoot.current)
    return () => observer.disconnect()
  }, [columns, measureRoot])

  if (columns.length === 0) return null
  const aligned = insets !== null

  return (
    <div
      className="columns"
      ref={barRef}
      data-aligned={aligned}
      style={aligned ? { height: `${String(columns.length * 1.4)}rem` } : undefined}
      aria-label="Columns"
    >
      {columns.map((c, i) => (
        <span
          className="column-chip"
          key={c}
          style={
            aligned
              ? { right: `${String(insets[i] ?? 0)}px`, top: `${String(i * 1.4)}rem` }
              : undefined
          }
        >
          <code>{c}</code>
          <button className="act" onClick={() => onRemove(c)} aria-label={`Remove the ${c} column`}>
            ×
          </button>
        </span>
      ))}
    </div>
  )
}

/**
 * A search button that can be counting down, or working.
 *
 * Shared by the suggestion filter and the commander search so the two are the
 * same object rather than two things that look alike. The countdown ring is a
 * CSS animation restarted by `key`; ten seconds redrawn from JavaScript would
 * be six hundred renders to move one circle.
 *
 * Three states, and only one is ever on screen: idle (a magnifying glass),
 * counting down (a ring filling around it), and busy (a spinner). Busy wins,
 * because a query already in flight cannot also be pending.
 */
const SearchButton = ({
  onRun,
  remaining,
  restartKey,
  busy = false,
  what = 'filter',
}: {
  readonly onRun: () => void
  readonly remaining: number | null
  readonly restartKey: string
  readonly busy?: boolean
  /** The noun in the label — "filter" or "search". */
  readonly what?: string
}): React.JSX.Element => {
  const verb = what === 'filter' ? 'Run this filter' : `Run this ${what}`
  const label = busy
    ? `Searching…`
    : remaining === null
      ? verb
      : `${verb} — runs on its own in ${String(remaining)} second${remaining === 1 ? '' : 's'}`
  return (
    <button className="act search" onClick={onRun} disabled={busy} aria-label={label} title={label}>
      {busy || remaining === null ? null : (
        <svg className="ring" viewBox="0 0 28 28" aria-hidden="true">
          <circle className="ring-track" cx="14" cy="14" r="12" />
          <circle
            key={restartKey}
            className="ring-fill"
            cx="14"
            cy="14"
            r="12"
            style={{ animationDuration: `${String(AUTO_QUERY_MS)}ms` }}
          />
        </svg>
      )}
      {busy ? (
        <span className="spinner" aria-hidden="true" />
      ) : (
        <span aria-hidden="true">{'⌕'}</span>
      )}
      {/* Announced politely so a screen reader hears the countdown start
          without it interrupting whatever is being read. */}
      <span className="sr" role="status">
        {busy
          ? 'Searching'
          : remaining === null
            ? ''
            : `Runs on its own in ${String(remaining)} seconds`}
      </span>
    </button>
  )
}

export const Workspace = ({
  deck: initial,
  onSwitch,
  onNew,
}: {
  deck: api.Deck
  /** Open another deck on this device. */
  onSwitch?: (id: string) => void
  /** Back to the start screen to build a new one. */
  onNew?: () => void
}): React.JSX.Element => {
  const [deck, setDeck] = useState(initial)
  const [groups, setGroups] = useState<api.Group[]>([])
  const [unavailable, setUnavailable] = useState<api.Unavailable[]>([])
  const [analysis, setAnalysis] = useState<api.Analysis | null>(null)
  const [cards, setCards] = useState<Map<string, api.Card>>(new Map())
  const [prices, setPrices] = useState<Map<string, number | null>>(new Map())
  const [query, setQuery] = useState('')
  const [queryError, setQueryError] = useState<string | null>(null)
  const [detail, setDetail] = useState<api.CardDetail | null>(null)
  /** Which card the preview is showing, known before its detail arrives. */
  const [inspect, setInspect] = useState<string | null>(null)
  /** Locks the server has not answered yet — these rows show a spinner. */
  const [locking, setLocking] = useState<ReadonlySet<string>>(new Set())
  /**
   * How many faults a card needs before its cut hints are shown.
   *
   * Two by default, because one is usually not a signal. The roles are close to
   * mutually exclusive in practice: a card that completes a combo often has no
   * derived synergy, and a card with strong synergy is often in no combo. Each
   * of those cards has exactly one flaw, and flagging them all buries the card
   * that has three.
   *
   * Per browser, not per deck — it is a reading preference about how much noise
   * to tolerate, not a property of the deck.
   */
  /**
   * Groups the user has collapsed, and the extra rows an expand has fetched.
   *
   * Collapsing is purely visual and purely local — "I am done with this one for
   * now" is not a fact about the deck and has no business going to the server.
   * Expanding is the opposite: it asks for MORE rows in one group, which only
   * the server can answer.
   */
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set())
  const [extraItems, setExtraItems] = useState<ReadonlyMap<string, readonly api.Recommendation[]>>(
    new Map(),
  )
  const [expanding, setExpanding] = useState<string | null>(null)

  const [cutThreshold, setCutThreshold] = useState<number>(() => {
    const saved = Number(localStorage.getItem('lw.cutThreshold'))
    return Number.isInteger(saved) && saved >= 1 && saved <= 4 ? saved : 2
  })
  useEffect(() => {
    localStorage.setItem('lw.cutThreshold', String(cutThreshold))
  }, [cutThreshold])
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
  const [hideSettledRoles, setHideSettledRoles] = useState(false)
  /**
   * Queries promoted to columns.
   *
   * A column does NOT filter. It evaluates the query per row and shows a tick,
   * so the ordering stays the general one — combo degree, synergy, curve — and
   * the column is an extra fact about each card rather than a different list.
   * That is the difference between "show me only X" and "which of these are X".
   */
  const [columns, setColumns] = useState<readonly string[]>([])
  const [columnMatches, setColumnMatches] = useState<Map<string, Set<string>>>(new Map())
  const [draftQuery, setDraftQuery] = useState('')
  /**
   * Run the filter on its own if the box sits untouched.
   *
   * Kept in localStorage rather than on the deck. It changes nothing about what
   * the deck IS or what gets recommended — it is a preference about this
   * browser, and putting it on the deck record would mean a domain contract
   * change and a round-trip for a checkbox. It sits under Deck options because
   * that is where the other filter-shaping controls are, not because it is
   * deck state.
   */
  const [autoQuery, setAutoQuery] = useState<boolean>(
    // On by default, and only off if the user turned it off. Absent is not the
    // same as 'off': the first is "never expressed a view", the second is a
    // decision, and defaulting the first to off meant most people never saw the
    // feature at all.
    () => localStorage.getItem('lw.autoQuery') !== 'off',
  )
  useEffect(() => {
    localStorage.setItem('lw.autoQuery', autoQuery ? 'on' : 'off')
  }, [autoQuery])

  const auto = useAutoQuery({ enabled: autoQuery, draft: draftQuery, committed: query }, () =>
    setQuery(draftQuery),
  )
  const [notice, setNotice] = useState<string | null>(null)
  const deckRef = useRef(deck)
  const queryRef = useRef(query)
  const columnsRef = useRef<readonly string[]>([])
  /** Groups the user has asked for more of. Read by `load` on every recompute. */
  const expandedRef = useRef<ReadonlySet<string>>(new Set())
  /**
   * The newest deck the server has acknowledged, applied to the UI or not.
   *
   * `deckRef` is what the user is looking at; this is what the server believes.
   * They diverge for the length of a settle, and every write has to use this
   * one or it will be arguing with a version that moved on.
   */
  const serverDeckRef = useRef<api.Deck | null>(null)
  /** The suggestions region, so the column legend can find the columns in it. */
  const suggestionsRef = useRef<HTMLElement>(null)

  /**
   * Locks the user has set that no server response has confirmed yet.
   *
   * A requery reads the deck when it STARTS and writes it back when it lands,
   * seconds later. Anything set in between was overwritten — lock a card during
   * a recompute and the icon sprang back open when the answer arrived. Accepts
   * never had this problem because they go through the pipeline's own buffer;
   * locks deliberately do not any more, so they need their own overlay.
   *
   * A ref, not state: it is read while applying a server response, and having
   * that read schedule another render would be a loop.
   */
  const pendingLocks = useRef(new Map<string, boolean>())

  /** Re-assert unconfirmed locks over any deck the server hands back. */
  const withPendingLocks = useCallback((d: api.Deck): api.Deck => {
    if (pendingLocks.current.size === 0) return d
    return {
      ...d,
      entries: d.entries.map((e) => {
        const locked = pendingLocks.current.get(e.oracleId)
        return locked === undefined || e.zone !== 'accepted' ? e : { ...e, locked }
      }),
    }
  }, [])
  deckRef.current = deck
  queryRef.current = query
  // This assignment was missing, and nothing caught it: columns were added to
  // the UI, the request never carried them, and every cell rendered the "no"
  // dot. Kept beside the other two so the set reads as one block.
  columnsRef.current = columns

  const load = useCallback(async (commands: readonly PendingCommand[]): Promise<QueryResult> => {
    /*
     * The version the SERVER last confirmed — not the one on screen.
     *
     * During the settle a result is deliberately held back and not applied, so
     * `deck` state still carries the version from before the batch while the
     * server has already moved on. Adding another card in that window is
     * exactly what the settle exists to allow, and it was sending the stale
     * version and getting a 409 for it. The bug was a direct consequence of
     * holding the result: the UI's version stopped being the truth the moment
     * the settle was introduced.
     */
    let current = serverDeckRef.current ?? deckRef.current

    /*
     * Retry a failed send before giving up on the user's clicks.
     *
     * Losing a batch means the cards the user added silently disappear, so a
     * blip on the wire should not cost them work. Four attempts with the delay
     * doubling to a one-second ceiling — long enough to ride out a cold start
     * or a dropped connection, short enough that a genuine outage is reported
     * rather than hidden behind a spinner.
     *
     * The run stays unresolved for the whole of it, which is what keeps the
     * progress bar pinned at its halfway mark: the second half of the bar means
     * "the answer is in hand", and during a retry it is not.
     *
     * Only transient failures. A 400 will not become a 200 by being repeated,
     * and a 409 is handled separately — it needs a new version, not patience.
     */
    const wire = (c: PendingCommand): Parameters<typeof api.sendCommands>[1][number] =>
      c.type === 'accept'
        ? { type: 'accept', oracleId: c.oracleId, origin: 'manual' }
        : c.type === 'lock'
          ? { type: 'lock', oracleId: c.oracleId, locked: c.locked ?? true }
          : { type: c.type, oracleId: c.oracleId }

    // Commands first, as ONE batch — four accepts are one round trip, and one
    // atomic unit the server can reject or apply as a whole (doc 10 §10.3).
    if (commands.length > 0) {
      const body = commands.map(wire)
      try {
        const result = await sendWithRetry(current.id, body, current.version)
        current = result.deck
      } catch (error) {
        // A 409 means only that our version is behind — the clicks are still
        // valid. Re-read the deck and send them once more, rather than dropping
        // work the user did and making them click it again.
        if (!(error instanceof api.ApiError) || error.status !== 409) throw error
        const fresh = await api.getDeck(current.id)
        const result = await sendWithRetry(fresh.id, body, fresh.version)
        current = result.deck
      }
      serverDeckRef.current = current
    }

    const [recs, ana] = await Promise.all([
      api.getRecommendations(current.id, {
        limitPerGroup: 8,
        ...(queryRef.current === '' ? {} : { query: queryRef.current }),
        ...(columnsRef.current.length > 0 ? { columns: columnsRef.current } : {}),
      }),
      api.getAnalysis(current.id),
    ])
    // Expansions are re-asked against the deck the recompute just produced, so
    // every row on screen describes the same deck. One extra request, and only
    // when the user has actually expanded something.
    const extra = await expansionsFor(
      current.id,
      expandedRef.current,
      queryRef.current,
      columnsRef.current,
    )

    const hydrated = await api.hydrate([
      ...current.commanders,
      ...current.entries.map((e) => e.oracleId),
      ...recs.groups.flatMap((g) => g.items.map((i) => i.oracleId)),
      ...[...extra.values()].flatMap((items) => items.map((i) => i.oracleId)),
    ])
    return { deck: current, recs, analysis: ana, hydrated, extra }
  }, [])

  const pipeline = usePipeline<PendingCommand>({
    /**
     * Say what is actually being done.
     *
     * The default said "Adding 1 card" for everything, including a rejection —
     * which told the user the opposite of what they had just clicked. A count
     * cannot tell those apart, so the label reads the commands.
     */
    describe: (queued) => {
      if (queued.length === 0) return 'Preparing…'
      const words: Record<PendingCommand['type'], string> = {
        accept: 'Adding',
        exclude: 'Rejecting',
        remove: 'Removing',
        restore: 'Restoring',
        lock: 'Locking',
      }
      const kinds = new Set(queued.map((c) => c.type))
      const verb = kinds.size === 1 ? words[queued[0]!.type] : 'Updating'
      const n = queued.length
      return `${verb} ${String(n)} card${n === 1 ? '' : 's'}…`
    },
    run: (commands) => load(commands),
    apply: (value) => {
      const r = value as QueryResult | null
      if (r === null) {
        // The run failed; its error is already on the bar. Drop the optimistic
        // overlay rather than leaving cards that were never saved.
        setPending([])
        return
      }
      /*
       * Never write a deck older than the one the server has confirmed.
       *
       * A run captures the deck when it STARTS. Anything written in between —
       * a lock, a deck option — produces a newer server deck, and applying the
       * captured one would undo it. `withPendingLocks` covers the case where
       * the write has not landed yet; this covers the case where it HAS, which
       * the pending overlay cannot see because a confirmed lock is no longer
       * pending.
       *
       * Version is the right comparison: it is the server's own ordering, and
       * it is what the optimistic-concurrency check uses (doc 12 §12.7).
       */
      const known = serverDeckRef.current
      const freshest = known !== null && known.version > r.deck.version ? known : r.deck
      setDeck(withPendingLocks(freshest))
      setGroups(r.recs.groups)
      setUnavailable(r.recs.unavailable)
      setAnalysis(r.analysis)
      setQueryError(r.recs.query.errors[0]?.message ?? null)
      setCards(r.hydrated.cards)
      setPrices(r.hydrated.prices)
      setColumnMatches(new Map(r.recs.columns.map((c) => [c.query, new Set(c.matched)])))
      setExtraItems(r.extra)
      setPending([])
    },
  })

  // Initial load, and whenever the filter changes. No settle on this path —
  // there is nothing to keep adding to, so holding the result back would be lag.
  const { refresh } = pipeline
  useEffect(() => {
    // A new filter is a new question, so "more of that group" is spent — those
    // rows were the answer to the old one.
    expandedRef.current = new Set()
    setExtraItems(new Map())
    refresh()
    // `columns` belongs here for the same reason `query` does: adding one
    // changes what the server must compute. Without it a new column showed no
    // ticks until something else happened to trigger a recompute.
  }, [query, columns, refresh])

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

  /**
   * Lock or unlock a card — applied at once, and NOT through the pipeline.
   *
   * Locking changes nothing the suggestions are computed from. It does not add
   * or remove a card, so the pool, the composition counts, the curve and every
   * score are identical either side of it. Running the staged requery for a
   * lock spent a round trip and up to four seconds of settle to arrive at the
   * list already on screen.
   *
   * What it DOES change — the gold overlays, and whether this card shows a cut
   * hint — is derived on the client from the deck itself, so it lands on the
   * click. The command still goes to the server, because the lock has to
   * survive a reload; it just does not hold anything up.
   */
  const toggleLock = (oracleId: string, locked: boolean): void => {
    const before = serverDeckRef.current ?? deckRef.current
    pendingLocks.current.set(oracleId, locked)
    // Marks the row as in flight, which is what draws its spinner.
    setLocking((current) => new Set(current).add(oracleId))
    setDeck((d) => ({
      ...d,
      entries: d.entries.map((e) =>
        e.oracleId === oracleId && e.zone === 'accepted' ? { ...e, locked } : e,
      ),
    }))

    const finish = (): void => {
      pendingLocks.current.delete(oracleId)
      setLocking((current) => {
        const next = new Set(current)
        next.delete(oracleId)
        return next
      })
    }

    void sendWithRetry(before.id, [{ type: 'lock', oracleId, locked }], before.version)
      .then((r) => {
        finish()
        serverDeckRef.current = r.deck
        setDeck(r.deck)
        // The lock worked, so whatever failed before it is no longer the state
        // of the world. Leaving a stale error next to a control that just
        // succeeded teaches people to ignore errors.
        setNotice(null)
        pipeline.clearError()
      })
      .catch(() => {
        finish()
        /*
         * Reconcile against the server rather than guessing.
         *
         * The old code restored the deck it had captured before the click,
         * which is only right if nothing else changed in between — and an
         * accept batch may well have landed while this was retrying. Re-reading
         * gives the actual state; falling back to the captured deck is for when
         * even that fails, which means the network is gone and a stale view is
         * the best available answer.
         */
        void api
          .getDeck(before.id)
          .then((fresh) => {
            serverDeckRef.current = fresh
            setDeck(withPendingLocks(fresh))
          })
          .catch(() => setDeck(before))
        setNotice('That lock did not save.')
      })
  }

  /**
   * Take a card out of the excluded list and put it straight into the deck.
   *
   * Two commands in one batch, in order. The domain folds a batch one command
   * at a time, so `restore` lands first and leaves the card absent, and the
   * `accept` that follows is then a legal move on a card that is no longer
   * excluded — which it would not be the other way round, and would not be at
   * all if these were sent as two separate batches with a recompute between.
   */
  const restoreIntoDeck = (oracleId: string): void => {
    setPending((queued) => [...queued, { type: 'restore', oracleId }, { type: 'accept', oracleId }])
    pipeline.schedule({ type: 'restore', oracleId })
    pipeline.schedule({ type: 'accept', oracleId })
  }

  const setDeckOption = (body: Parameters<typeof api.patchDeck>[1]): void => {
    void api
      .patchDeck(deck.id, body)
      .then((d) => {
        /*
         * The patched deck is now what the server holds, so `serverDeckRef` has
         * to learn it too.
         *
         * Without this, ticking "Exclude Universes Beyond" appeared to work and
         * then undid itself: the refresh that follows reads `serverDeckRef` for
         * the deck it returns, that ref still held the deck from before the
         * PATCH, and applying the result wrote the old flag straight back over
         * the new one. Every write that changes the server's deck has to update
         * this — the lock path does, and this one did not.
         */
        serverDeckRef.current = d
        setDeck(withPendingLocks(d))
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

  /**
   * Open the preview NOW, from what is already in memory.
   *
   * `/cards/batch` returns whole cards and every deck card and suggestion has
   * already been hydrated, so the client is holding the name, type line, mana
   * cost, oracle text and synergy tags before the click happens — eight of the
   * ten things the preview renders. Waiting on a request to show text we
   * downloaded minutes ago is latency we invented.
   *
   * Only printings and combos have to come from the server; they arrive second
   * and slot in. That also means a card whose fetch fails still previews.
   */
  const open = (oracleId: string): void => {
    setInspect(oracleId)
    setDetail(null)
    void api
      .getCardDetail(oracleId)
      .then((d) => {
        // Ignore a response for a card the user has already navigated away
        // from — two quick clicks otherwise race, and the loser wins.
        setInspect((current) => {
          if (current === d.oracleId) setDetail(d)
          return current
        })
      })
      .catch(() => undefined)
  }

  const closePreview = (): void => {
    setInspect(null)
    setDetail(null)
  }

  /** The deck as the user sees it: saved entries plus what is still in flight. */
  const optimistic = useMemo(() => {
    let entries = [...deck.entries]
    for (const p of pending) {
      if (p.type === 'accept') {
        entries.push({ oracleId: p.oracleId, zone: 'accepted', locked: false })
      } else if (p.type === 'lock') {
        entries = entries.map((e) =>
          e.oracleId === p.oracleId && e.zone === 'accepted'
            ? { ...e, locked: p.locked ?? true }
            : e,
        )
      } else if (p.type === 'restore') {
        // excluded -> absent, which makes it a candidate again. Matching the
        // domain's fold exactly, so the optimistic view and the server agree.
        entries = entries.filter((e) => !(e.oracleId === p.oracleId && e.zone === 'excluded'))
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

  const lockedIds = useMemo(
    () =>
      new Set(
        optimistic.entries.filter((e) => e.zone === 'accepted' && e.locked).map((e) => e.oracleId),
      ),
    [optimistic],
  )
  /**
   * Cut hints by card — with locked cards removed here, not on the server.
   *
   * The server already omits locked cards from `analysis.cuts`, but that
   * analysis is only as fresh as the last recompute, and locking deliberately
   * no longer triggers one. So the hint sat there after the click that was
   * supposed to dismiss it, which is the whole point of the lock: it is how the
   * user says "stop asking about this one", and it has to be obeyed on the
   * click rather than whenever the server next agrees.
   */
  const cutBy = useMemo(
    () =>
      new Map(
        (analysis?.cuts ?? [])
          .filter((c) => !lockedIds.has(c.oracleId))
          // One fault is usually not a signal — see `cutThreshold`.
          .filter((c) => c.reasons.length >= cutThreshold)
          .map((c) => [c.oracleId, c]),
      ),
    [analysis, lockedIds, cutThreshold],
  )

  const basicIds = useMemo(() => new Set(basics.map((b) => b.oracleId)), [basics])

  /**
   * The three "Completes N combos" groups, shown as one.
   *
   * The split was a ranking device that leaked into the layout: three headers,
   * three counts, and the same answer to the same question — "this card
   * finishes something". The degree is already on every row as a brass badge,
   * so merging loses nothing and the rows still sort hardest-won first.
   *
   * Done here rather than in `recommend`, which keeps its three keys. They are
   * how the domain ORDERS candidates, and collapsing them there would throw
   * away the ordering to change a heading.
   *
   * "One card away" stays separate — it is a different claim, about a combo the
   * deck cannot make yet.
   */
  const shownGroups = useMemo(() => {
    const combo = groups.filter((g) => g.key.startsWith('combo-'))
    if (combo.length === 0) return groups
    const merged: api.Group = {
      ...combo[0]!,
      key: 'combo',
      label: 'Completes combos',
      total: combo.reduce((n, g) => n + g.total, 0),
      rationale: 'Adding one of these finishes a combo using only cards already in your deck.',
      /*
       * Half the rows the three groups would have shown between them.
       *
       * Merging tripled the region: three groups of eight became a wall of
       * twenty-four, all making the same claim, pushing every other group off
       * the screen. Halved, the strongest combo cards still lead the list and
       * the gaps below them are reachable without scrolling past them.
       */
      items: combo
        .flatMap((g) => g.items)
        .sort((a, b) => b.comboDegree - a.comboDegree || b.score - a.score)
        .slice(0, Math.ceil(combo.reduce((n, g) => n + g.items.length, 0) / 2)),
    }
    const rest = groups.filter((g) => !g.key.startsWith('combo-'))
    // Back where the strongest of the three sat, not appended to the end.
    const at = groups.findIndex((g) => g.key.startsWith('combo-'))
    return [...rest.slice(0, at), merged, ...rest.slice(at)]
  }, [groups])

  /**
   * Every group, with any rows an expand fetched folded in.
   *
   * A group with nothing in it is KEPT and drawn collapsed rather than removed.
   * A category the deck has satisfied is a result worth seeing — "you have
   * enough removal" is the answer to a question the user is asking — and
   * deleting its heading turns that answer into silence, so the group appears
   * to have been lost rather than finished.
   *
   * The one case where empty headings really are noise is a filter that matches
   * nothing, and that is handled separately by the empty-search panel below,
   * which replaces the whole list rather than showing nine "(0)"s.
   */
  const visibleGroups = useMemo(
    () =>
      shownGroups.map((g) => {
        const extra = extraItems.get(g.key)
        if (extra === undefined) return g
        const seen = new Set(g.items.map((i) => i.oracleId))
        return { ...g, items: [...g.items, ...extra.filter((i) => !seen.has(i.oracleId))] }
      }),
    [shownGroups, extraItems],
  )

  /** Whether anything is left to show under a heading, filters applied. */
  const rowsIn = (g: api.Group): number =>
    g.items.filter((item) => {
      const decided = optimistic.entries.find((e) => e.oracleId === item.oracleId)
      return decided === undefined || decided.zone !== 'excluded'
    }).length

  /** Collapsed by choice, or because the deck no longer needs this category. */
  const isCollapsed = (g: api.Group): boolean => collapsed.has(g.key) || rowsIn(g) === 0

  const toggleCollapsed = (key: string): void =>
    setCollapsed((current) => {
      const next = new Set(current)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  /**
   * Ask the server for more rows, in one group and only that group.
   *
   * The default eight per group is a budget shared across nine headings. When
   * the user says "more of THIS", the budget is no longer the right shape, so
   * the request narrows to the one key rather than raising the limit
   * everywhere and quadrupling a recompute the user did not ask for.
   */
  const expandGroup = (key: string): void => {
    setExpanding(key)
    setCollapsed((current) => {
      if (!current.has(key)) return current
      const next = new Set(current)
      next.delete(key)
      return next
    })
    // Recorded so every later recompute re-asks for it. Without this the rows
    // would be frozen at the deck they were chosen for.
    const keys = new Set([...expandedRef.current, key])
    expandedRef.current = keys
    void expansionsFor(deckRef.current.id, new Set([key]), queryRef.current, columnsRef.current)
      .then(async (fetched) => {
        const items = fetched.get(key) ?? []
        // These are cards nothing has hydrated, so their rows would read
        // "Loading…" for good — no later recompute asks for them by name.
        const hydrated = await api.hydrate(items.map((i) => i.oracleId))
        setCards((current) => new Map([...current, ...hydrated.cards]))
        setPrices((current) => new Map([...current, ...hydrated.prices]))
        setExtraItems((current) => new Map(current).set(key, items))
      })
      .catch(() => undefined)
      .finally(() => setExpanding(null))
  }

  /** Headings that still have rows — what "the list is empty" actually means. */
  const groupsWithRows = visibleGroups.filter((g) => rowsIn(g) > 0)

  /**
   * When a search finds nothing, say whether the card exists at all.
   *
   * "No results" is two different answers wearing one face: the card is not in
   * Magic, or the card is real and simply not a candidate for THIS deck —
   * already in it, excluded, or outside the commander's colours. Those need
   * different reactions from the user, and the app knows which is which.
   *
   * `searchCards` is a name search over the whole corpus, so it answers the
   * first question directly. If the exact text finds nothing, progressively
   * shorter prefixes are tried — that is what turns a typo into "did you mean
   * Sekki, Seasons' Guide?" without needing fuzzy matching in the database.
   */
  const [nearby, setNearby] = useState<{ term: string; items: api.Card[] } | null>(null)

  useEffect(() => {
    const term = query.trim()
    // A bare name, not a fielded query. `t:creature` is a filter and has no
    // "matching cards" to list; a name does.
    const isName = term !== '' && !/[:<>=]/.test(term)
    if (!isName) {
      setNearby(null)
      return
    }
    let cancelled = false
    // One call. `searchCards` falls back to trigram similarity itself when the
    // literal search finds nothing, so a typo is the server's problem, not a
    // ladder of guesses from the client.
    void api
      .searchCards(term, { limit: 5 })
      .then((found) => {
        if (!cancelled) setNearby({ term, items: found.items })
      })
      .catch(() => {
        if (!cancelled) setNearby(null)
      })
    return () => {
      cancelled = true
    }
  }, [query])

  /** Accepted cards by id, for the preview's "works with your deck" pass. */
  const acceptedIds = useMemo(
    () =>
      new Set([
        ...optimistic.commanders,
        ...optimistic.entries.filter((e) => e.zone === 'accepted').map((e) => e.oracleId),
      ]),
    [optimistic],
  )

  /**
   * The gold overlays, derived here rather than read from the analysis.
   *
   * The server sends `locked` counts too, but they only change when a recompute
   * lands — so locking a card left the gold untouched for seconds, or until the
   * next accept. These come from the deck the user is looking at, so they move
   * on the click.
   *
   * `dimensionKeysOf` is imported from the domain rather than reimplemented:
   * the keys have to match the ones the server put on its targets, and an
   * overlay counted by a second rule can exceed the bar under it.
   */
  const lockedByDimension = useMemo(() => {
    const counts = new Map<string, number>()
    for (const entry of optimistic.entries) {
      if (entry.zone !== 'accepted' || !entry.locked) continue
      if (optimistic.commanders.includes(entry.oracleId)) continue
      const card = cards.get(entry.oracleId)
      if (card === undefined) continue
      for (const key of dimensionKeysOf(card)) counts.set(key, (counts.get(key) ?? 0) + 1)
    }
    return counts
  }, [optimistic, cards])

  /** The same, for the curve. Lands have no bucket, exactly as on the server. */
  const lockedByBucket = useMemo(() => {
    const buckets = new Array<number>(8).fill(0)
    for (const entry of optimistic.entries) {
      if (entry.zone !== 'accepted' || !entry.locked) continue
      if (optimistic.commanders.includes(entry.oracleId)) continue
      const card = cards.get(entry.oracleId)
      if (card === undefined || card.types.includes('land')) continue
      const bucket = Math.min(7, Math.max(0, Math.floor(card.manaValue)))
      buckets[bucket] = (buckets[bucket] ?? 0) + 1
    }
    return buckets
  }, [optimistic, cards])

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

  /**
   * Which composition bars to show.
   *
   * A role drops out once it is FULLY LOCKED — every card counted toward it has
   * been committed, so there is nothing left to decide there. The checkbox
   * additionally hides roles that merely meet their target but are not locked,
   * which is what you want late in a build when only the shortfalls matter.
   */
  const compositionRows = useMemo(() => {
    const rows = (analysis?.targets ?? []).map((t) => {
      const name = dimensionName(t.dimension)
      // The client's count, not the server's — the server's is a snapshot from
      // the last recompute, and a lock has to show up before the next one.
      const locked = lockedByDimension.get(dimensionKeyOf(t.dimension)) ?? t.locked
      const settled = locked >= t.actual && t.actual >= t.min
      const filled = t.actual >= t.min
      return { ...t, locked, name, settled, filled }
    })
    return rows
      .filter((r) => !r.settled)
      .filter((r) => !(hideSettledRoles && r.filled))
      .sort((a, b) => a.actual / Math.max(1, a.ideal) - b.actual / Math.max(1, b.ideal))
      .slice(0, 12)
  }, [analysis, hideSettledRoles, lockedByDimension])

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
        <DeckMenu
          deck={deck}
          cardCount={deckSize}
          onSwitch={(id) => onSwitch?.(id)}
          onNew={() => onNew?.()}
          onRename={(body) => setDeckOption(body)}
        />
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

          {/* How noisy the cut hints are allowed to be. Sits with the deck
              because that is the list it changes. */}
          <label className="cut-threshold">
            <span>
              Cut hints at{' '}
              <strong>
                {cutThreshold}+ {cutThreshold === 1 ? 'fault' : 'faults'}
              </strong>
            </span>
            <input
              type="range"
              min={1}
              max={4}
              step={1}
              value={cutThreshold}
              onChange={(e) => setCutThreshold(Number(e.target.value))}
              aria-label="How many faults a card needs before its cut hints are shown"
              title="A card that completes a combo often has no derived synergy, and vice versa — so a single fault is usually not a signal."
            />
          </label>
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
                    {/* Only ever on an unlocked card: locking is how the user
                        says "stop asking about this one". */}
                    {cutBy.has(line.oracleId) ? (
                      <span className="reasons">
                        {cutBy
                          .get(line.oracleId)!
                          .reasons.slice(0, 2)
                          .map((r, i) => (
                            <span className="reason cut" key={i}>
                              {cutText(r)}
                            </span>
                          ))}
                      </span>
                    ) : null}
                  </button>
                  <Costs
                    manaCost={cards.get(line.oracleId)?.manaCost}
                    price={prices.get(line.oracleId)}
                  />
                  {section.key === 'commander' ? null : (
                    <>
                      {/* A lock in flight shows a spinner instead of the
                          diamond: the click already changed the icon, so
                          without this there is no way to tell a saved lock from
                          one still being retried. */}
                      {locking.has(line.oracleId) ? (
                        <span
                          className="spinner"
                          role="status"
                          aria-label={`Saving lock for ${cards.get(line.oracleId)?.name ?? 'card'}`}
                        />
                      ) : (
                        <button
                          className="act lock"
                          data-locked={lockedIds.has(line.oracleId)}
                          onClick={() => toggleLock(line.oracleId, !lockedIds.has(line.oracleId))}
                          aria-label={
                            lockedIds.has(line.oracleId)
                              ? `Unlock ${cards.get(line.oracleId)?.name ?? 'card'}`
                              : `Lock ${cards.get(line.oracleId)?.name ?? 'card'}, hiding its cut hint`
                          }
                          title={
                            lockedIds.has(line.oracleId)
                              ? 'Locked — this card is staying, so it is never suggested as a cut'
                              : 'Lock this card to keep it and hide its cut hint'
                          }
                        >
                          {lockedIds.has(line.oracleId) ? '\u25C6' : '\u25C7'}
                        </button>
                      )}
                      <button
                        className="act exclude"
                        onClick={() => act(line.oracleId, 'exclude')}
                        aria-label={`Remove ${cards.get(line.oracleId)?.name ?? 'card'}`}
                      >
                        Remove
                      </button>
                    </>
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
                Rejected<span className="count">{excluded.length}</span>
              </h3>
              <p className="note">Not suggested again — until you put one back.</p>
              {excluded.map((e) => (
                <div className="card-row" key={e.oracleId}>
                  <button
                    className="name as-link"
                    onClick={() => open(e.oracleId)}
                    aria-label={`Preview ${cards.get(e.oracleId)?.name ?? 'card'}`}
                  >
                    {cards.get(e.oracleId)?.name ?? 'Loading…'}
                  </button>
                  {inFlight.has(e.oracleId) ? (
                    <span
                      className="spinner"
                      role="status"
                      aria-label={`${cards.get(e.oracleId)?.name ?? 'Card'} restored, updating suggestions`}
                    />
                  ) : (
                    <>
                      {/* "Never" is a strong word and people change their minds.
                          Two ways back, because they are different intentions:
                          one says "let me see it again", the other says "I was
                          wrong, put it in". */}
                      <button
                        className="act"
                        onClick={() => act(e.oracleId, 'restore')}
                        aria-label={`Suggest ${cards.get(e.oracleId)?.name ?? 'card'} again`}
                        title="Put this back in the suggestion pool"
                      >
                        Suggest again
                      </button>
                      <button
                        className="act accept"
                        onClick={() => restoreIntoDeck(e.oracleId)}
                        aria-label={`Add ${cards.get(e.oracleId)?.name ?? 'card'} to the deck`}
                        title="Put this straight into the deck"
                      >
                        Add
                      </button>
                    </>
                  )}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="region" aria-label="Suggestions" ref={suggestionsRef}>
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

            <label
              className="check"
              title="Stop typing and the filter runs by itself after four seconds. The ring around the magnifying glass shows how long is left; typing anything resets it."
            >
              <input
                type="checkbox"
                checked={autoQuery}
                onChange={(e) => setAutoQuery(e.target.checked)}
              />
              Auto query after 4 seconds
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
            <div className="filter-bar">
              <input
                type="text"
                value={draftQuery}
                placeholder="Filter — try  t:creature  or  mv<=3  or  tag:treasure"
                onChange={(e) => setDraftQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setQuery(draftQuery)
                }}
                aria-label="Filter suggestions"
              />
              {/* Explicit, because a query is expensive: typing no longer fires
                  a recompute on its own. Enter does the same thing, and so does
                  the countdown when Deck options has it switched on. */}
              <SearchButton
                onRun={() => setQuery(draftQuery)}
                remaining={auto.remaining}
                restartKey={draftQuery}
              />
              <button
                className="act"
                disabled={draftQuery.trim() === '' || columns.includes(draftQuery.trim())}
                onClick={() => {
                  setColumns((c) => [...c, draftQuery.trim()])
                  // Promoting a query to a column means "keep showing me
                  // everything, just tell me which ones match", so the filter
                  // itself is cleared.
                  setDraftQuery('')
                  setQuery('')
                }}
                aria-label="Show this query as a column instead of filtering by it"
                title="Add as a column: keeps every suggestion and ranking, and ticks the ones that match"
              >
                + column
              </button>
            </div>

            <ColumnLegend
              columns={columns}
              onRemove={(c) => setColumns((all) => all.filter((x) => x !== c))}
              measureRoot={suggestionsRef}
            />

            {queryError !== null ? <p className="problem">{queryError}</p> : null}
          </div>

          {/*
            Name matches, always, directly under the box.
            Searching a name is asking "is this card here", and that question
            deserves an answer whether or not the card is also a suggestion —
            the suggestion list is filtered by what the deck NEEDS, so a card can
            be perfectly real and simply not offered.
          */}
          {nearby !== null && nearby.items.length > 0 ? (
            <div className="name-matches">
              <p className="note">
                {nearby.items.some((c) => c.name.toLowerCase().includes(nearby.term.toLowerCase()))
                  ? `Cards named like “${nearby.term}”`
                  : `No card is named “${nearby.term}”. Did you mean:`}
              </p>
              <ul className="near-names">
                {nearby.items.slice(0, 5).map((c) => (
                  <li key={c.oracleId}>
                    <button className="as-link" onClick={() => open(c.oracleId)}>
                      {c.name}
                    </button>
                    <span className="near-type">{c.typeLine}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {groupsWithRows.length === 0 && query.trim() !== '' ? (
            <div className="empty-search">
              <p className="problem">Nothing in your suggestions matches “{query.trim()}”.</p>
              {nearby !== null && nearby.items.length > 0 ? (
                <p className="note">
                  The cards above are real — they are not candidates for this deck, being already in
                  it, excluded, or outside your colour identity.
                </p>
              ) : nearby !== null ? (
                <p className="note">No card with that name exists in the corpus either.</p>
              ) : null}
            </div>
          ) : null}

          {visibleGroups.map((g) => (
            <div className={`group${isCollapsed(g) ? ' collapsed' : ''}`} key={g.key}>
              <div className="group-head">
                <button
                  type="button"
                  className="group-toggle"
                  onClick={() => toggleCollapsed(g.key)}
                  aria-expanded={!isCollapsed(g)}
                  aria-controls={`group-${g.key}`}
                  // The glyph is the whole label, so the name has to be given
                  // rather than read off the content: "−" tells a screen reader
                  // nothing about which list it hides.
                  aria-label={`${isCollapsed(g) ? 'Show' : 'Hide'} ${g.label.toLowerCase()}`}
                  title={isCollapsed(g) ? 'Show these suggestions' : 'Hide these suggestions'}
                >
                  {isCollapsed(g) ? '+' : '−'}
                </button>
                <h3>{g.label}</h3>
                <span className="count">{g.total}</span>
                {/* A category the deck has satisfied is kept, not deleted — it
                    says the need is met, which is the answer to the question
                    the heading asks. */}
                {rowsIn(g) === 0 ? <span className="satisfied">satisfied</span> : null}
                <span className="rationale">{g.rationale}</span>
                <button
                  type="button"
                  className="group-more"
                  onClick={() => expandGroup(g.key)}
                  disabled={expanding !== null}
                  aria-label={`Ask for more ${g.label.toLowerCase()}`}
                  title={`Ask for more ${g.label.toLowerCase()}`}
                >
                  {expanding === g.key ? '…' : 'More'}
                </button>
                {/* No column marker here on purpose.
                    A group head holds a title, a count and a rationale; a card
                    row holds costs and two buttons after its columns. The two
                    rows therefore end at different places, and the marker sat
                    251 px right of the cells it claimed to head — measured, not
                    guessed. Matching it would mean mirroring every trailing
                    width, which is a copy that drifts. The columns are named
                    once instead, in the legend under the filter bar, which
                    aligns by measuring where the cells actually are. */}
              </div>
              {isCollapsed(g)
                ? null
                : g.items
                    /*
                     * Drop anything the user has just decided on.
                     *
                     * The groups come from the server and are only as fresh as the
                     * last recompute, so a rejected card sat in the list until the
                     * requery landed — several seconds during which the app was
                     * still offering something the user had just refused. Pillar P6
                     * says an excluded card is never suggested again; that has to
                     * be true on the click, not on the next round trip.
                     */
                    .filter((item) => {
                      const decided = optimistic.entries.find((e) => e.oracleId === item.oracleId)
                      return decided === undefined || decided.zone !== 'excluded'
                    })
                    .map((item) => (
                      <div className="card-row" key={item.oracleId}>
                        <Degree
                          degree={item.comboDegree}
                          near={item.nearCombosAt1}
                          combos={item.combos}
                          cards={cards}
                          lockedIds={lockedIds}
                          self={item.oracleId}
                        />
                        {/* The reasons sit BESIDE the name button, not inside it.
                      One of them opens a panel of its own, and a button nested
                      in a button is invalid and unreachable by keyboard. */}
                        {/* The whole cell opens the preview, not just the text.
                      Splitting the name from its reasons left a dead strip
                      under the name where a click landed on nothing. The button
                      inside stays the accessible control; this is a mouse
                      convenience layered over it. */}
                        <span
                          className="name-cell"
                          onClick={(e) => {
                            // A reason chip that opens its own panel must not also
                            // open the preview behind it.
                            if ((e.target as HTMLElement).closest('.hint') === null)
                              open(item.oracleId)
                          }}
                        >
                          <button
                            className="name as-link"
                            onClick={() => open(item.oracleId)}
                            aria-label={`Preview ${cards.get(item.oracleId)?.name ?? 'card'}`}
                          >
                            {cards.get(item.oracleId)?.name ?? 'Loading…'}
                            {/* The type line, in the same dim grey the preview uses.
                            A name alone does not say whether a suggestion is a
                            creature or a land, which is the first thing anyone
                            checks before deciding on it. */}
                            {cards.get(item.oracleId)?.typeLine === undefined ? null : (
                              <span className="row-type">{cards.get(item.oracleId)?.typeLine}</span>
                            )}
                          </button>
                          <span className="reasons">
                            {item.reasons.map((r, i) =>
                              r.kind === 'completes-combos' && item.combos.length > 0 ? (
                                <Hint
                                  key={i}
                                  className="reason-hint"
                                  label={`${reasonText(r, item)} — show which`}
                                  content={
                                    <>
                                      <strong>{reasonText(r, item)}</strong>
                                      <ComboList
                                        combos={item.combos}
                                        cards={cards}
                                        lockedIds={lockedIds}
                                        self={item.oracleId}
                                      />
                                    </>
                                  }
                                >
                                  <span className="reason" data-kind={r.kind} data-openable="true">
                                    {reasonText(r, item)}
                                  </span>
                                </Hint>
                              ) : (
                                <span className="reason" data-kind={r.kind} key={i}>
                                  {reasonText(r, item)}
                                </span>
                              ),
                            )}
                          </span>
                        </span>
                        {columns.map((c) => (
                          <span
                            className="col-cell"
                            key={c}
                            data-match={columnMatches.get(c)?.has(item.oracleId) === true}
                            title={`${c}: ${columnMatches.get(c)?.has(item.oracleId) === true ? 'yes' : 'no'}`}
                            aria-label={`${c}: ${columnMatches.get(c)?.has(item.oracleId) === true ? 'yes' : 'no'}`}
                          >
                            {columnMatches.get(c)?.has(item.oracleId) === true
                              ? '\u2713'
                              : '\u00B7'}
                          </span>
                        ))}
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
                            {/* "Reject", not "Never". The action is the same and
                          undoable from the Rejected list, and "Never" read as a
                          harsher commitment than it actually is. */}
                            <button
                              className="act exclude"
                              onClick={() => act(item.oracleId, 'exclude')}
                              aria-label={`Reject ${cards.get(item.oracleId)?.name ?? 'card'}`}
                              title="Stop suggesting this card. You can undo it from the Rejected list."
                            >
                              Reject
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
              card={inspect === null ? undefined : cards.get(inspect)}
              detail={detail}
              price={prices.get(inspect ?? '')}
              onClose={closePreview}
              accepted={acceptedIds}
              lockedIds={lockedIds}
              cards={cards}
            />

            <h2 style={{ marginTop: '1.25rem' }}>Composition</h2>
            <label className="check" title={HIDE_SETTLED_HELP}>
              <input
                type="checkbox"
                checked={hideSettledRoles}
                onChange={(e) => setHideSettledRoles(e.target.checked)}
              />
              Only show roles that still need cards
              <span className="help" aria-hidden="true">
                ?
              </span>
            </label>

            {compositionRows.map((r) => {
              const pct = Math.min(100, (r.actual / Math.max(1, r.ideal)) * 100)
              const lockedPct = Math.min(100, (r.locked / Math.max(1, r.ideal)) * 100)
              return (
                <div className="meter" key={r.name}>
                  <div className="meter-label">
                    <span>{r.name}</span>
                    <span className="delta">
                      {r.locked > 0 ? `${String(r.locked)}\u25C6 ` : ''}
                      {r.actual} / {r.ideal}
                    </span>
                  </div>
                  <div
                    className="meter-track"
                    title={`${String(r.actual)} of a target ${String(r.ideal)} (range ${String(r.min)}–${String(r.max)}), ${String(r.locked)} locked`}
                  >
                    <div
                      className="meter-fill"
                      data-short={!r.filled}
                      style={{ width: `${pct}%` }}
                    />
                    {/* The committed part, in the same gold the curve uses. */}
                    <div className="meter-locked" style={{ width: `${lockedPct}%` }} />
                  </div>
                </div>
              )
            })}
            {compositionRows.length === 0 && analysis !== null ? (
              <p className="note">
                {hideSettledRoles ? 'Nothing short.' : 'Every role is locked in.'}
              </p>
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
              <Curve curve={analysis.curve} locked={lockedByBucket} />
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
  const [loading, setLoading] = useState(true)

  const open = useCallback((d: api.Deck): void => {
    localStorage.setItem('roundtable.deck', d.id)
    setDeck(d)
  }, [])

  useEffect(() => {
    // Which deck was last open. The DECKS themselves live on the server, keyed
    // by this browser's device id (ADR-0014) — this is only the bookmark.
    const saved = localStorage.getItem('roundtable.deck')
    if (saved === null) {
      setLoading(false)
      return
    }
    void api
      .getDeck(saved)
      .then(setDeck)
      .catch(() => localStorage.removeItem('roundtable.deck'))
      .finally(() => setLoading(false))
  }, [])

  // Without this the Start screen flashes for a moment on every reload, before
  // the saved deck arrives — which reads as having lost it.
  if (loading) return <p className="boot">Loading…</p>

  if (deck === null) return <Start onCreated={open} />

  return (
    <Workspace
      deck={deck}
      key={deck.id}
      onSwitch={(id) => {
        void api.getDeck(id).then(open).catch(noop)
      }}
      onNew={() => {
        localStorage.removeItem('roundtable.deck')
        setDeck(null)
      }}
    />
  )
}

const noop = (): void => undefined
