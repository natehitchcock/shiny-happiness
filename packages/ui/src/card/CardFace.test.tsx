// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CardFace } from './CardFace.js'
import { CARD_ASPECT, levelSpec } from './presentation.js'
import type { CardView } from './types.js'

afterEach(cleanup)

const card = (over: Partial<CardView> = {}): CardView => ({
  oracleId: 'o1',
  name: 'Dockside Extortionist',
  manaCost: '{1}{R}',
  manaValue: 2,
  colorIdentity: ['R'],
  typeLine: 'Creature — Goblin Pirate',
  oracleText:
    'When this creature enters, create a Treasure token for each artifact and enchantment opponents control.',
  priceUsd: 61.4,
  imageUris: { normal: 'https://example.test/dockside.jpg' },
  ...over,
})

describe('CardFace — size', () => {
  it('renders at the L2 width and the real card proportion', () => {
    render(<CardFace card={card()} />)
    const image = screen.getByRole('img')
    const w = levelSpec(2).width
    expect(image.getAttribute('width')).toBe(String(w))
    expect(image.getAttribute('height')).toBe(String(Math.round(w * CARD_ASPECT)))
  })

  it('loads the full card image, never the art crop', () => {
    render(<CardFace card={card({ imageUris: { artCrop: 'art.jpg', normal: 'full.jpg' } })} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('full.jpg')
  })
})

describe('CardFace — accessibility', () => {
  it('gives the image the card name, because at L2 the image IS the content', () => {
    // The opposite of the L1 rule, and deliberately so: at 220 px the image is
    // what is being read, so it cannot be decorative.
    render(<CardFace card={card()} />)
    expect(screen.getByRole('img').getAttribute('alt')).toBe('Dockside Extortionist')
  })

  it('opens on Enter and on Space', () => {
    for (const key of ['Enter', ' ']) {
      const onActivate = vi.fn()
      render(<CardFace card={card()} onActivate={onActivate} />)
      const button = screen.getByRole('button')
      button.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      expect(onActivate, `key ${key}`).toHaveBeenCalledWith('o1')
      cleanup()
    }
  })

  it('says a price is unknown rather than rendering nothing', () => {
    // Rendering nothing reads as "free", which is the one wrong answer — several
    // of the most expensive cards have no price on their default printing.
    render(<CardFace card={card({ priceUsd: null })} />)
    expect(screen.getByLabelText('price unknown').textContent).toBe('$—')
  })

  it('states a bracket flag as a word, never as a colour alone', () => {
    render(<CardFace card={card({ bracketFlags: ['game changer'] })} />)
    expect(screen.getByText('game changer')).toBeDefined()
  })
})

describe('CardFace — the badge row', () => {
  it('puts the combo badge in the flow row, alongside the price', () => {
    // At L2 there is no art frame to pin to. The badge belongs in the row with
    // everything else, and the CSS only pins it inside `.rt-tile-art`.
    const { container } = render(<CardFace card={card({ comboDegree: 2 })} />)
    const row = container.querySelector('.rt-face-badges')
    expect(row?.querySelector('.rt-combo')?.textContent).toBe('2')
    expect(row?.querySelector('.rt-price')).not.toBeNull()
  })
})

describe('CardFace — an unresolved printing', () => {
  it('falls back to a readable text panel, not a broken image', () => {
    render(<CardFace card={card({ imageUris: undefined })} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Dockside Extortionist')).toBeDefined()
    expect(screen.getByText('{1}{R}')).toBeDefined()
    expect(screen.getByText('Creature — Goblin Pirate')).toBeDefined()
  })

  it('is still activatable, because an unresolved card is still a card you may accept', () => {
    const onActivate = vi.fn()
    render(<CardFace card={card({ imageUris: undefined })} onActivate={onActivate} />)
    screen.getByRole('button').click()
    expect(onActivate).toHaveBeenCalledWith('o1')
  })
})

describe('CardFace — actions', () => {
  it('renders the actions the app supplies', () => {
    // Accept / never / lock are the app's business, not the primitive's — but
    // the primitive has to leave room for them or the loop breaks.
    render(<CardFace card={card()} actions={<button type="button">Add</button>} />)
    expect(screen.getByText('Add')).toBeDefined()
  })
})
