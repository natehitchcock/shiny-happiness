// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeckCommand } from '@roundtable/domain'
import * as api from './api'
import { Workspace } from './App'

/**
 * Playtesting the command path: nothing a user did is ever undone or dropped.
 *
 * Reported by the product owner, and this is the whole specification:
 *
 * > "at no point should an operation be undone that a user did. Basic lands
 * > should never be un-added if they add some in quick succession. Cards adds
 * > or removes should never be dropped. The only time a dropped action is
 * > acceptable is if there is a catastrophic loss of connection."
 *
 * `serial-decisions.test.tsx` is four scripted cases against the same shape of
 * fake server, written for one reported sequence (ADR-0036). This is the
 * generalisation: RANDOM sequences of adds, removes and rejections at RANDOM
 * intervals, against a server with RANDOM latency and RANDOM version conflicts.
 * A scripted case can only find the race it was written for; the client has at
 * least three runs in flight at once and the interesting orderings are the ones
 * nobody thought to script.
 *
 * ## What is randomised, and what is asserted
 *
 * Each run picks, from the seed: how many clicks (4–9), the gap between them
 * (0–1400 ms, so some join one buffer and some restart the cycle mid-flight),
 * the server's service time per request (60–900 ms), and whether a send earns a
 * spurious 409 on top of the ones the overlapping runs cause by themselves.
 *
 * Then, per run:
 *
 *  1. the ORDERED list of commands the server actually applied equals the
 *     ordered list of controls the user actually clicked — no drop, no
 *     duplicate, no reordering;
 *  2. the final deck equals a straight fold of those clicks.
 *
 * (1) is the stronger of the two and is why it is asserted separately: a drop
 * and a resurrection can cancel out in the final state, and did.
 *
 * ## Why the clicks are chosen from the DOM
 *
 * A generated script would click controls that are not on screen. The feed
 * drops a card the moment it is decided, and a deck row shows a spinner instead
 * of its buttons while its command is in flight — so what a user CAN do changes
 * as the run goes. Each step therefore reads the live document, picks one of
 * the enabled controls at random, clicks it, and records what that control
 * means. The expectation is built from what was actually clicked, which makes
 * it impossible for the test to expect something the user could not have done.
 *
 * ## Why the clock is fake
 *
 * `serial-decisions.test.tsx` sleeps real seconds and takes ~40 s per case.
 * Twenty randomised runs of that would be a quarter of an hour, and every one
 * of them would be load-sensitive on a busy machine — this suite already has
 * two flakes of that kind. Every timer here is virtual: the pipeline's own
 * interval, the buffer, the settle, the retry backoff and the server's latency
 * all advance together, so a run is exact and takes milliseconds. `performance
 * .now` is pointed at the faked `Date.now` so the pipeline's phase arithmetic
 * moves with them; without that the bar would sit at 0 % forever.
 */

vi.mock('./api', async () => {
  const actual = await vi.importActual<typeof api>('./api')
  return {
    ...actual,
    getRecommendations: vi.fn(),
    getAnalysis: vi.fn(),
    hydrate: vi.fn(),
    basicLands: vi.fn(),
    sendCommands: vi.fn(),
    patchDeck: vi.fn(),
    importPreview: vi.fn(),
    getCardDetail: vi.fn(),
    searchCards: vi.fn(),
    getDeck: vi.fn(),
  }
})

const mocked = vi.mocked(api)

class NoopResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
globalThis.ResizeObserver = NoopResizeObserver as unknown as typeof ResizeObserver

/* ------------------------------------------------------------------ seeds */

/**
 * Seeded, so a failure is reproducible.
 *
 * A suite that finds a bug nobody can reproduce is worse than one that finds
 * nothing: the next agent reruns it, gets a different sequence, and files the
 * failure as a flake. The seed is printed in the test NAME, so it is in the
 * reporter output whether the run passed or failed, and rerunning that one case
 * replays the identical sequence of clicks, latencies and conflicts.
 *
 * Twelve fixed seeds rather than a fresh random one per CI run, for the same
 * reason: a suite that fails only on Tuesdays gets disabled on Wednesday. New
 * ground is covered by ADDING a seed, which makes the coverage a reviewable
 * part of the diff.
 *
 * Twelve is what fits the budget. Each run is a handful of virtual minutes and
 * costs ~0.4 s of real time, so the file lands around 6 s — of a suite that
 * already takes a minute.
 */
const SEEDS = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89, 144, 233]

/** mulberry32 — small, fast, and good enough to shuffle clicks with. */
const rngFor = (seed: number): (() => number) => {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/* ------------------------------------------------------------------- cards */

const CARDS = [
  { oracleId: 'o1', name: 'Alpha Ant', typeLine: 'Creature — Insect' },
  { oracleId: 'o2', name: 'Beta Bear', typeLine: 'Creature — Bear' },
  { oracleId: 'o3', name: 'Gamma Golem', typeLine: 'Creature — Golem' },
  { oracleId: 'o4', name: 'Delta Drake', typeLine: 'Creature — Drake' },
  // The basic. The user named it: "Basic lands should never be un-added if they
  // add some in quick succession." It is the only card the deck may hold more
  // than one of, so it is the only one where a drop and a de-duplication look
  // alike — and `acceptedSet` versus `acceptedCopies` has been the wrong choice
  // twice already.
  { oracleId: 'bw', name: 'Wastes', typeLine: 'Basic Land' },
] as const

const SUGGESTED = ['o1', 'o2', 'o3', 'o4']
const BASIC = 'bw'

const cardFor = (oracleId: string): api.Card => {
  const c = CARDS.find((x) => x.oracleId === oracleId)
  if (c === undefined) throw new Error(`no such fixture card: ${oracleId}`)
  return {
    oracleId: c.oracleId,
    name: c.name,
    manaCost: '{1}',
    manaValue: 1,
    typeLine: c.typeLine,
    types: c.typeLine.startsWith('Basic') ? ['land'] : ['creature'],
    oracleText: '',
    power: '1',
    toughness: '1',
    loyalty: null,
    colorIdentity: [],
    primaryRole: c.typeLine.startsWith('Basic') ? 'land' : 'creature',
    edhrecRank: null,
    universesBeyond: false,
    synergyProduces: [],
    synergyWants: [],
  } as unknown as api.Card
}

const nameOf = (oracleId: string): string => cardFor(oracleId).name

const baseDeck = {
  id: 'd1',
  name: 'Playtest deck',
  commanders: [],
  colorIdentity: [],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [],
} as unknown as api.Deck

/* ------------------------------------------------------------------ model */

/** One thing the user did, in the only three shapes the deck can be changed. */
interface Op {
  readonly type: 'accept' | 'exclude' | 'remove'
  readonly oracleId: string
}

/**
 * The deck as a multiset of accepted copies plus a set of rejections.
 *
 * A LIST for `accepted`, not a Set — three Wastes is three entries, and the
 * whole point of including a basic is that the difference is load-bearing.
 */
interface DeckState {
  accepted: string[]
  excluded: string[]
}

const emptyState = (): DeckState => ({ accepted: [], excluded: [] })

/**
 * Fold one command. The server and the expectation use the SAME function, so
 * the test cannot disagree with itself about what `remove` means; what it is
 * checking is whether the client delivered the commands, not what they do.
 */
const applyOp = (state: DeckState, op: Op): void => {
  if (op.type === 'accept') {
    state.excluded = state.excluded.filter((e) => e !== op.oracleId)
    // A basic may be held any number of times; anything else is a singleton and
    // a second copy is refused (doc 03 §3.1). The generator never asks for one.
    if (op.oracleId === BASIC || !state.accepted.includes(op.oracleId)) {
      state.accepted.push(op.oracleId)
    }
  } else if (op.type === 'remove') {
    // ONE copy (ADR-0012), which is what the basic stepper's minus means.
    const at = state.accepted.indexOf(op.oracleId)
    if (at >= 0) state.accepted.splice(at, 1)
  } else {
    state.accepted = state.accepted.filter((e) => e !== op.oracleId)
    if (!state.excluded.includes(op.oracleId)) state.excluded.push(op.oracleId)
  }
}

/* ----------------------------------------------------------- fake server */

interface Server {
  version: number
  state: DeckState
  /** Every command that actually changed the deck, in the order it landed. */
  applied: Op[]
  log: { version: number; commands: readonly DeckCommand[] }[]
  /** Results already returned for an idempotency key (doc 10 §10.3). */
  seen: Map<string, api.CommandResult>
  /** Set to make every subsequent send fail as a lost connection. */
  offline: boolean
  spuriousLeft: number
  lastWasSpurious: boolean
  deck(): api.Deck
}

const makeServer = (): Server => ({
  version: 1,
  state: emptyState(),
  applied: [],
  log: [],
  seen: new Map(),
  offline: false,
  spuriousLeft: 0,
  lastWasSpurious: false,
  deck(): api.Deck {
    return {
      ...baseDeck,
      version: this.version,
      entries: [
        ...this.state.accepted.map((oracleId) => entry(oracleId, 'accepted')),
        ...this.state.excluded.map((oracleId) => entry(oracleId, 'excluded')),
      ],
    } as unknown as api.Deck
  },
})

const entry = (oracleId: string, zone: string): unknown => ({
  oracleId,
  zone,
  origin: 'manual',
  locked: false,
  roleOverride: null,
  tags: [],
  addedAt: '2026-01-01T00:00:00.000Z',
})

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

let server = makeServer()
let rng: () => number = Math.random

/**
 * One connection, serving one write at a time.
 *
 * Requests queue behind each other rather than each sleeping independently, so
 * a fast second response cannot overtake a slow first one. That is deliberate
 * and it is what makes "the order the server applied them" a meaningful thing
 * to assert: a channel that reorders the user's own batches would break the
 * invariant in the transport rather than in the client, and no amount of client
 * logic could then keep the promise the report asks for. Overlapping runs still
 * conflict — each captured its base version before the others moved it — which
 * is the race this suite is about.
 */
let channel: Promise<unknown> = Promise.resolve()

const queued = <T,>(work: () => Promise<T>): Promise<T> => {
  const mine = channel.then(work, work)
  // Swallow on the shared chain only. The caller still sees the rejection.
  channel = mine.then(
    () => undefined,
    () => undefined,
  )
  return mine
}

const wire = (c: DeckCommand): Op => ({
  type: c.type as Op['type'],
  oracleId: (c as { oracleId: string }).oracleId,
})

const send = (
  _id: string,
  commands: readonly DeckCommand[],
  baseVersion: number,
  idempotencyKey?: string,
): Promise<api.CommandResult> =>
  queued(async () => {
    await sleep(60 + Math.floor(rng() * 840))

    if (server.offline) {
      // What a dropped connection actually looks like to `request`: no status,
      // because there was no response.
      throw new api.ApiError('Failed to fetch', 0, null)
    }

    // Doc 10 §10.3: the same key is the same batch, and a retry of a batch that
    // did commit must not commit it twice.
    const already = idempotencyKey === undefined ? undefined : server.seen.get(idempotencyKey)
    if (already !== undefined) return already

    /*
     * A conflict the overlapping runs did not cause by themselves.
     *
     * Real decks are written by other tabs and other people, and the client is
     * supposed to rebase and carry on. Budgeted and never twice in a row, so
     * the bounded retry loop in `load` cannot be exhausted by the test itself —
     * exhausting it is a different behaviour with its own test below.
     */
    if (server.spuriousLeft > 0 && !server.lastWasSpurious && rng() < 0.35) {
      server.spuriousLeft -= 1
      server.lastWasSpurious = true
      throw new api.ApiError('version conflict', 409, {
        deck: server.deck(),
        since: [],
        sinceComplete: true,
      } satisfies api.CommandConflict)
    }
    server.lastWasSpurious = false

    if (baseVersion !== server.version) {
      throw new api.ApiError('version conflict', 409, {
        deck: server.deck(),
        since: server.log.filter((b) => b.version > baseVersion).flatMap((b) => [...b.commands]),
        sinceComplete: true,
      } satisfies api.CommandConflict)
    }

    server.version += 1
    for (const c of commands) {
      const op = wire(c)
      applyOp(server.state, op)
      server.applied.push(op)
    }
    server.log.push({ version: server.version, commands })
    const result = {
      deck: server.deck(),
      applied: [...commands],
      rejected: [],
    } as unknown as api.CommandResult
    if (idempotencyKey !== undefined) server.seen.set(idempotencyKey, result)
    return result
  })

/* --------------------------------------------------------------- the clock */

/**
 * Advance virtual time, letting React and every promise chain catch up.
 *
 * `advanceTimersByTimeAsync` is the async form on purpose: the command path is
 * `await send` then `await getDeck` then `await getRecommendations`, and the
 * synchronous form does not drain the microtask queue between timers, so those
 * awaits would never resume. In chunks so a click can be delivered at a precise
 * virtual moment rather than at the end of a jump.
 */
const advance = async (ms: number): Promise<void> => {
  let left = ms
  while (left > 0) {
    const step = Math.min(200, left)
    left -= step
    await act(async () => {
      await vi.advanceTimersByTimeAsync(step)
    })
  }
}

/** Run everything still in flight out — the settle, the retries, the rebases. */
const drain = async (): Promise<void> => {
  // Generous: a conflicted batch can cost several round trips, each up to
  // ~0.9 s, plus the 1.5 s settle. Virtual time, so length is free.
  await advance(60_000)
}

/* ------------------------------------------------------------- the clicker */

/**
 * Every control on screen that changes the deck, and what it means.
 *
 * Read from the document each time because what a user can do MOVES: a decided
 * card leaves the feed, and a deck row wears a spinner instead of its buttons
 * while its own command is in flight. Choosing from this list is what keeps the
 * generated sequence to things a person could actually have clicked.
 */
interface Control {
  readonly button: HTMLButtonElement
  readonly op: Op
}

const controls = (): Control[] => {
  const found: Control[] = []
  for (const button of document.querySelectorAll<HTMLButtonElement>('button[aria-label]')) {
    if (button.disabled) continue
    const label = button.getAttribute('aria-label') ?? ''
    for (const card of CARDS) {
      if (label === `Add ${card.name}`) found.push({ button, op: op('accept', card.oracleId) })
      // The feed's Reject and the deck rail's Remove are the same command; the
      // difference is only where the user was standing when they decided.
      else if (label === `Reject ${card.name}` || label === `Remove ${card.name}`) {
        found.push({ button, op: op('exclude', card.oracleId) })
      } else if (label === `One more ${card.name}`) {
        found.push({ button, op: op('accept', card.oracleId) })
      } else if (label === `One fewer ${card.name}`) {
        found.push({ button, op: op('remove', card.oracleId) })
      }
    }
  }
  return found
}

const op = (type: Op['type'], oracleId: string): Op => ({ type, oracleId })

/* ---------------------------------------------------------------- fixtures */

const recommendationsFor = (): api.Recommendations => {
  // The server never re-offers a card the deck has decided on (pillar P6). The
  // basic is never in the feed at all — it has its own stepper.
  const decided = new Set([...server.state.accepted, ...server.state.excluded])
  const items = SUGGESTED.filter((id) => !decided.has(id))
  return {
    datasetSnapshotId: null,
    groups: [
      {
        key: 'fills-ramp',
        label: 'Fills ramp',
        rationale: 'why',
        total: items.length,
        items: items.map((oracleId) => ({
          oracleId,
          comboDegree: 0,
          nearCombosAt1: 0,
          score: 1,
          reasons: ['x'],
        })),
      },
    ],
    columns: [],
    unavailable: [],
    query: { matched: items.length, errors: [] },
  } as unknown as api.Recommendations
}

const installMocks = (): void => {
  mocked.getRecommendations.mockImplementation(async () => {
    // Reads have their own latency and are NOT queued behind the writes: a
    // recompute racing a command is exactly the situation the pipeline exists
    // for, and serialising it would hide it.
    await sleep(40 + Math.floor(rng() * 200))
    return recommendationsFor()
  })
  mocked.getAnalysis.mockImplementation(async () => {
    await sleep(20 + Math.floor(rng() * 120))
    return {
      counts: { total: 0, byRole: {} },
      targets: [],
      cuts: [],
      deficits: [],
      archetype: { declared: 'midrange', assessed: 'midrange', confidence: 0.5 },
      curve: {
        averageManaValue: 0,
        histogram: [0, 0, 0, 0, 0, 0, 0, 0],
        target: [],
        locked: [0, 0, 0, 0, 0, 0, 0, 0],
        deltas: [],
      },
      legality: { legal: true, problems: [] },
      deckCombos: [],
      prices: { deckTotalUsd: 0, pricedCards: 0, unpricedCards: 0, budget: null },
      unavailable: [],
    } as unknown as api.Analysis
  })
  mocked.hydrate.mockResolvedValue({
    cards: new Map(CARDS.map((c) => [c.oracleId, cardFor(c.oracleId)])),
    prices: new Map(),
    images: new Map(),
  } as unknown as api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [cardFor(BASIC)] })
  mocked.getDeck.mockImplementation(async () => {
    await sleep(20 + Math.floor(rng() * 160))
    return server.deck()
  })
  mocked.sendCommands.mockImplementation(send)
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers()
  // The pipeline measures every phase with `performance.now`. Faking the timers
  // without faking this leaves it reading the real wall clock, so the bar never
  // leaves 0 % and no buffer ever closes. `Date.now` is already faked, and only
  // differences are ever taken, so the epoch offset does not matter.
  vi.spyOn(performance, 'now').mockImplementation(() => Date.now())
  server = makeServer()
  channel = Promise.resolve()
  installMocks()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

/* ------------------------------------------------------------------- suite */

describe('playtesting: no add, remove or rejection is ever lost', () => {
  for (const seed of SEEDS) {
    it(`holds for every click in seed ${String(seed)}`, async () => {
      rng = rngFor(seed)
      server.spuriousLeft = Math.floor(rng() * 3)

      render(<Workspace deck={baseDeck} />)
      // The first load has no settle, but it still has to land before there is
      // anything on screen to click.
      await advance(3_000)

      const clicks: Op[] = []
      const gaps: number[] = []
      const wanted = 4 + Math.floor(rng() * 6)

      for (let i = 0; i < wanted; i += 1) {
        const available = controls()
        if (available.length === 0) break
        const chosen = available[Math.floor(rng() * available.length)]
        if (chosen === undefined) break
        clicks.push(chosen.op)
        await act(async () => {
          chosen.button.click()
        })
        /*
         * 0–1400 ms. Below the 600 ms buffer the clicks batch together and were
         * never at risk; above it each click restarts a cycle whose predecessor
         * is still on the wire, which is the whole subject. Spanning the
         * boundary means a single run does both.
         */
        const gap = Math.floor(rng() * 1_400)
        gaps.push(gap)
        await advance(gap)
      }

      await drain()

      const context = `seed ${String(seed)} · clicks ${JSON.stringify(clicks)} · gaps ${JSON.stringify(gaps)}`

      // (1) Every click, once, in order. A drop, a duplicate and a reordering
      // are three different bugs and this names which one happened; the state
      // check below can only say that something did.
      expect(server.applied, context).toEqual(clicks)

      // (2) And the deck they add up to. Asserted separately because a lost
      // command and a resurrected one can cancel out in the final state.
      const expected = emptyState()
      for (const c of clicks) applyOp(expected, c)
      expect([...server.state.accepted].sort(), context).toEqual([...expected.accepted].sort())
      expect([...server.state.excluded].sort(), context).toEqual([...expected.excluded].sort())
    })
  }
})

/**
 * Basics, in quick succession, at every gap the pipeline treats differently.
 *
 * *"Basic lands should never be un-added if they add some in quick
 * succession."* The randomised runs above reach this by luck; these reach it on
 * purpose, because it is the case the report names and the case the code is
 * most likely to get wrong — every other card in a Commander deck is a
 * singleton, so `accept` twice for the same oracle id only means anything here.
 * `countComposition` changed to count COPIES today, and `acceptedSet` versus
 * `acceptedCopies` has been the wrong choice twice; a set-shaped mistake
 * anywhere on this path collapses eight Wastes into one and looks like six
 * dropped clicks.
 *
 * The gaps are chosen against the pipeline's own boundaries rather than at
 * random: inside one buffer, straddling it, and past it into the settle. Each
 * is a different number of runs in flight.
 */
describe('adding the same basic land over and over', () => {
  for (const gap of [0, 120, 650, 1_100, 1_900]) {
    it(`keeps all eight copies at ${String(gap)} ms apart`, async () => {
      rng = rngFor(9_000 + gap)
      server.spuriousLeft = 2

      render(<Workspace deck={baseDeck} />)
      await advance(3_000)

      for (let i = 0; i < 8; i += 1) {
        const plus = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(
          (b) => b.getAttribute('aria-label') === `One more ${nameOf(BASIC)}`,
        )
        expect(plus, `the + control disappeared after ${String(i)} clicks`).toBeTruthy()
        await act(async () => {
          plus?.click()
        })
        await advance(gap)
      }
      await drain()

      const context = `gap ${String(gap)} ms · applied ${JSON.stringify(server.applied)}`
      expect(
        server.state.accepted.filter((id) => id === BASIC),
        context,
      ).toHaveLength(8)
    })
  }

  it('lets a removal in among them without losing either', async () => {
    // Plus, plus, minus, plus. The minus is the operation most at risk: it is
    // the only one in the sequence that can be reordered into a no-op, because
    // "remove one copy" of a card that has none is a command the server drops
    // on the floor rather than an error anybody sees.
    rng = rngFor(4_242)
    server.spuriousLeft = 2

    render(<Workspace deck={baseDeck} />)
    await advance(3_000)

    const press = async (label: string): Promise<void> => {
      const button = [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(
        (b) => b.getAttribute('aria-label') === label && !b.disabled,
      )
      expect(button, `${label} was not available`).toBeTruthy()
      await act(async () => {
        button?.click()
      })
    }

    for (const step of ['more', 'more', 'fewer', 'more', 'fewer', 'more'] as const) {
      await press(`One ${step} ${nameOf(BASIC)}`)
      await advance(700)
    }
    await drain()

    expect(server.applied).toEqual([
      op('accept', BASIC),
      op('accept', BASIC),
      op('remove', BASIC),
      op('accept', BASIC),
      op('remove', BASIC),
      op('accept', BASIC),
    ])
    expect(server.state.accepted.filter((id) => id === BASIC)).toHaveLength(2)
  })
})

/**
 * The one drop the user allowed, and the condition attached to it.
 *
 * *"The only time a dropped action is acceptable is if there is a catastrophic
 * loss of connection."* So the assertion is not that the command survives — it
 * cannot — but that the user is TOLD, by name, that it did not.
 *
 * The second click is what makes this the interesting case: it supersedes the
 * run whose batch is failing, and a superseded run's rejected promise is
 * discarded by `usePipeline` on purpose. ADR-0036 took the 409 path off that
 * channel and left this one on it, so the exact failure it was written to close
 * was still reachable through a dropped connection.
 */
describe('a connection that goes away', () => {
  it('says which card was lost, even when a later click superseded the run', async () => {
    rng = rngFor(777)

    render(<Workspace deck={baseDeck} />)
    await advance(3_000)

    const feed = controls().filter((c) => c.op.type === 'accept' && c.op.oracleId !== BASIC)
    const first = feed[0]
    const second = feed[1]
    expect(first).toBeTruthy()
    expect(second).toBeTruthy()

    server.offline = true
    await act(async () => {
      first?.button.click()
    })
    // Far enough past the 600 ms buffer that the batch is away and its four
    // retries are running; the next click restarts the cycle and orphans it.
    await advance(900)
    await act(async () => {
      second?.button.click()
    })
    await drain()

    // Nothing reached the deck — which is allowed, this once.
    expect(server.applied).toEqual([])
    // What is not allowed is silence. The card, by name, in the document.
    const shown = document.body.textContent ?? ''
    expect(shown).toMatch(/connection dropped/i)
    expect(shown).toMatch(new RegExp(nameOf(first?.op.oracleId ?? '')))
  })

  it('carries on once the connection comes back', async () => {
    // The other half of "acceptable": the app has to be usable afterwards. A
    // failed batch must not wedge the send queue behind it — it is a promise
    // chain now, and a chain that never resolves is a deck that never saves
    // again.
    rng = rngFor(778)

    render(<Workspace deck={baseDeck} />)
    await advance(3_000)

    server.offline = true
    const lost = controls().find((c) => c.op.type === 'accept' && c.op.oracleId !== BASIC)
    await act(async () => {
      lost?.button.click()
    })
    await drain()
    expect(server.applied).toEqual([])

    server.offline = false
    const saved = controls().find((c) => c.op.type === 'accept' && c.op.oracleId !== BASIC)
    expect(saved, 'nothing was clickable after the connection came back').toBeTruthy()
    await act(async () => {
      saved?.button.click()
    })
    await drain()

    expect(server.applied).toEqual([saved?.op])
  })
})
