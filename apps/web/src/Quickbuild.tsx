import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react'
import { Detail, type CardView } from '@roundtable/ui'
import {
  DECK_SIZE,
  gapQuery,
  type BracketFlag,
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
  /**
   * The bracket flags the server attached, STRUCTURED (ADR-0051).
   *
   * `view.reasons` is already carrying these, but as prose — the workspace
   * phrases every reason through `reasonText`, and a `bracket-warning` becomes
   * the two words "bracket warning" in a bullet list of four. That is a fact
   * about the card with no consequence attached, sitting where the eye is
   * scanning for why the card is good. It is not a warning.
   *
   * So the flag travels beside the prose rather than instead of it: the panel
   * needs to know a card is a Game Changer in order to combine it with the
   * allowance below and say what the click will actually do.
   *
   * Optional, so a caller that does not supply it keeps working (AGENTS.md R2).
   */
  readonly bracketFlags?: readonly BracketFlag[]
}

/**
 * The deck's Game Changer standing, when the workspace can say (ADR-0051).
 *
 * `null` means the bracket check is unavailable — `rules === null`, the state
 * the masthead chip prints as "NOT CHECKED". The panel then says a card is a
 * Game Changer and stops there, rather than asserting an allowance nobody gave
 * it: a table of allowances in a component file is a rejected PR (AGENTS.md
 * §8), and so is a fabricated one.
 */
export interface GameChangerStanding {
  /** How many the deck holds now, commander included. */
  readonly held: number
  readonly allowed: number | 'unlimited'
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
  /**
   * What the bracket allows and what the deck holds, for the warning that has
   * to appear BEFORE the click (ADR-0051).
   *
   * Owned by the workspace, like `plan`, because it is read off the same
   * `analysis.bracket` the masthead chip draws from — and the chip turning red
   * a moment after the click is the whole complaint. Two copies of "how many
   * Game Changers is this deck at" is two numbers to disagree.
   */
  readonly gameChangers?: GameChangerStanding | null
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
 * A STAPLES gap IS a group and nothing else — `staple` or `staple-land`, which
 * is why its key is the group key (ADR-0044). The curated list, the colour
 * identity, the accepted set, the exclusions, the budget cap and the bracket
 * allowance were all applied server-side; there is no filter left for the panel
 * to add and no query that could express "is on the curated list".
 *
 * A TYPE gap (`type:creature`) and a CURVE gap have no group at all: type
 * deficits are never grouped, and the curve is not a grouping dimension
 * anywhere in the product. `null` therefore means "every group", and the panel
 * takes the first three in the order the server emitted them — which is the
 * product's own priority (staples, staple lands, combos, then the gap groups,
 * then the rest). Ranking them against each other by score would be a global
 * ranking, which this product does not have (P5) and must not invent.
 */
const groupsFor = (gap: QuickbuildGap): readonly string[] | null => {
  if (gap.kind === 'staples') return [gap.key]
  return gap.kind === 'composition' && gap.dimension?.kind === 'role'
    ? [`fills-${gap.dimension.role}`]
    : null
}

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
  // A staples gap contributes no clause at all, so the builder's filter must
  // travel alone rather than with a trailing space glued to it.
  if (own === '') return user
  return user === '' ? own : `${user} ${own}`
}

/**
 * The heading over the trio.
 *
 * A staples gap says what is ON OFFER, not what is owed. "5 more staples" would
 * be a claim that the deck is five staples short of something, and there is no
 * such target anywhere in the product — the list is an opinion with an owner
 * (ADR-0044), not a band the deck is measured against.
 */
const gapHeading = (gap: QuickbuildGap): string =>
  gap.kind === 'staples'
    ? `${gap.short} ${gap.label} you don’t have yet`
    : gap.kind === 'curve'
      ? `${gap.short} more at ${gap.label}`
      : `${gap.short} more ${gap.label}`

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
  const met =
    plan.reach === 'band'
      ? 'Every composition and curve allotment is inside its band.'
      : 'Every composition and curve target is at its ideal.'
  const holds = `The deck holds ${plan.held} of ${DECK_SIZE}`
  // `held` rather than `DECK_SIZE - unallocated`, which floors at zero and
  // would tell a deck of 110 that it holds all 100.
  if (plan.unallocated === 0) return `${met} ${holds}.`
  return (
    `${met} ${holds}, so there are ${plan.unallocated} more cards to pick. Your archetype ` +
    `leaves ${plan.unroled} slots with no target at all — the threats and win conditions — ` +
    `and Quickbuild has no opinion about those.`
  )
}

/**
 * What taking THIS CARD will cost, said before it is taken (ADR-0051).
 *
 * Per-card only. Being at 100 is a fact about the deck, not about any one of
 * the three, so it is stated once in the panel's own banner rather than
 * repeated under each option — three identical paragraphs is how a warning
 * becomes wallpaper. It still reaches every Add control's accessible name,
 * because a name is read one control at a time.
 *
 * THE DECISION THIS ENCODES: warn on the option, refuse nothing.
 *
 * Refusing was the tempting answer and it is the one the project has already
 * ruled out twice. Doc 03 §3.2 says bracket flags are surfaced and never used
 * to filter, AGENTS.md §8 lists "filtering candidates by bracket instead of
 * flagging them" among the things that get a PR rejected, and the reason given
 * for both is that the user is allowed to cross their own line KNOWINGLY. The
 * defect was never that the card was offered. It was that "knowingly" was not
 * true: the badge went red after the click and the option had carried nothing.
 *
 * Letting it through and saying so afterwards is what shipped, and it is the
 * one option that is definitely wrong — by the time the legality block updates,
 * the deck has already changed and the panel has already moved on.
 *
 * ADR-0044 D4 IS UNCHANGED. It governs which cards LEAD the staples phase — an
 * over-allowance Game Changer is withheld from the `staple` groups and appears
 * everywhere else with its `bracket-warning` reason. That is still exactly what
 * happens. Nothing here widens what the recommender endorses, filters a
 * candidate, or touches `gameChangerBudget`. It adds a sentence.
 *
 * Returns the sentences in the order they matter, most consequential first.
 * Empty for the ordinary card, which is nearly every card.
 */
export const warningsFor = (
  candidate: QuickbuildCandidate,
  gameChangers: GameChangerStanding | null | undefined,
): readonly string[] => {
  const warnings: string[] = []

  if ((candidate.bracketFlags ?? []).includes('game-changer')) {
    const allowed = gameChangers?.allowed
    if (typeof allowed === 'number' && gameChangers !== null && gameChangers !== undefined) {
      const next = gameChangers.held + 1
      if (next > allowed) {
        warnings.push(
          `${candidate.view.name} is a Game Changer, and taking it takes you to ${String(next)} of ` +
            `the ${String(allowed)} your bracket allows.`,
        )
      }
    } else {
      // No allowance to compare against — `unlimited`, or the bracket check is
      // unavailable. The flag is still the server's own fact and worth saying;
      // the arithmetic is not ours to invent.
      if (allowed !== 'unlimited') {
        warnings.push(`${candidate.view.name} is a Game Changer.`)
      }
    }
  }

  return warnings
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
  gameChangers,
}: QuickbuildProps): JSX.Element => {
  /**
   * The gap "Different gap" moved to, by KEY. `null` means the leading one.
   *
   * It used to be an index into `plan.gaps`, advanced with a modulo against the
   * length AT THE TIME OF THE CLICK. The plan is recomputed on every accept and
   * gaps close as the deck fills, so the list it indexed got shorter underneath
   * it — and `plan.gaps[3]` on a three-gap plan is `undefined`, which the panel
   * rendered as "Every composition and curve goal is inside its band. Nothing
   * to fill." It announced it was finished while the deck was still short of
   * ramp and spot removal, which is exactly what the report describes.
   */
  const [chosenKey, setChosenKey] = useState<string | null>(null)
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
    /** The deep page has landed; there is nothing deeper to ask for. */
    readonly deep: boolean
    /**
     * How many cards the deck had decided on when this queue was fetched.
     *
     * It is what makes a REFILL distinguishable from a pointless repeat.
     * `recommend` never offers a card the deck already holds, so its answer for
     * one gap changes exactly when the deck does — and `retiredIds` growing is
     * this panel's own record of that. Asking again with the same deck would
     * return the same list; asking again after eight picks returns eight cards
     * the builder has not seen.
     */
    readonly retiredAt: number
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

  /*
   * The gap on screen: the one the builder chose while it is still open, and
   * the leading one otherwise.
   *
   * Looked up BY KEY rather than by index. An index into `plan.gaps` cannot
   * survive the plan being recomputed on every accept: `plan.gaps[3]` on a
   * three-gap plan is `undefined`, which rendered as "Nothing to fill" and is
   * the false ending in the report. A wrapping index cannot go out of range but
   * still points somewhere arbitrary — measured in the browser, "Different gap"
   * onto tutor and then two gaps closing left the panel on a gap the builder
   * had not asked for, which is exactly the reshuffling D3 says must not
   * happen. A key is stable under both.
   *
   * Falling back to `gaps[0]` when the chosen gap is gone is the honest answer:
   * the gap they were working has closed, so the most pressing one leads again.
   */
  const gap = plan.gaps.find((g) => g.key === chosenKey) ?? plan.gaps[0]
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

  /*
   * `retiredIds.size` as of this render, readable from inside `load` without
   * making every fetch depend on it. `load` must not be rebuilt each time a
   * card is accepted — the effects below key off its identity, and a new
   * `load` on every pick would re-run them and refetch what is already in hand.
   */
  const retiredSize = useRef(retiredIds.size)
  retiredSize.current = retiredIds.size

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
          retiredAt: retiredSize.current,
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
   * THE PREFETCH, and the REFILL.
   *
   * Deepening is the original job: fetch the deep page while the builder is
   * reading the first trio, so the next one is already in hand whichever of the
   * four things they do with this one.
   *
   * Refilling is the job it was missing, and the omission was visible in the
   * running app. `deep` was treated as "there is nothing further to top up",
   * which is true of the SERVER'S ANSWER and false of the deck: a builder
   * working one large gap consumes all twenty-four and the queue empties, and
   * the panel then said "Nothing in your colours fills this gap" about a gap
   * with thousands of candidates left. Observed at 96 of 100 cards on an eight
   * card land gap, with the server returning eight more on the same query.
   *
   * A refill is safe from looping because it is conditioned on the DECK having
   * changed since the fetch, not on the queue being empty: `recommend` never
   * offers a card the deck already holds, so a repeat with an unchanged deck
   * would return the identical list and is not made. See `retiredAt`.
   */
  useEffect(() => {
    if (gap === undefined || stale || queue === null || fetching) return
    const remaining = live.length - passed
    const wantsDepth = !queue.deep && remaining <= TOPUP_BELOW_TRIOS * OPTIONS
    const wantsRefill = remaining < OPTIONS && retiredIds.size > queue.retiredAt
    if (!wantsDepth && !wantsRefill) return
    // Silent while there is still something on screen, and honest about the
    // wait when the queue has run out entirely — at that point there is
    // genuinely nothing to look at and a silent pause reads as a dead panel.
    void load(gap, filter, DEEP_PAGE, { background: remaining > 0 })
  }, [gap, stale, queue, fetching, live.length, passed, filter, load, retiredIds])

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

  /*
   * Step to the next gap in the plan, wrapping at the end.
   *
   * Resolved against the CURRENT list every time rather than carried as a
   * counter, so cycling always lands on a gap that exists right now.
   */
  const nextGap = (): void => {
    if (plan.gaps.length === 0) return
    const at = plan.gaps.findIndex((g) => g.key === gap?.key)
    setChosenKey(plan.gaps[(at + 1) % plan.gaps.length]?.key ?? null)
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
              {/*
               * The staples phase says whose opinion it is, because it is one
               * (ADR-0044). Nothing measured this list — ADR-0008 dropped
               * EDHREC and the inclusion statistic is inert — so a sentence
               * implying a percentage behind it would be a claim the product
               * cannot support (P4). `ordering` describes the derived order
               * underneath and is not printed while this phase is running,
               * because it is not the rule that put this gap here.
               */}
              {gap.kind === 'staples'
                ? 'Starting with our curated staples — cards essentially every deck in your colours wants. Our opinion, not a statistic.'
                : plan.ordering === 'build-order'
                  ? 'Working your archetype’s build order, because the deck is still too empty for the largest gap to mean much.'
                  : 'Working the largest gap first.'}
            </p>
            <button className="act" onClick={nextGap} disabled={plan.gaps.length < 2}>
              Different gap
            </button>
          </div>

          {/*
           * The deck is full, said ONCE at the top rather than only on each
           * option (ADR-0051).
           *
           * Q5's sibling: that paragraph exists because "Quickbuild only adds"
           * is a limit the panel has to admit to rather than go quiet about,
           * and being at 100 cards is the same kind of fact. The panel kept
           * offering "4 more at mana value 2" to a finished deck and the only
           * notice of what the click had done was in the legality block below
           * the fold.
           *
           * It does not stop the loop. `plan.gaps` is still what it was, the
           * options are still offered and still take a click — the deck's shape
           * really is short of ramp at 100 cards, and saying so is the honest
           * report. What changes is that the arithmetic is on screen before the
           * click instead of after it.
           */}
          {plan.held < DECK_SIZE ? null : (
            <p className="quickbuild-limit quickbuild-full">
              {`The deck already holds ${String(plan.held)} of ${String(DECK_SIZE)} cards. ` +
                `Anything added here makes it ${String(plan.held + 1)}, which is not a legal ` +
                `Commander deck — so these are trades against something already in the list, ` +
                `not additions to it.`}
            </p>
          )}

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
                {showing.map((candidate, at) => {
                  const warnings = warningsFor(candidate, gameChangers)
                  /*
                   * The consequence goes in the Add control's OWN name, not
                   * only in the paragraph beside it.
                   *
                   * A screen-reader user moving control to control never reads
                   * the paragraph — they hear "Add, button" and press it. The
                   * warning has to be on the thing being pressed, which is the
                   * same reasoning that moved the composition meter's `title`
                   * into its trigger's accessible name.
                   *
                   * Short forms, because an accessible name is spoken and the
                   * full sentences are two lines each. The visible text carries
                   * the whole of it.
                   */
                  const spoken = [
                    plan.held >= DECK_SIZE
                      ? `takes the deck to ${String(plan.held + 1)} of ${String(DECK_SIZE)}`
                      : null,
                    (candidate.bracketFlags ?? []).includes('game-changer') &&
                    typeof gameChangers?.allowed === 'number' &&
                    gameChangers.held + 1 > gameChangers.allowed
                      ? `takes you to ${String(gameChangers.held + 1)} of ${String(gameChangers.allowed)} Game Changers`
                      : null,
                  ].filter((s): s is string => s !== null)
                  return (
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
                          {/* The name changes ONLY when there is something to
                              say. An unwarned Add is still called "Add" — the
                              `<li>` already names the card and the option
                              number, so renaming every button would add a
                              repetition to all three to serve the rare one. */}
                          <button
                            className="act primary"
                            data-warns={spoken.length > 0}
                            onClick={() => onAdd(candidate.oracleId)}
                            {...(spoken.length === 0
                              ? {}
                              : {
                                  'aria-label': `Add ${candidate.view.name} — ${spoken.join(', and ')}`,
                                })}
                          >
                            Add
                          </button>
                          <button className="act" onClick={() => onReject(candidate.oracleId)}>
                            Reject
                          </button>
                        </>
                      }
                    />
                    {/* Under the card and over the group line, which is where
                        the eye already is when it reaches the buttons. Not a
                        `role="alert"`: three of these would interrupt a screen
                        reader three times for something nobody has acted on
                        yet, and the Add control already carries it. */}
                    {warnings.length === 0 ? null : (
                      <p className="quickbuild-warns">
                        {warnings.map((w) => (
                          <span key={w}>{w}</span>
                        ))}
                      </p>
                    )}
                    <p className="quickbuild-group">Offered under {candidate.groupLabel}</p>
                  </li>
                  )
                })}
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
