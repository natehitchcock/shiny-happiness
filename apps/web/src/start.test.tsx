// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from './api'
import { App } from './App'

/**
 * The Start screen against an empty or unreachable API.
 *
 * The symptom that produced these: a deployed instance pointed at a database
 * with no cards in it. Every search returned nothing, the button stayed
 * disabled, and the screen said nothing at all — so "the corpus was never
 * loaded" and "this text box is broken" looked identical.
 */
vi.mock('./api', () => ({
  searchCards: vi.fn(),
  createDeck: vi.fn(),
  getDeck: vi.fn(),
  listDecks: vi.fn(),
  // A successful create mounts the Workspace, which reaches for these on the
  // way up. Stubbed so the create path can be followed all the way through.
  getRecommendations: vi.fn(),
  getAnalysis: vi.fn(),
  hydrate: vi.fn(),
  basicLands: vi.fn(),
  sendCommands: vi.fn(),
  patchDeck: vi.fn(),
  importPreview: vi.fn(),
  getCardDetail: vi.fn(),
}))

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocked.searchCards.mockResolvedValue({ items: [] })
  mocked.getRecommendations.mockResolvedValue({
    datasetSnapshotId: null,
    groups: [],
    columns: [],
    unavailable: [],
    query: { matched: 0, errors: [] },
  } as unknown as api.Recommendations)
  mocked.getAnalysis.mockRejectedValue(new Error('not needed for these tests'))
  mocked.hydrate.mockResolvedValue({ cards: new Map(), prices: new Map() })
  mocked.basicLands.mockResolvedValue({ items: [] })
})

afterEach(cleanup)

const type = async (text: string): Promise<void> => {
  const box = screen.getByLabelText('Commander') as HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(box, text)
    box.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

const card = (name: string): api.Card => ({
  oracleId: `o-${name}`,
  name,
  manaCost: '{2}{R}',
  manaValue: 3,
  typeLine: 'Legendary Creature — Goblin',
  types: ['creature'],
  oracleText: '',
  colorIdentity: ['R'],
  primaryRole: 'wincon',
  edhrecRank: null,
  universesBeyond: false,
})

describe('picking a commander', () => {
  it('says the search found nothing, rather than showing an empty screen', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await type('Krenko')

    await waitFor(() => expect(screen.getByText(/No legendary creature matches/)).toBeDefined())
  })

  it('surfaces an API failure instead of swallowing it', async () => {
    // The old version caught the error, set an empty list, and rendered
    // nothing — so an unreachable API looked like a card that does not exist.
    mocked.searchCards.mockRejectedValue(new Error('Request failed (500)'))
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await type('Krenko')

    await waitFor(() => expect(screen.getByText(/not answering/)).toBeDefined())
    expect(screen.getByText(/Request failed \(500\)/)).toBeDefined()
  })

  it('points at the Universes Beyond filter when it is the likely cause', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await act(async () => {
      screen.getByLabelText(/Exclude Universes Beyond/).click()
    })
    await type('Optimus')

    await waitFor(() => expect(screen.getByText(/try unchecking that/)).toBeDefined())
  })

  it('says why the button is disabled, rather than being a dead end', async () => {
    render(<App />)
    await waitFor(() => expect(screen.getByText('Start building')).toBeDefined())
    expect(screen.getByText('Start building').closest('button')?.disabled).toBe(true)
    expect(screen.getByText('Pick a commander to continue.')).toBeDefined()
  })

  it('enables the button once a commander is chosen', async () => {
    mocked.searchCards.mockResolvedValue({ items: [card('Krenko, Mob Boss')] })
    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await type('Krenko')

    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeDefined())
    await act(async () => {
      screen.getByText('Choose').click()
    })

    expect(screen.getByText('Start building').closest('button')?.disabled).toBe(false)
    expect(screen.queryByText('Pick a commander to continue.')).toBeNull()
  })
})

describe('the Start button, once a commander is chosen', () => {
  it('stays enabled and calls createDeck when clicked', async () => {
    // Reported from the deployment: "even after selecting a commander I still
    // can't use Start building". This is the client-side half of that claim,
    // pinned down so the remaining suspects are all server-side.
    mocked.searchCards.mockResolvedValue({ items: [card('Krenko, Mob Boss')] })
    mocked.createDeck.mockResolvedValue({
      id: 'd1',
      name: 'Krenko, Mob Boss deck',
      description: '',
      commanders: ['o-Krenko, Mob Boss'],
      colorIdentity: ['R'],
      targetBracket: 3,
      archetype: 'midrange',
      version: 1,
      excludeUniversesBeyond: false,
      budget: null,
      entries: [],
    })

    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await type('Krenko')
    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeDefined())
    await act(async () => {
      screen.getByText('Choose').click()
    })

    const button = screen.getByText('Start building').closest('button')!
    expect(button.disabled).toBe(false)

    await act(async () => {
      button.click()
    })
    expect(mocked.createDeck).toHaveBeenCalledWith(
      expect.objectContaining({ commanders: ['o-Krenko, Mob Boss'] }),
    )
  })

  it('shows why it failed rather than appearing to do nothing', async () => {
    // The other half: if createDeck rejects, the button re-enables and the
    // reason is on screen. Silence here is indistinguishable from a dead button.
    mocked.searchCards.mockResolvedValue({ items: [card('Krenko, Mob Boss')] })
    mocked.createDeck.mockRejectedValue(new Error('Request failed (500)'))

    render(<App />)
    await waitFor(() => expect(screen.getByLabelText('Commander')).toBeDefined())
    await type('Krenko')
    await waitFor(() => expect(screen.getByText('Krenko, Mob Boss')).toBeDefined())
    await act(async () => {
      screen.getByText('Choose').click()
    })
    await act(async () => {
      screen.getByText('Start building').closest('button')!.click()
    })

    await waitFor(() => expect(screen.getByText(/Request failed \(500\)/)).toBeDefined())
    expect(screen.getByText('Start building').closest('button')!.disabled).toBe(false)
  })
})
