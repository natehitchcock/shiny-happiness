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
}))

const mocked = vi.mocked(api)

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  mocked.searchCards.mockResolvedValue({ items: [] })
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
