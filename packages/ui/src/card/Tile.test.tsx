// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tile, tileLabel } from './Tile.js'
import { HIT_TARGET_MIN, levelSpec } from './presentation.js'
import type { CardView } from './types.js'

afterEach(cleanup)

const card = (over: Partial<CardView> = {}): CardView => ({
  oracleId: 'o1',
  name: 'Krenko, Mob Boss',
  manaValue: 4,
  colorIdentity: ['R'],
  primaryRole: 'wincon',
  imageUris: { artCrop: 'https://example.test/krenko-art.jpg' },
  ...over,
})

describe('Tile — size', () => {
  it('renders at the L1 width by default', () => {
    render(<Tile card={card()} />)
    const tile = screen.getByRole('button')
    expect(tile.style.width).toBe(`${String(levelSpec(1).width)}px`)
  })

  it('never falls below the 44 px touch minimum, even when a caller shrinks it', () => {
    // doc 08 §8.3. A caller packing a dense group could ask for 32 px; the mark
    // may shrink but the thing you can hit must not.
    render(<Tile card={card()} width={32} />)
    const tile = screen.getByRole('button')
    expect(tile.style.minWidth).toBe(`${String(HIT_TARGET_MIN)}px`)
    expect(tile.style.minHeight).toBe(`${String(HIT_TARGET_MIN)}px`)
  })

  it('loads the art crop, not the full card', () => {
    // "Never load a full card image to render an L1 tile" (doc 07 §7.3).
    render(<Tile card={card({ imageUris: { artCrop: 'art.jpg', normal: 'full.jpg' } })} />)
    expect(screen.getByRole('button').querySelector('img')?.getAttribute('src')).toBe('art.jpg')
  })
})

describe('Tile — accessibility', () => {
  it('gives a screen reader one sentence, not an image name and then the same name again', () => {
    render(<Tile card={card()} />)
    const tile = screen.getByRole('button')
    expect(tile.getAttribute('aria-label')).toBe('Krenko, Mob Boss, mana value 4, wincon')
    // The image is decorative *because* the button carries everything.
    expect(tile.querySelector('img')?.getAttribute('alt')).toBe('')
  })

  it('activates on Enter and on Space, not only on click', () => {
    // R4 / doc 08 §8.2: every pointer path has a keyboard equal. A div with
    // role=button gets neither for free, which is why both are asserted.
    for (const key of ['Enter', ' ']) {
      const onActivate = vi.fn()
      render(<Tile card={card()} onActivate={onActivate} />)
      const tile = screen.getByRole('button')
      tile.focus()
      tile.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }))
      expect(onActivate, `key ${key}`).toHaveBeenCalledWith('o1')
      cleanup()
    }
  })

  it('is reachable by keyboard at all', () => {
    render(<Tile card={card()} />)
    expect(screen.getByRole('button').getAttribute('tabindex')).toBe('0')
  })

  it('reports selection through aria-pressed, not only through a border colour', () => {
    render(<Tile card={card()} selected />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBe('true')
  })

  it('names the role in text for anyone who cannot see the dot', () => {
    render(<Tile card={card()} />)
    expect(screen.getByText('wincon')).toBeDefined()
  })
})

describe('Tile — what it draws', () => {
  it('shows the name, because L1 is the level where cards become identifiable', () => {
    render(<Tile card={card()} />)
    expect(screen.getByText('Krenko, Mob Boss')).toBeDefined()
  })

  it('shows no combo badge when the card completes nothing', () => {
    // A "0" on most of the pool is noise, and the mark only works when it is rare.
    render(<Tile card={card({ comboDegree: 0, nearCombosAt1: 0 })} />)
    expect(screen.queryByTitle(/combo/)).toBeNull()
  })

  it('shows the combo count when there is one', () => {
    render(<Tile card={card({ comboDegree: 2 })} />)
    expect(screen.getByTitle('completes 2 combos').textContent).toBe('2')
  })

  it('distinguishes a near-combo from a completed one', () => {
    render(<Tile card={card({ comboDegree: 0, nearCombosAt1: 3 })} />)
    const badge = screen.getByTitle('one piece away from 3 combos')
    expect(badge.textContent).toBe('+3')
    expect(badge.getAttribute('data-near')).toBe('true')
  })

  it('keeps the badges inside the art frame that positions them', () => {
    // The structural half of the escaping-badge regression: the CSS pins these
    // to `.rt-tile-art`, so moving either one out of it silently unpins it.
    const { container } = render(<Tile card={card({ comboDegree: 2 })} />)
    const art = container.querySelector('.rt-tile-art')
    expect(art?.querySelector('.rt-combo')).not.toBeNull()
    expect(art?.querySelector('.rt-role')).not.toBeNull()
  })

  it('still renders the name when there is no art', () => {
    // An unresolved card (ING-04 has not run, or an import that never resolves)
    // is still a card you may want to accept.
    render(<Tile card={card({ imageUris: undefined })} />)
    expect(screen.getByText('Krenko, Mob Boss')).toBeDefined()
    expect(screen.getByRole('button').querySelector('img')).toBeNull()
  })
})

describe('tileLabel', () => {
  it('omits a combo clause when the degree is zero', () => {
    expect(tileLabel({ oracleId: 'x', name: 'X', manaValue: 1 })).toBe('X, mana value 1')
  })

  it('says "combo" singular for one', () => {
    const label = tileLabel({ oracleId: 'x', name: 'X', manaValue: 1, comboDegree: 1 })
    expect(label).toBe('X, mana value 1, completes 1 combo')
  })
})
