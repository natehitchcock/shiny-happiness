// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Detail } from './Detail.js'
import type { ComboLine } from './Detail.js'
import type { CardView } from './types.js'

afterEach(cleanup)

const card = (over: Partial<CardView> = {}): CardView => ({
  oracleId: 'o1',
  name: 'Thassa, Deep-Dwelling',
  manaCost: '{3}{U}',
  manaValue: 4,
  colorIdentity: ['U'],
  typeLine: 'Legendary Creature — God',
  oracleText:
    'At the beginning of your end step, exile up to one other target creature you control, then return it.',
  primaryRole: 'engine',
  priceUsd: 4.2,
  reasons: ['Blinks your enter-the-battlefield creatures every turn', 'Completes 2 combos'],
  imageUris: { normal: 'https://example.test/thassa.jpg' },
  ...over,
})

const combo = (over: Partial<ComboLine> = {}): ComboLine => ({
  comboId: 'c1',
  pieces: ['Thassa, Deep-Dwelling', 'Peregrine Drake'],
  missing: [],
  result: 'Infinite mana',
  ...over,
})

/**
 * Pillar P4 is the reason this component exists in the shape it does. These are
 * the tests that hold it.
 */
describe('Detail — reasons', () => {
  it('lists every reason the recommendation carried', () => {
    render(<Detail card={card()} />)
    expect(screen.getByText('Blinks your enter-the-battlefield creatures every turn')).toBeDefined()
    expect(screen.getByText('Completes 2 combos')).toBeDefined()
  })

  it('says so loudly when a recommendation arrived with no reasons', () => {
    // P4 makes an empty reasons list a BUG. Quietly omitting the section would
    // hide the exact defect the pillar exists to prevent, so the absence is
    // rendered rather than skipped.
    render(<Detail card={card({ reasons: [] })} />)
    expect(screen.getByText(/No reasons were supplied/)).toBeDefined()
  })

  it('does the same when the field is missing entirely, not just empty', () => {
    render(<Detail card={card({ reasons: undefined })} />)
    expect(screen.getByText(/No reasons were supplied/)).toBeDefined()
  })
})

describe('Detail — combos', () => {
  it('shows every piece, including the ones already in the deck', () => {
    render(<Detail card={card()} combos={[combo()]} />)
    expect(screen.getByText('Thassa, Deep-Dwelling + Peregrine Drake')).toBeDefined()
    expect(screen.getByText('Infinite mana')).toBeDefined()
  })

  it('distinguishes an assembled combo from one still missing a piece', () => {
    render(
      <Detail
        card={card()}
        combos={[combo(), combo({ comboId: 'c2', missing: ['Deadeye Navigator'] })]}
      />,
    )
    expect(screen.getByText('assembled')).toBeDefined()
    expect(screen.getByText('needs Deadeye Navigator')).toBeDefined()
  })

  it('says there are none rather than showing an empty heading', () => {
    render(<Detail card={card()} combos={[]} />)
    expect(screen.getByText(/Not part of any combo/)).toBeDefined()
  })
})

describe('Detail — decide without closing', () => {
  it('renders the actions outside the scrolling body', () => {
    // doc 06 §6.5: "accept/exclude stay reachable without closing it". That
    // fails the moment the button can be scrolled out of view, so the action
    // slot must be a sibling of the scroll container, not a child of it.
    const { container } = render(
      <Detail card={card()} actions={<button type="button">Add to deck</button>} />,
    )
    const body = container.querySelector('.rt-detail-body')
    expect(body).not.toBeNull()
    expect(body?.contains(screen.getByText('Add to deck'))).toBe(false)
  })
})

describe('Detail — a correctable role', () => {
  it('puts the correction control next to the claim it corrects', () => {
    // doc 02 §2.4: roles are derived, imperfect, and overridable.
    const onCorrectRole = vi.fn()
    render(<Detail card={card()} onCorrectRole={onCorrectRole} />)
    screen.getByText('Not right?').click()
    expect(onCorrectRole).toHaveBeenCalledWith('o1')
  })

  it('omits the control when the app has nowhere to send the correction', () => {
    render(<Detail card={card()} />)
    expect(screen.queryByText('Not right?')).toBeNull()
  })
})

describe('Detail — reading, not scanning', () => {
  it('repeats the oracle text outside the image', () => {
    // The opposite of the L2 rule. An image is not selectable, translatable, or
    // resizable, and L3 is the level where someone is reading.
    render(<Detail card={card()} />)
    expect(screen.getByText(/At the beginning of your end step/)).toBeDefined()
    expect(screen.getByRole('img').getAttribute('alt')).toBe('Thassa, Deep-Dwelling')
  })

  it('names the whole panel for a screen reader', () => {
    render(<Detail card={card()} />)
    expect(screen.getByLabelText('Thassa, Deep-Dwelling, details')).toBeDefined()
  })
})
