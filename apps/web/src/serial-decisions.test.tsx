// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DeckCommand } from '@roundtable/domain'
import * as api from './api'
import { Workspace } from './App'

/**
 * Three decisions in series must all reach the server.
 *
 * Reported as "I rejected three cards, but only one ended up on the rejected
 * list". The pipeline restarts on every click after its buffer has closed, and
 * the run it interrupts stays in flight — so with three clicks there are up to
 * three `load` runs racing, each one having read the confirmed deck version
 * before the others moved it. That is by design: a superseded run's WRITES are
 * still wanted, only its read of the suggestions is stale.
 *
 * What was not by design is what happened when the middle run lost the race.
 * Its batch earned a 409, it rebased and re-sent ONCE at the version it had
 * just read, a third run's batch committed in that window, and the re-send
 * earned a second 409 that nothing caught. The command was never applied and
 * the failure was swallowed by the superseded-run guard, so the user was told
 * nothing at all.
 *
 * The fake server below is the smallest thing that can show it: real optimistic
 * concurrency, a real `since` log, and a latency long enough that the runs
 * genuinely overlap the way they do on a real connection.
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

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

/**
 * Long enough that a click landing ~700 ms after the previous one starts its
 * run while the previous batch is still on the wire. That overlap is the whole
 * subject of the test — with an instant server the runs never race and the bug
 * cannot appear, which is why the browser repro needed injected latency too.
 */
const COMMAND_MS = 1_000

const baseDeck = {
  id: 'd1',
  name: 'Test deck',
  commanders: [],
  colorIdentity: ['R'],
  targetBracket: 3,
  archetype: 'midrange',
  version: 1,
  excludeUniversesBeyond: false,
  budget: null,
  entries: [],
} as unknown as api.Deck

const names = ['Alpha Ant', 'Beta Bear', 'Gamma Golem']
const ids = ['o1', 'o2', 'o3']

const cardFor = (oracleId: string, name: string): api.Card =>
  ({
    oracleId,
    name,
    manaCost: '{R}',
    manaValue: 1,
    typeLine: 'Creature — Goblin',
    types: ['creature'],
    oracleText: '',
    power: '1',
    toughness: '1',
    loyalty: null,
    colorIdentity: ['R'],
    primaryRole: 'creature',
    edhrecRank: null,
    universesBeyond: false,
    synergyProduces: [],
    synergyWants: [],
  }) as unknown as api.Card

/** Optimistic concurrency, a `since` log, and latency. Nothing else. */
const server = {
  version: 1,
  excluded: [] as string[],
  accepted: [] as string[],
  log: [] as { version: number; commands: readonly DeckCommand[] }[],
  deck(): api.Deck {
    return {
      ...baseDeck,
      version: this.version,
      entries: [
        ...this.accepted.map((oracleId) => ({
          oracleId,
          zone: 'accepted',
          origin: 'manual',
          locked: false,
          roleOverride: null,
          tags: [],
          addedAt: '2026-01-01T00:00:00.000Z',
        })),
        ...this.excluded.map((oracleId) => ({
          oracleId,
          zone: 'excluded',
          origin: 'manual',
          locked: false,
          roleOverride: null,
          tags: [],
          addedAt: '2026-01-01T00:00:00.000Z',
        })),
      ],
    } as unknown as api.Deck
  },
  reset(): void {
    this.version = 1
    this.excluded = []
    this.accepted = []
    this.log = []
  },
}

const send = async (
  _id: string,
  commands: readonly DeckCommand[],
  baseVersion: number,
): Promise<api.CommandResult> => {
  await sleep(COMMAND_MS)
  if (baseVersion !== server.version) {
    throw new api.ApiError('version conflict', 409, {
      deck: server.deck(),
      since: server.log.filter((b) => b.version > baseVersion).flatMap((b) => [...b.commands]),
      sinceComplete: true,
    } satisfies api.CommandConflict)
  }
  server.version += 1
  for (const c of commands) {
    if (c.type === 'exclude' && !server.excluded.includes(c.oracleId)) {
      server.excluded.push(c.oracleId)
      server.accepted = server.accepted.filter((a) => a !== c.oracleId)
    }
    if (c.type === 'accept' && !server.accepted.includes(c.oracleId)) {
      server.accepted.push(c.oracleId)
      server.excluded = server.excluded.filter((e) => e !== c.oracleId)
    }
  }
  server.log.push({ version: server.version, commands })
  return {
    deck: server.deck(),
    applied: [...commands],
    rejected: [],
  } as unknown as api.CommandResult
}

beforeEach(() => {
  vi.resetAllMocks()
  server.reset()
  mocked.getRecommendations.mockImplementation(() =>
    Promise.resolve({
      datasetSnapshotId: null,
      groups: [
        {
          key: 'fills-ramp',
          label: 'Fills ramp',
          rationale: 'why',
          total: ids.length,
          items: ids.map((oracleId) => ({
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
      query: { matched: ids.length, errors: [] },
    } as unknown as api.Recommendations),
  )
  mocked.getAnalysis.mockResolvedValue({
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
  } as unknown as api.Analysis)
  mocked.hydrate.mockResolvedValue({
    cards: new Map(ids.map((id, i) => [id, cardFor(id, names[i]!)])),
    prices: new Map(),
    images: new Map(),
  } as unknown as api.Hydrated)
  mocked.basicLands.mockResolvedValue({ items: [] })
  mocked.getDeck.mockImplementation(() => Promise.resolve(server.deck()))
  mocked.sendCommands.mockImplementation(send)
})

afterEach(cleanup)

/**
 * Click three rows in series, `gap` apart, then let every run drain.
 *
 * `gap` is deliberately longer than the pipeline's buffer: three clicks INSIDE
 * one buffer are one batch and were never at risk. "Quickly, in series" is the
 * case where each click restarts a cycle whose predecessor is still in flight,
 * and that is the case this reproduces.
 */
const decideThree = async (label: (name: string) => string, gap: number): Promise<void> => {
  for (const name of names) {
    await waitFor(() => expect(screen.getByLabelText(label(name))).toBeTruthy())
    await act(async () => screen.getByLabelText(label(name)).click())
    await act(async () => sleep(gap))
  }
  // Every run in flight has to be allowed to finish, including the 409 rebase.
  await act(async () => sleep(12_000))
}

describe('three decisions in series', () => {
  it('sends all three rejections to the server', async () => {
    render(<Workspace deck={baseDeck} />)
    await decideThree((name) => `Reject ${name}`, 700)

    // The user's own words: three rejected, one on the list. The server is the
    // authority — an optimistic overlay that still shows all three is exactly
    // how the loss stayed invisible until the page was reloaded.
    expect([...server.excluded].sort()).toEqual([...ids].sort())
  }, 40_000)

  it('sends all three accepts to the server', async () => {
    render(<Workspace deck={baseDeck} />)
    await decideThree((name) => `Add ${name}`, 700)

    expect([...server.accepted].sort()).toEqual([...ids].sort())
  }, 40_000)

  it('names the card when a decision cannot be saved at all', async () => {
    // A deck that never stops moving: every batch after the first earns a 409,
    // so no amount of rebasing will place it. Nothing the client can do rescues
    // that — but the one outcome that must never happen is silence, and a
    // sentence that does not say WHICH card is barely better than silence.
    mocked.sendCommands.mockImplementation(async (_id, commands, baseVersion) => {
      await sleep(COMMAND_MS)
      if (server.log.length > 0) {
        throw new api.ApiError('version conflict', 409, {
          deck: server.deck(),
          since: [],
          sinceComplete: true,
        } satisfies api.CommandConflict)
      }
      return send(_id, commands, baseVersion)
    })

    render(<Workspace deck={baseDeck} />)
    await decideThree((name) => `Reject ${name}`, 700)

    const shown = document.body.textContent ?? ''
    expect(shown).toMatch(/not saved/i)
    // The card, by name. "Something went wrong" leaves the user to work out
    // which of three clicks to make again.
    expect(shown).toMatch(/Beta Bear|Gamma Golem/)
  }, 60_000)

  it('reports a refusal even when the run that heard it was superseded', async () => {
    // The server refuses the middle decision and does NOT move the version —
    // an all-rejected batch changes nothing, which is exactly what `decks.ts`
    // does. The run that heard the refusal is superseded by the next click, so
    // before this fix the sentence went down with the run's discarded answer.
    mocked.sendCommands.mockImplementation(async (_id, commands, baseVersion) => {
      await sleep(COMMAND_MS)
      if (commands.some((c) => 'oracleId' in c && c.oracleId === 'o2')) {
        return {
          deck: server.deck(),
          applied: [],
          rejected: commands.map((command) => ({
            command,
            reason: { kind: 'already-excluded', oracleId: 'o2' },
          })),
        } as unknown as api.CommandResult
      }
      return send(_id, commands, baseVersion)
    })

    render(<Workspace deck={baseDeck} />)
    await decideThree((name) => `Reject ${name}`, 700)

    expect(document.body.textContent ?? '').toMatch(/Beta Bear was already rejected/)
  }, 60_000)
})
