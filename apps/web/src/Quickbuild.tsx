import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Detail, type CardView } from '@roundtable/ui'
import { gapQuery, type QuickbuildGap, type QuickbuildPlan } from '@roundtable/domain'

/**
 * Quickbuild — one gap, three cards, one decision (doc 19).
 *
 * A VIEW over the existing recommendations and never a second scorer (D2).
 * This file contains no ranking of any kind. It turns the deck's leading gap
 * into an ordinary `query` on the ordinary recommendations request — the same
 * request the feed makes — and renders the first three answers in the order the
 * server sent them. Eligibility, grouping, scoring, `reasons`, budget, bracket,
 * colour identity, semantic emphasis and the ADR-0026 guarantee all happen
 * upstream and none of them are re-implemented here.
 *
 * WHY A QUERY RATHER THAN A NEW ENDPOINT. Measured on eight real decks: the
 * three best cards for a plain role gap are already inside the workspace's
 * visible eight 96% of the time, but for a curve gap only 33% and for a
 * compound gap ("a two-drop that is also removal") 63%. Curve is not a grouping
 * dimension and `curveFit` returns the same value for every card in a bucket,
 * so the group ordering carries no signal about mana value and no amount of
 * client-side picking recovers one. Asking the server the narrower question
 * fixes it exactly — 12 of 12 gaps, 36 of 36 cards — and needs no contract
 * change, because `groups`, `query` and `limitPerGroup` are already on the
 * request. See doc 19 §19.4 Q1.
 */

/** One card Quickbuild is offering, ready to draw. */
export interface QuickbuildCandidate {
  readonly oracleId: string
  readonly view: CardView
  /**
   * The heading the server filed it under.
   *
   * Shown, because P5 says grouping is the product's opinion and Quickbuild is
   * borrowing that opinion rather than forming its own. A card offered for the
   * ramp gap that arrives under "Completes 1 combo" is being recommended for
   * two reasons and the builder should see both.
   */
  readonly groupLabel: string
}

export interface QuickbuildProps {
  readonly plan: QuickbuildPlan
  /** The builder's active filter, `''` when there is none (Q3). */
  readonly filter: string
  /**
   * Ask for this gap's candidates. Owned by the workspace, which holds the
   * deck id, the card cache, the art and the prices; injected so the panel can
   * be tested without a network.
   */
  readonly fetchCandidates: (
    query: string,
    groups: readonly string[] | null,
  ) => Promise<readonly QuickbuildCandidate[]>
  readonly onAdd: (oracleId: string) => void
  readonly onReject: (oracleId: string) => void
  readonly onClose: () => void
  /** How many cards the cut indicator currently names, for the Q5 message. */
  readonly cutCount: number
}

/** How many are offered at once. D1: three for ONE gap, not one each for three. */
const OPTIONS = 3

/**
 * Which group keys can answer this gap.
 *
 * A ROLE gap has a group named for it, so the request names that group and the
 * answer is the group's own top three — exactly the ordering already on screen.
 *
 * A TYPE gap (`type:creature`) and a CURVE gap have no group at all: type
 * deficits are never grouped, and the curve is not a grouping dimension
 * anywhere in the product. `null` therefore means "every group", and the panel
 * takes the first three in the order the server emitted them — which is the
 * product's own priority (combo, then near-combo, then the gap groups, then
 * staples). Ranking them against each other by score would be a global ranking,
 * which this product does not have (P5) and which Quickbuild must not invent.
 */
const groupsFor = (gap: QuickbuildGap): readonly string[] | null =>
  gap.kind === 'composition' && gap.dimension?.kind === 'role'
    ? [`fills-${gap.dimension.role}`]
    : null

/**
 * The gap's filter, with the builder's own filter still in force (Q3).
 *
 * ANDed, not replaced. The filter is part of the deck — it persists with the
 * columns — so a builder who narrowed to a theme meant it, and a wizard that
 * quietly ignored it would be adding cards they had just said they did not want
 * to see. The panel says the filter is in force in words, every time, because
 * the risk this creates is real: a filter set an hour ago can leave a gap with
 * no candidates, and "no candidates" and "your filter excluded them all" look
 * identical unless one of them is written down.
 */
export const combinedQuery = (filter: string, gap: QuickbuildGap): string => {
  const own = gapQuery(gap)
  const user = filter.trim()
  return user === '' ? own : `${user} ${own}`
}

const gapHeading = (gap: QuickbuildGap): string =>
  gap.kind === 'curve'
    ? `${gap.short} more at ${gap.label}`
    : `${gap.short} more ${gap.label}${gap.short === 1 ? '' : ''}`

export const Quickbuild = ({
  plan,
  filter,
  fetchCandidates,
  onAdd,
  onReject,
  onClose,
  cutCount,
}: QuickbuildProps): JSX.Element => {
  const [gapAt, setGapAt] = useState(0)
  /** How many candidates have been passed over for this gap. D5: a PASS. */
  const [passed, setPassed] = useState(0)
  const [candidates, setCandidates] = useState<readonly QuickbuildCandidate[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading')
  /** Which of the three is showing, for the narrow layout (Q4). */
  const [focused, setFocused] = useState(0)
  const [announcement, setAnnouncement] = useState('')

  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)

  const gap = plan.gaps[gapAt]

  /*
   * Focus moves in on open and RETURNS to whatever opened the panel on close
   * (§19.5). Captured at mount rather than passed in, because the opener is
   * whatever the user actually pressed — the masthead button normally, but a
   * keyboard shortcut later would be the same code.
   */
  useEffect(() => {
    openerRef.current = document.activeElement
    panelRef.current?.focus()
    return () => {
      const opener = openerRef.current
      if (opener instanceof HTMLElement && document.contains(opener)) opener.focus()
    }
  }, [])

  /*
   * Escape closes, and focus is TRAPPED while open (§19.5).
   *
   * The trap is a wrap on Tab rather than an `inert` on the rest of the page:
   * the panel covers the suggestion pane only, and the deck rail and the
   * composition rail stay visible on purpose — they are the scoreboard the
   * panel is asking you to play against. Marking them inert would hide the
   * numbers that justify the question.
   */
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
    )
    if (focusable === undefined || focusable.length === 0) return
    const first = focusable[0]!
    const last = focusable[focusable.length - 1]!
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const load = useCallback(async () => {
    if (gap === undefined) return
    setState('loading')
    try {
      const found = await fetchCandidates(combinedQuery(filter, gap), groupsFor(gap))
      setCandidates(found)
      setState('ready')
    } catch {
      // Named, never disguised (doc 05 §5.3). "No candidates" and "the request
      // failed" are different answers and must not render the same.
      setState('failed')
    }
  }, [fetchCandidates, filter, gap])

  useEffect(() => {
    void load()
  }, [load])

  const showing = useMemo(() => candidates.slice(passed, passed + OPTIONS), [candidates, passed])

  /*
   * Every recompute is announced (§19.5). Without this the panel's contents
   * swap silently under a screen reader, which makes the loop unusable — the
   * user presses Add and has no way to learn what replaced it.
   */
  useEffect(() => {
    if (state === 'loading' || gap === undefined) return
    setAnnouncement(
      state === 'failed'
        ? 'Could not load candidates for this gap.'
        : showing.length === 0
          ? `No candidates for ${gap.label}.`
          : `${gapHeading(gap)}. ${showing.length} option${showing.length === 1 ? '' : 's'}: ${showing
              .map((c) => c.view.name)
              .join(', ')}.`,
    )
  }, [state, showing, gap])

  const nextGap = (): void => {
    setGapAt((at) => (at + 1) % Math.max(1, plan.gaps.length))
    setPassed(0)
    setFocused(0)
  }

  /*
   * D5 — SKIP IS A PASS, NOT A REJECTION.
   *
   * It advances a window over the candidates this session and records nothing.
   * Nothing is sent, no command is queued, and the cards it walks past are
   * offered again the next time the panel opens. Conflating it with Reject
   * would make the panel a minefield: P6 says an excluded card is never
   * suggested again, so a builder clicking past a card they might want later
   * would silently exile it. Reject is still available, as its own labelled
   * button that says what it does.
   */
  const skip = (): void => {
    setPassed((n) => n + OPTIONS)
    setFocused(0)
  }

  const exhausted = state === 'ready' && showing.length === 0 && passed > 0

  return (
    <div
      className="quickbuild"
      role="dialog"
      aria-modal="false"
      aria-label="Quickbuild"
      tabIndex={-1}
      ref={panelRef}
      onKeyDown={onKeyDown}
    >
      <div className="quickbuild-head">
        <h2>Quickbuild</h2>
        <button className="act" onClick={onClose}>
          Close
        </button>
      </div>

      {/*
       * The live region. `polite` and always mounted — a region created at the
       * moment it first has something to say is not announced by most screen
       * readers, because it was not there to be watched.
       */}
      <p className="quickbuild-live" role="status" aria-live="polite">
        {announcement}
      </p>

      {gap === undefined ? (
        <p className="quickbuild-done">
          Every composition and curve goal is inside its band. Nothing to fill.
        </p>
      ) : (
        <>
          <div className="quickbuild-gap">
            <h3>{gapHeading(gap)}</h3>
            <p className="quickbuild-why">
              {plan.ordering === 'build-order'
                ? 'Working your archetype’s build order, because the deck is still too empty for the largest gap to mean much.'
                : 'Working the largest gap first.'}
            </p>
            <button className="act" onClick={nextGap} disabled={plan.gaps.length < 2}>
              Different gap
            </button>
          </div>

          {/*
           * Q3 — the filter is respected AND said out loud, every time it is
           * doing anything. The stated risk is that a stale filter makes the
           * panel look broken; saying it is what stops that.
           */}
          {filter.trim() === '' ? null : (
            <p className="quickbuild-filter">
              Your filter <code>{filter.trim()}</code> is also in force, so these are the best
              candidates that match it. Clear it to see the rest.
            </p>
          )}

          {state === 'loading' ? (
            <p className="quickbuild-state">Finding candidates…</p>
          ) : state === 'failed' ? (
            <p className="quickbuild-state quickbuild-failed">
              Could not load candidates for this gap. The rest of the workspace is unaffected.
            </p>
          ) : showing.length === 0 ? (
            <p className="quickbuild-state">
              {exhausted
                ? 'No more candidates for this gap.'
                : filter.trim() === ''
                  ? 'Nothing in your colours fills this gap.'
                  : 'Nothing matching your filter fills this gap.'}{' '}
              <button className="link" onClick={nextGap}>
                Try the next gap
              </button>
            </p>
          ) : (
            <>
              {/*
               * Q4 — a LIST, and every option is reachable by keyboard (§19.5).
               *
               * At narrow widths the stylesheet shows one at a time, so the
               * panel says which of the three is in view and keeps the other
               * two one keypress away. It must never become "yes or no to this
               * one card": that is a different and worse question than "which
               * of these three".
               */}
              <p className="quickbuild-of">
                Option {focused + 1} of {showing.length}
              </p>
              <ul className="quickbuild-options" aria-label="Three candidates for this gap">
                {showing.map((candidate, at) => (
                  <li
                    key={candidate.oracleId}
                    className={
                      at === focused ? 'quickbuild-option is-focused' : 'quickbuild-option'
                    }
                    /*
                     * Named, because `Detail` renders its own list of reasons
                     * inside this one. Without a label the three options are
                     * indistinguishable from the reason bullets to anything
                     * walking the accessibility tree — a screen reader hears
                     * nine list items and cannot tell which three are the
                     * choice it is being asked to make.
                     */
                    aria-label={`Option ${at + 1} of ${showing.length}: ${candidate.view.name}`}
                    onFocus={() => setFocused(at)}
                  >
                    <Detail
                      card={candidate.view}
                      actions={
                        <>
                          <button className="act primary" onClick={() => onAdd(candidate.oracleId)}>
                            Add
                          </button>
                          <button className="act" onClick={() => onReject(candidate.oracleId)}>
                            Reject
                          </button>
                        </>
                      }
                    />
                    <p className="quickbuild-group">Offered under {candidate.groupLabel}</p>
                  </li>
                ))}
              </ul>
              <div className="quickbuild-actions">
                {/*
                 * "Skip these three" and not "Skip", because the word has to
                 * carry D5: this passes over three cards and remembers nothing.
                 * Reject is the permanent one and it sits on each card, where
                 * the card it applies to is unambiguous.
                 */}
                <button className="act" onClick={skip}>
                  Skip these three
                </button>
              </div>
            </>
          )}

          {/*
           * Q5 — Quickbuild ADDS ONLY, and says so rather than going quiet.
           *
           * An over-full bucket cannot be fixed by adding anything, so it is
           * never offered as a gap. Leaving it unmentioned would make the panel
           * look as though it had no opinion about a problem the composition
           * rail is showing in red beside it.
           */}
          {plan.overFull.length === 0 ? null : (
            <p className="quickbuild-limit">
              Quickbuild only adds cards, so it cannot help with{' '}
              {plan.overFull
                .map((o) => `${o.excess} too many at mana value ${o.bucket}`)
                .join(', ')}
              .{' '}
              {cutCount > 0
                ? `The cut indicator names ${cutCount} card${cutCount === 1 ? '' : 's'} to consider removing.`
                : 'The cut indicator is where removals are suggested.'}
            </p>
          )}
        </>
      )}
    </div>
  )
}
