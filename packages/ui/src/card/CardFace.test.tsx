// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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

  it('reserves the box before the art lands, so nothing under it moves', () => {
    // The frame carries the same width and height the image will, as inline
    // styles. Without them a column of faces reflows every time one loads —
    // and with 100 cards in a deck list that is the whole page jumping under
    // whoever is reading it.
    const { container } = render(<CardFace card={card()} />)
    const frame = container.querySelector<HTMLElement>('.rt-face-image')
    const w = levelSpec(2).width
    expect(frame?.style.width).toBe(`${String(w)}px`)
    expect(frame?.style.height).toBe(`${String(Math.round(w * CARD_ASPECT))}px`)
  })
})

describe('CardFace — loading', () => {
  it('loads lazily and decodes off the main thread', () => {
    // A deck list is around 100 of these. Eager loading fetches every one of
    // them before the first is on screen, and synchronous decoding blocks the
    // scroll that brought them into view.
    render(<CardFace card={card()} />)
    const image = screen.getByRole('img')
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(image.getAttribute('decoding')).toBe('async')
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
    // The cost is symbols now (ADR-0015), so the readable form of it is the
    // screen-reader sentence rather than the brace shorthand.
    expect(screen.getByText('mana cost 1 generic, red')).toBeDefined()
    expect(screen.getByText('Creature — Goblin Pirate')).toBeDefined()
  })

  it('is still activatable, because an unresolved card is still a card you may accept', () => {
    const onActivate = vi.fn()
    render(<CardFace card={card({ imageUris: undefined })} onActivate={onActivate} />)
    screen.getByRole('button').click()
    expect(onActivate).toHaveBeenCalledWith('o1')
  })

  it('falls back on an empty URL as well as on a missing one', () => {
    // `''` is a real spelling of "no art" in this codebase: the database stores
    // NULL and reads it back as an empty string. Left alone it becomes
    // `<img src="">`, which resolves to the page URL — a second request for the
    // document, drawn as a broken image where the readable panel belongs.
    render(<CardFace card={card({ imageUris: { normal: '' } })} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('Dockside Extortionist')).toBeDefined()
  })
})

describe('CardFace — a button only when there is something to open', () => {
  it('announces itself as a button when it can be activated', () => {
    render(<CardFace card={card()} onActivate={vi.fn()} />)
    const frame = screen.getByRole('button')
    expect(frame.getAttribute('tabindex')).toBe('0')
    expect(frame.getAttribute('aria-label')).toBe('Dockside Extortionist. Open details.')
  })

  it('is not a button, and not focusable, when nothing happens on activation', () => {
    /*
     * The frame used to claim `role="button"` and "Open details." whatever it
     * was given. In the two places that show a card rather than offer one —
     * the preview panel, where the details are already open around it, and the
     * commander confirmation on the start screen — that put a control in the
     * tab order that announced an action and then did nothing.
     */
    const { container } = render(<CardFace card={card()} />)
    expect(screen.queryByRole('button')).toBeNull()
    const frame = container.querySelector('.rt-face-image')
    expect(frame?.getAttribute('tabindex')).toBeNull()
    expect(frame?.getAttribute('aria-label')).toBeNull()
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

/**
 * The workspace's preview panel draws its picture through this component, so
 * this is where the flip control reaches the app. All three of ADR-0027's
 * states are covered: one face, two faces with art, two faces without.
 */
describe('CardFace — the flip control', () => {
  const twoFaced = (over: Partial<CardView> = {}): CardView =>
    card({
      oracleId: 'tergrid',
      name: "Tergrid, God of Fright // Tergrid's Lantern",
      imageUris: { normal: 'front.jpg' },
      backImageUris: { normal: 'back.jpg' },
      ...over,
    })

  it('offers nothing to flip on a card with one physical face', () => {
    const { container } = render(<CardFace card={card()} />)
    expect(container.querySelector('.rt-flip')).toBeNull()
  })

  it('swaps the picture for the back face and names it', () => {
    render(<CardFace card={twoFaced()} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('front.jpg')
    expect(screen.getByRole('img').getAttribute('alt')).toBe('Tergrid, God of Fright')
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    expect(screen.getByRole('img').getAttribute('src')).toBe('back.jpg')
    expect(screen.getByRole('img').getAttribute('alt')).toBe("Tergrid's Lantern")
  })

  it('keeps the control outside the frame that can itself be a button', () => {
    // A <button> inside a role="button" is a nested interactive control: the
    // outer one swallows the click on some assistive technology and the tab
    // order gets a target announced as "button, button". The flip control is a
    // SIBLING of `.rt-face-image` for that reason, not an overlay inside it.
    const { container } = render(<CardFace card={twoFaced()} onActivate={vi.fn()} />)
    const frame = container.querySelector('.rt-face-image')
    const flip = container.querySelector('.rt-flip')
    expect(frame?.getAttribute('role')).toBe('button')
    expect(flip).not.toBeNull()
    expect(frame?.contains(flip)).toBe(false)
  })

  it('does not activate the card when the flip control is pressed', () => {
    // The regression the arrangement above exists to stop: pressing "show the
    // back" must not also open the card's details.
    const onActivate = vi.fn()
    render(<CardFace card={twoFaced()} onActivate={onActivate} />)
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    expect(onActivate).not.toHaveBeenCalled()
    expect(screen.getByRole('img').getAttribute('src')).toBe('back.jpg')
  })

  it('draws the honest panel, not a broken image, when there is no picture of the back', () => {
    render(<CardFace card={twoFaced({ backImageUris: {} })} />)
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('No picture of this face.')).toBeDefined()
    expect(screen.getByText("Tergrid's Lantern")).toBeDefined()
  })

  it('keeps the readable text fallback for a single-faced card with no art', () => {
    // Unchanged. That panel carries the name, cost, type line and rules text,
    // which is right in a grid where nothing else says them.
    const { container } = render(<CardFace card={card({ imageUris: undefined })} />)
    expect(container.querySelector('.rt-face-text')).not.toBeNull()
    expect(container.querySelector('.rt-noart')).toBeNull()
  })
})
