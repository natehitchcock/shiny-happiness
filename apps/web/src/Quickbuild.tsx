import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Detail, type CardView } from '@roundtable/ui'
import {
  DECK_SIZE,
  gapQuery,
  type QuickbuildGap,
  type QuickbuildPlan,
  type QuickbuildReach,
} from '@roundtable/domain'

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
    limitPerGroup: number,
  ) => Promise<readonly QuickbuildCandidate[]>
  readonly onAdd: (oracleId: string) => void
  readonly onReject: (oracleId: string) => void
  readonly onClose: () => void
  /**
   * Reach past the band, when the builder asks for it (ADR-0040).
   *
   * The plan is computed by the workspace, so the choice offered at the end of
   * the loop has to be handed back up rather than kept here. It is a callback
   * and not a piece of local state for the same reason `plan` is a prop: two
   * copies of "which number are we working to" is two numbers to disagree.
   */
  readonly onReach: (reach: QuickbuildReach) => void
  /** How many cards the cut indicator currently names, for the Q5 message. */
  readonly cutCount: number
  /**
   * Every card the deck has already decided on — accepted or excluded, from the
   * workspace's OPTIMISTIC deck, so it includes the click that has not reached
   * the server yet.
   *
   * Two jobs, and the second is the whole reason the panel feels instant.
   *
   * P6: a card excluded anywhere — here, or in the feed behind the panel —
   * must never be offered again, and the queue was fetched before that
   * happened. Filtering on every render rather than refetching means an
   * exclusion made elsewhere cannot survive even one frame.
   *
   * And it is how a pick advances the trio with NO request at all: the card
   * the builder just took joins this set immediately, drops out of the queue,
   * and the next candidate slides into its place. The four outcomes of a trio
   * — take the first, the second, the third, or skip — differ only in which
   * element leaves the queue, never in which query produced it.
   */
  readonly retiredIds: ReadonlySet<string>
}

/** How many are offered at once. D1: three for ONE gap, not one each for three. */
const OPTIONS = 3

/**
 * The first fetch for a gap, and the deeper one that follows it.
 *
 * FIRST is what the feed asks for, and what makes the panel's first paint as
 * fast as the feed's. DEEP is fetched in the background while the builder reads
 * that first trio, and it is what makes every later pick free: eight candidates
 * is two and two-thirds trios, twenty-four is eight of them.
 *
 * Measured against the live API on a real deck: `limitPerGroup: 8` costs 43 ms
 * at the median and `limitPerGroup: 30` costs 46 ms, so the depth is nearly
 * free on the wire. What it is not free in is HYDRATION — the client fetches a
 * card, a price and an image for every row it is handed — which is why the
 * first page stays small and the deep one arrives a moment later, off the path
 * the builder is waiting on.
 *
 * NEITHER IS THREE (ADR-0026). A three-row request would let the focus
 * guarantee append past a three-row list, and taking three from the front of
 * that would discard exactly the rows the guarantee promised — the same defect
 * it exists to fix, one layer up. Asking for MORE is always safe: the guarantee
 * appends at the tail and the panel reads from the head.
 */
const FIRST_PAGE = 8
const DEEP_PAGE = 24

/**
 * Top up once the queue can serve fewer than this many more trios.
 *
 * Two rather than one: refilling at one trio left means the request is racing
 * the builder's next click, which is the thing this whole change exists to
 * stop. A gap whose first page already holds more than this — every type and
 * curve gap, which are asked of all thirteen groups and come back with about
 * sixty-seven rows — never triggers a top-up at all.
 */
const TOPUP_BELOW_TRIOS = 2

/**
 * How long a fetch may run before the panel admits it is waiting.
 *
 * DERIVED FROM TWO NUMBERS, not picked. The lower bound is perceptual: about
 * 100 ms is the limit under which a delay is not experienced as a wait, so a
 * bar shown and hidden inside that window is pure flicker — it reports a wait
 * the builder did not have. The upper bound is the measurement: the gap fetch
 * runs at a 43 ms median and a 60 ms p90 against the live API, so 150 ms sits
 * above the common case with headroom for hydration and render, and a normal
 * fetch never reaches it.
 *
 * It stays far below the one-second mark where an interface stops feeling
 * continuous, so a genuinely slow fetch — a cold server, a large multi-group
 * gap — still gets its bar promptly. A silent wait is worse than a visible one;
 * this delays the bar, it does not suppress it.
 */
const BAR_AFTER_MS = 150

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

/**
 * What the panel says when it runs out of gaps — the report's second half.
 *
 * "Quickbuild ended while I was below curve on ramp and spot removal, and also
 * only at 58 of 100 cards." Both halves of that were true at once, and the
 * panel said neither. The band's floor sits three cards under the ideal, so a
 * dimension can be inside its band and visibly under its meter at the same
 * time; and the role minima sum to 56 for a midrange deck at bracket 3, so a
 * deck reaches every band at 56 cards with 44 still to find.
 *
 * So the ending states the arithmetic instead of asserting completion, and
 * NEVER closes by itself. The sentence is assembled from the plan's own numbers
 * — nothing here computes a target.
 */
const endingText = (plan: QuickbuildPlan): string => {
  const held = DECK_SIZE - plan.unallocated
  const met =
    plan.reach === 'band'
      ? 'Every composition and curve allotment is inside its band.'
      : 'Every composition and curve target is at its ideal.'
  if (plan.unallocated === 0) return `${met} The deck holds all ${DECK_SIZE} cards.`
  return (
    `${met} The deck holds ${held} of ${DECK_SIZE}, so there are ${plan.unallocated} more ` +
    `cards to pick. Your archetype leaves ${plan.unroled} slots with no target at all — the ` +
    `threats and win conditions — and Quickbuild has no opinion about those.`
  )
}

export const Quickbuild = ({
  plan,
  filter,
  fetchCandidates,
  onAdd,
  onReject,
  onClose,
  onReach,
  cutCount,
  retiredIds,
}: QuickbuildProps): JSX.Element => {
  /**
   * Which gap of the plan is showing — a MONOTONIC counter, wrapped on read.
   *
   * It used to be an index into `plan.gaps` that "Different gap" advanced with
   * a modulo against the length AT THE TIME OF THE CLICK. The plan is
   * recomputed on every accept and gaps close as the deck fills, so the list it
   * indexed could get shorter underneath it — and `plan.gaps[3]` on a
   * three-gap plan is `undefined`, which rendered as "Every composition and
   * curve goal is inside its band. Nothing to fill." The panel announced it was
   * finished while the deck was still short of ramp and spot removal, which is
   * exactly what the report describes. Wrapping on READ cannot go out of range,
   * whatever the plan does between renders.
   */
  const [gapAt, setGapAt] = useState(0)
  /**
   * How many candidates have been passed over, and FOR WHICH GAP. D5: a PASS.
   *
   * The gap key rides with the count because the two must never be applied to
   * each other's list. This was a bare number, so a builder who skipped twice
   * on the land gap and then had that gap close under them kept a cursor of six
   * into the next gap's fresh page of eight — the panel sliced past almost all
   * of it and, when the new page was shorter, reported "No more candidates for
   * this gap" about a gap it had not shown a single card for. The second half
   * of the same report: ramp and spot removal never being offered.
   */
  const [cursor, setCursor] = useState<{ readonly gapKey: string; readonly passed: number }>({
    gapKey: '',
    passed: 0,
  })
  /**
   * The candidates held for one gap, and which gap they answer.
   *
   * Keyed by the gap and the filter so a queue can be recognised as stale
   * rather than trusted. A queue for a gap the deck no longer has is DISCARDED,
   * never shown — a stale trio under a live heading is worse than the wait this
   * queue exists to remove.
   */
  const [queue, setQueue] = useState<{
    readonly gapKey: string
    readonly filter: string
    readonly candidates: readonly QuickbuildCandidate[]
    /** The deep page has landed; there is nothing further to top up. */
    readonly deep: boolean
  } | null>(null)
  const [fetching, setFetching] = useState(true)
  const [failed, setFailed] = useState(false)
  /** Whether the wait has lasted long enough to be worth admitting to. */
  const [waiting, setWaiting] = useState(false)
  /** Which of the three is showing, for the narrow layout (Q4). */
  const [focused, setFocused] = useState(0)
  const [announcement, setAnnouncement] = useState('')

  const panelRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)

  const gap = plan.gaps.length === 0 ? undefined : plan.gaps[gapAt % plan.gaps.length]
  const passed = gap !== undefined && cursor.gapKey === gap.key ? cursor.passed : 0

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

  /**
   * Which fetch the panel is still interested in.
   *
   * The same device, and for the same reason, as `generation` in
   * `pipeline.ts`: nothing can cancel an HTTP request that is already away, so
   * a superseded answer has to be recognised and dropped on arrival rather than
   * prevented. Without it, a slow first-page fetch for the gap the builder has
   * just navigated away from lands after the new gap's fetch and overwrites it,
   * and the panel shows three cards for a gap whose heading is no longer on
   * screen. That is the failure the queue must not introduce: a stale trio
   * under a live heading is worse than the wait it replaces.
   */
  const generation = useRef(0)

  const load = useCallback(
    async (
      forGap: QuickbuildGap,
      forFilter: string,
      limit: number,
      { background }: { background: boolean },
    ): Promise<void> => {
      const mine = ++generation.current
      // A background top-up must not put the panel into a waiting state: there
      // are cards on screen and the builder is reading them.
      if (!background) {
        setFetching(true)
        setFailed(false)
      }
      try {
        const found = await fetchCandidates(
          combinedQuery(forFilter, forGap),
          groupsFor(forGap),
          limit,
        )
        if (generation.current !== mine) return
        setQueue({
          gapKey: forGap.key,
          filter: forFilter,
          candidates: found,
          deep: limit >= DEEP_PAGE,
        })
        setFetching(false)
      } catch {
        if (generation.current !== mine) return
        // Named, never disguised (doc 05 §5.3). "No candidates" and "the
        // request failed" are different answers and must not render the same.
        // A failed TOP-UP is silent on purpose — there are cards on screen and
        // nothing is broken from where the builder is sitting; the queue simply
        // stays as deep as it already was.
        if (!background) {
          setFailed(true)
          setFetching(false)
        }
      }
    },
    [fetchCandidates],
  )

  /*
   * Fetch when, and only when, the queue cannot answer the question being
   * asked. A queue for a different gap or a different filter is discarded here
   * rather than filtered — it is an answer to a question nobody asked.
   */
  const stale =
    queue === null || gap === undefined || queue.gapKey !== gap.key || queue.filter !== filter
  useEffect(() => {
    if (gap === undefined) return
    if (!stale) return
    void load(gap, filter, FIRST_PAGE, { background: false })
  }, [stale, gap, filter, load])

  /**
   * What the queue can still offer.
   *
   * `retiredIds` is applied on every render rather than at fetch time, so a
   * card accepted or excluded since the fetch — by this panel or by the feed
   * behind it — leaves the queue immediately (P6). This is also what makes a
   * pick instant: the taken card drops out and the next one slides up, with no
   * request at all.
   */
  const live = useMemo(
    () => (stale ? [] : (queue?.candidates ?? [])).filter((c) => !retiredIds.has(c.oracleId)),
    [queue, retiredIds, stale],
  )

  const showing = useMemo(() => live.slice(passed, passed + OPTIONS), [live, passed])

  /*
   * "Option 3 of 2" is not a sentence. `focused` is a cursor over a list that
   * shortens under it — a card retiring from the queue is enough — so it is
   * clamped on read for the same reason `gapAt` is.
   */
  const focus = showing.length === 0 ? 0 : Math.min(focused, showing.length - 1)

  /*
   * THE PREFETCH. Deepen the queue while the builder is reading, so the next
   * trio is already in hand whichever of the four things they do with this one.
   *
   * `background: true` — no waiting state, no announcement, no bar. If it never
   * lands, the panel is exactly as good as it was before this existed.
   */
  useEffect(() => {
    if (gap === undefined || stale || queue === null || queue.deep || fetching) return
    if (live.length - passed > TOPUP_BELOW_TRIOS * OPTIONS) return
    void load(gap, filter, DEEP_PAGE, { background: true })
  }, [gap, stale, queue, fetching, live.length, passed, filter, load])

  /*
   * The bar waits `BAR_AFTER_MS` before admitting to a wait, and only when
   * there is genuinely nothing to show. A background top-up never reaches here,
   * because `showing` is non-empty while one runs.
   */
  useEffect(() => {
    if (showing.length > 0 || !fetching) {
      setWaiting(false)
      return undefined
    }
    const timer = setTimeout(() => setWaiting(true), BAR_AFTER_MS)
    return () => clearTimeout(timer)
  }, [showing.length, fetching])

  /*
   * Every recompute is announced (§19.5). Without this the panel's contents
   * swap silently under a screen reader, which makes the loop unusable — the
   * user presses Add and has no way to learn what replaced it.
   */
  useEffect(() => {
    if (gap === undefined) {
      // The ending is announced too. It is the one moment the panel stops
      // asking questions, and a screen-reader user who hears nothing at that
      // point has no way to learn the loop is over or that there is a choice
      // waiting on it.
      setAnnouncement(endingText(plan))
      return
    }
    // Silence while a first fetch is still running: `pipeline.ts`'s `describe`
    // learned this the hard way — a live region that narrates work rather than
    // results announces "Preparing…" over and over and is worse than none. The
    // bar is what reports a wait; this region reports what arrived.
    if (fetching && showing.length === 0 && !failed) return
    setAnnouncement(
      failed
        ? 'Could not load candidates for this gap.'
        : showing.length === 0
          ? `No candidates for ${gap.label}.`
          : `${gapHeading(gap)}. ${showing.length} option${showing.length === 1 ? '' : 's'}: ${showing
              .map((c) => c.view.name)
              .join(', ')}.`,
    )
  }, [failed, fetching, showing, gap, plan])

  const nextGap = (): void => {
    setGapAt((at) => at + 1)
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
    if (gap === undefined) return
    setCursor({ gapKey: gap.key, passed: passed + OPTIONS })
    setFocused(0)
  }

  const exhausted = !fetching && !failed && showing.length === 0 && passed > 0

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
        /*
         * THE ENDING IS A QUESTION, NOT A FULL STOP (ADR-0040).
         *
         * It used to be one sentence — "Nothing to fill." — with no action on
         * it, which read as "you are done" to a builder who was 42 cards short
         * of a legal deck. Both offers are here, always: keep going, or go back
         * to the list. Neither happens on its own, and the panel never closes
         * itself.
         */
        <div
          className="quickbuild-done"
          /*
           * A named GROUP, not a bare div: it holds a sentence and the two
           * controls that answer it, and a screen-reader user arriving at
           * "Keep quickbuilding to the ideals" out of context has no way to
           * know what it would continue. The name is what ties the buttons to
           * the paragraph above them.
           */
          role="group"
          aria-label="Quickbuild has no gaps left"
        >
          <p className="quickbuild-done-text">{endingText(plan)}</p>
          <div className="quickbuild-actions">
            {plan.beyond.length === 0 ? null : (
              /*
               * Offered only when there is something past the band to work.
               * `beyond` is the plan's own answer to "would continuing find
               * anything", so the button cannot appear over an empty loop —
               * the failure this whole change is about, one layer along.
               */
              <button className="act primary" onClick={() => onReach('ideal')}>
                Keep quickbuilding to the ideals
              </button>
            )}
            <button className="act" onClick={onClose}>
              Back to the suggestion list
            </button>
          </div>
        </div>
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

          {/*
           * The bar appears only when the queue cannot answer AND the wait has
           * outlasted `BAR_AFTER_MS`. While a trio is in hand — which, once the
           * deep page has landed, is every pick and every skip — there is no
           * wait to report and nothing is drawn here at all.
           */}
          {waiting ? (
            <p className="quickbuild-state" role="progressbar" aria-label="Finding candidates">
              Finding candidates…
            </p>
          ) : fetching && showing.length === 0 ? null : failed ? (
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
                Option {focus + 1} of {showing.length}
              </p>
              <ul className="quickbuild-options" aria-label="Three candidates for this gap">
                {showing.map((candidate, at) => (
                  <li
                    key={candidate.oracleId}
                    className={at === focus ? 'quickbuild-option is-focused' : 'quickbuild-option'}
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
