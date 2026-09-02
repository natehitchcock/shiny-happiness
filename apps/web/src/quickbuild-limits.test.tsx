// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CardView } from '@roundtable/ui'
import type { QuickbuildGap, QuickbuildPlan } from '@roundtable/domain'
import { Quickbuild, type QuickbuildCandidate } from './Quickbuild'
import { legalityText } from './App'
import type * as api from './api'

/**
 * Quickbuild says what a pick will cost BEFORE the pick (ADR-0051).
 *
 * Two things were silent at the moment of choosing:
 *
 * At 100 of 100 the panel still offered "4 more at mana value 2". One click
 * took the deck to 101, and the only notice was in the legality block below the
 * fold — which also said "1 cards over 100".
 *
 * And accepting Mana Vault from an ordinary ramp gap took a Bracket 3 deck to
 * 4 of 3 Game Changers. ADR-0044 D4 withholds an over-allowance Game Changer
 * from the STAPLES groups only, so it still leads no phase but is still offered
 * everywhere else — correctly, because doc 03 §3.2 forbids filtering on a
 * bracket flag and AGENTS.md §8 lists doing so as a rejected PR. What was
 * missing was not a refusal. It was a sentence.
 *
 * So: warn on the option, refuse nothing. The tests below pin both halves —
 * the warning appears, and the card can still be taken.
 */

afterEach(cleanup)

const view = (name: string): CardView => ({
  oracleId: name,
  name,
  manaCost: '{1}',
  manaValue: 1,
  colorIdentity: [],
  typeLine: 'Artifact',
  oracleText: 'Add mana.',
  primaryRole: 'ramp',
  priceUsd: 1,
  reasons: ['fills a ramp gap of 7'],
})

const candidate = (name: string, over: Partial<QuickbuildCandidate> = {}): QuickbuildCandidate => ({
  oracleId: name,
  view: view(name),
  groupLabel: 'Fills gap · ramp',
  ...over,
})

const rampGap: QuickbuildGap = {
  kind: 'composition',
  key: 'role:ramp',
  label: 'ramp',
  short: 7,
  dimension: { kind: 'role', role: 'ramp' },
}

const plan = (over: Partial<QuickbuildPlan> = {}): QuickbuildPlan => ({
  gaps: [rampGap],
  ordering: 'largest-first',
  overFull: [],
  reach: 'band',
  beyond: [],
  held: 58,
  unallocated: 42,
  unroled: 25,
  ...over,
})

const setup = (
  over: Partial<Parameters<typeof Quickbuild>[0]> = {},
  found: readonly QuickbuildCandidate[] = [candidate('Ai'), candidate('Bo'), candidate('Cy')],
) => {
  const onAdd = vi.fn()
  render(
    <Quickbuild
      plan={plan()}
      filter=""
      fetchCandidates={vi.fn().mockResolvedValue(found)}
      onAdd={onAdd}
      onReject={vi.fn()}
      onClose={vi.fn()}
      onReach={vi.fn()}
      cutCount={0}
      retiredIds={new Set<string>()}
      {...over}
    />,
  )
  return { onAdd }
}

/** Let the panel's first fetch resolve and paint. */
const settle = async (): Promise<void> => {
  await act(async () => {
    await Promise.resolve()
  })
  await act(async () => {
    await Promise.resolve()
  })
}

/**
 * The Add control inside a named option.
 *
 * By option rather than by the button's own name, because the name is exactly
 * what is under test: an unwarned Add is still plainly "Add" — three buttons
 * renamed to serve the rare one would be a repetition on every card — and a
 * warned one carries the consequence. Locating it by the option it sits in lets
 * both cases be asserted the same way.
 */
const addFor = (name: string): HTMLElement => {
  const option = screen
    .getAllByRole('listitem', { name: /^Option \d/ })
    .find((li) => new RegExp(`: ${name}$`).test(li.getAttribute('aria-label') ?? ''))
  if (option === undefined) throw new Error(`no option for ${name}`)
  const add = [...option.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Add')
  if (add === undefined) throw new Error(`no Add control for ${name}`)
  return add
}

/** What a screen reader would call the control — its label, or its text. */
const spokenName = (button: HTMLElement): string =>
  button.getAttribute('aria-label') ?? (button.textContent ?? '').trim()

describe('Quickbuild — the deck is full', () => {
  it('says the deck is at its limit before anything is offered', async () => {
    setup({ plan: plan({ held: 100, unallocated: 0 }) })
    await settle()
    expect(screen.getByText(/already holds 100 of 100/)).toBeTruthy()
  })

  it('puts the consequence on the option itself, where the decision is made', async () => {
    setup({ plan: plan({ held: 100, unallocated: 0 }) })
    await settle()
    // A screen-reader user tabbing onto Add hears what the click will do. The
    // banner above is not on the path of someone moving control to control.
    expect(spokenName(addFor('Ai'))).toMatch(/101 of 100/)
  })

  it('refuses nothing — the card can still be taken, knowingly', async () => {
    // Doc 03 §3.2: the user is allowed to cross their own line. A wizard that
    // blocked the 101st card would be deciding the deck for them.
    const { onAdd } = setup({ plan: plan({ held: 100, unallocated: 0 }) })
    await settle()
    const add = addFor('Ai')
    expect((add as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      add.click()
    })
    expect(onAdd).toHaveBeenCalledWith('Ai')
  })

  it('says nothing about a limit the deck is nowhere near', async () => {
    setup({ plan: plan({ held: 58 }) })
    await settle()
    expect(screen.queryByText(/already holds/)).toBeNull()
    expect(spokenName(addFor('Ai'))).toBe('Add')
  })

  it('says it about an over-full deck too, not only an exactly-full one', async () => {
    setup({ plan: plan({ held: 104, unallocated: 0 }) })
    await settle()
    expect(screen.getByText(/already holds 104 of 100/)).toBeTruthy()
  })
})

describe('Quickbuild — a Game Changer with no bracket room', () => {
  const gc = [candidate('Mana Vault', { bracketFlags: ['game-changer'] }), candidate('Bo')]

  it('names the arithmetic on the option, before the click', async () => {
    setup({ gameChangers: { held: 3, allowed: 3 } }, gc)
    await settle()
    expect(screen.getByText(/takes you to 4 of the 3 your bracket allows/)).toBeTruthy()
  })

  it('carries the same warning in the name of the Add control', async () => {
    setup({ gameChangers: { held: 3, allowed: 3 } }, gc)
    await settle()
    expect(spokenName(addFor('Mana Vault'))).toMatch(/4 of 3 Game Changers/)
  })

  it('still lets the card through — flagged, never filtered', async () => {
    // AGENTS.md §8: "Filtering candidates by bracket instead of flagging them"
    // is a rejected PR. This is the flag, and it is all it is.
    const { onAdd } = setup({ gameChangers: { held: 3, allowed: 3 } }, gc)
    await settle()
    const add = addFor('Mana Vault')
    expect((add as HTMLButtonElement).disabled).toBe(false)
    await act(async () => {
      add.click()
    })
    expect(onAdd).toHaveBeenCalledWith('Mana Vault')
  })

  it('leaves the other two options unmarked', async () => {
    // The warning is about THIS card. Marking the trio would make it noise.
    setup({ gameChangers: { held: 3, allowed: 3 } }, gc)
    await settle()
    expect(spokenName(addFor('Bo'))).toBe('Add')
  })

  it('says nothing when the bracket still has room', async () => {
    setup({ gameChangers: { held: 1, allowed: 3 } }, gc)
    await settle()
    expect(screen.queryByText(/your bracket allows/)).toBeNull()
  })

  it('says nothing when the bracket sets no limit', async () => {
    setup({ gameChangers: { held: 9, allowed: 'unlimited' } }, gc)
    await settle()
    expect(screen.queryByText(/your bracket allows/)).toBeNull()
  })

  it('still names the card as a Game Changer when the allowance is unknown', async () => {
    // `rules === null` — the bracket check is unavailable. Asserting an
    // allowance we were not given would be fabricating a rule (AGENTS.md §8),
    // but the flag itself is a fact the server sent and is worth saying.
    setup({ gameChangers: null }, gc)
    await settle()
    expect(screen.getByText(/is a Game Changer/)).toBeTruthy()
    expect(screen.queryByText(/your bracket allows/)).toBeNull()
  })
})

describe('the legality block counts in English', () => {
  const problem = (actual: number): api.LegalityProblem =>
    ({ kind: 'wrong-card-count', actual, expected: 100 }) as unknown as api.LegalityProblem

  const empty = new Map<string, api.Card>()

  it('says "1 card over 100", not "1 cards"', () => {
    expect(legalityText(problem(101), empty)).toBe('1 card over 100 — the deck has 101.')
  })

  it('says "1 card short of 100" on the other side of the same fence', () => {
    expect(legalityText(problem(99), empty)).toBe('1 card short of 100 — the deck has 99.')
  })

  it('still pluralises everything else', () => {
    expect(legalityText(problem(104), empty)).toBe('4 cards over 100 — the deck has 104.')
    expect(legalityText(problem(9), empty)).toBe('91 cards short of 100 — the deck has 9.')
  })
})
