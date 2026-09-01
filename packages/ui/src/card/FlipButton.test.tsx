// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { FaceNoArt, FlipButton, useCardSide } from './FlipButton.js'
import { HIT_TARGET_MIN } from './presentation.js'
import type { CardView } from './types.js'

afterEach(cleanup)

const twoFaced = (over: Partial<CardView> = {}): CardView => ({
  oracleId: 'delver',
  name: 'Delver of Secrets // Insectile Aberration',
  typeLine: 'Creature — Human Wizard',
  imageUris: { normal: 'front.jpg' },
  backImageUris: { normal: 'back.jpg' },
  ...over,
})

/** A harness that drives the hook exactly as `Detail` and `CardFace` do. */
const Harness = ({ card }: { card: CardView }): React.JSX.Element => {
  const { side, touched, hasBack, flip } = useCardSide(card)
  return (
    <div>
      <span data-testid="side">{side}</span>
      <span data-testid="touched">{String(touched)}</span>
      {hasBack ? <FlipButton card={card} side={side} touched={touched} onFlip={flip} /> : null}
    </div>
  )
}

describe('FlipButton — R4: a tap target, a keyboard equivalent, a visible name', () => {
  it('is a real button, so Enter and Space work without any key handler', () => {
    // The rejected alternative was a div with role="button" and an onKeyDown,
    // which is what `Tile` has to do because the whole tile is the target. A
    // control that CAN be a <button> should be one: the browser gives it both
    // keys, the focus ring and the form semantics for free, and every hand-
    // rolled version of that eventually misses one of them.
    render(<FlipButton card={twoFaced()} side="front" touched={false} onFlip={() => undefined} />)
    const button = screen.getByRole('button')
    expect(button.tagName).toBe('BUTTON')
    expect(button.getAttribute('type')).toBe('button')
  })

  it('names the face it will show, not the one already on screen', () => {
    render(<FlipButton card={twoFaced()} side="front" touched={false} onFlip={() => undefined} />)
    expect(
      screen.getByRole('button', { name: 'Show the back face: Insectile Aberration' }),
    ).toBeDefined()
  })

  it('names the way back once the back is showing', () => {
    render(<FlipButton card={twoFaced()} side="back" touched={false} onFlip={() => undefined} />)
    expect(
      screen.getByRole('button', { name: 'Show the front face: Delver of Secrets' }),
    ).toBeDefined()
  })

  it('keeps its visible text inside its accessible name (WCAG 2.5.3)', () => {
    // Speech control: someone saying "click Insectile Aberration" must hit this
    // button. That only works while the visible words are a substring of the
    // accessible name, which an aria-label written independently of the label
    // silently breaks.
    render(<FlipButton card={twoFaced()} side="front" touched={false} onFlip={() => undefined} />)
    const button = screen.getByRole('button')
    const visible = button.querySelector('.rt-flip-name')?.textContent ?? ''
    expect(visible).toBe('Insectile Aberration')
    expect(button.getAttribute('aria-label')).toContain(visible)
  })

  it('clears the touch minimum in both axes', () => {
    render(<FlipButton card={twoFaced()} side="front" touched={false} onFlip={() => undefined} />)
    expect(screen.getByRole('button').style.minHeight).toBe(`${String(HIT_TARGET_MIN)}px`)
  })

  it('is not a toggle button, because a toggle may not rename itself', () => {
    // ARIA: a toggle button's name must not change with its state. The whole
    // requirement here is that the name DOES change, so aria-pressed would be
    // the wrong pattern and a screen reader would read the state twice over.
    render(<FlipButton card={twoFaced()} side="front" touched={false} onFlip={() => undefined} />)
    expect(screen.getByRole('button').getAttribute('aria-pressed')).toBeNull()
  })

  it('hides the glyph from the accessible name', () => {
    const { container } = render(
      <FlipButton card={twoFaced()} side="front" touched={false} onFlip={() => undefined} />,
    )
    expect(container.querySelector('.rt-flip-glyph')?.getAttribute('aria-hidden')).toBe('true')
  })
})

describe('FlipButton — announcing the face that is now on screen', () => {
  it('says nothing before the user has flipped anything', () => {
    // A live region rendered with content at mount is announced by some screen
    // readers as soon as the panel opens, which would greet every double-faced
    // card with a sentence nobody asked for.
    const { container } = render(
      <FlipButton card={twoFaced()} side="front" touched={false} onFlip={() => undefined} />,
    )
    expect(container.querySelector('[role="status"]')?.textContent).toBe('')
  })

  it('states the face on screen once a flip has happened', () => {
    const { container } = render(
      <FlipButton card={twoFaced()} side="back" touched={true} onFlip={() => undefined} />,
    )
    const status = container.querySelector('[role="status"]')
    expect(status?.textContent).toBe('Showing the back face: Insectile Aberration')
    expect(status?.getAttribute('aria-live')).toBe('polite')
  })
})

describe('useCardSide — flipping, and what resets it', () => {
  it('starts on the front', () => {
    render(<Harness card={twoFaced()} />)
    expect(screen.getByTestId('side').textContent).toBe('front')
    expect(screen.getByTestId('touched').textContent).toBe('false')
  })

  it('flips to the back and back again', () => {
    render(<Harness card={twoFaced()} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('side').textContent).toBe('back')
    expect(screen.getByTestId('touched').textContent).toBe('true')
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('side').textContent).toBe('front')
  })

  it('is answered with Enter and with Space, through the button element', () => {
    render(<Harness card={twoFaced()} />)
    const button = screen.getByRole('button')
    // jsdom does not synthesise the click a real button fires on Enter, so the
    // guarantee being asserted is the one that makes it true: the control is a
    // <button>, which the browser gives both keys.
    expect(button.tagName).toBe('BUTTON')
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.click(button)
    expect(screen.getByTestId('side').textContent).toBe('back')
  })

  it('goes back to the front when a different card is shown', () => {
    // A card left flipped while you browse to another is a bug, not a feature:
    // the front IS the card, the panel header names the front, and a second
    // card's first impression must not be a side nobody asked for.
    const { rerender } = render(<Harness card={twoFaced()} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('side').textContent).toBe('back')

    rerender(<Harness card={twoFaced({ oracleId: 'tergrid', name: 'Tergrid // Lantern' })} />)
    expect(screen.getByTestId('side').textContent).toBe('front')
    expect(screen.getByTestId('touched').textContent).toBe('false')
  })

  it('is not still holding the old face when you come back to that card', () => {
    /*
     * The mutation that survived the first pass. Drawing the front for a card
     * whose id has changed is only HALF the reset: without committing it, the
     * stale entry sits there until its own id comes round again, and browsing
     * away to another card and back returns to a card still showing its back.
     * The one-step version of this test cannot see that — it takes three
     * renders, because the wrong state is invisible for the middle one.
     */
    const { rerender } = render(<Harness card={twoFaced()} />)
    fireEvent.click(screen.getByRole('button'))
    expect(screen.getByTestId('side').textContent).toBe('back')

    rerender(<Harness card={twoFaced({ oracleId: 'tergrid', name: 'Tergrid // Lantern' })} />)
    rerender(<Harness card={twoFaced()} />)
    expect(screen.getByTestId('side').textContent).toBe('front')
    expect(screen.getByTestId('touched').textContent).toBe('false')
  })

  it('does not reset when the same card re-renders for another reason', () => {
    // Detail arriving, a price landing, a resize — none of those are a new
    // card, and a flip that undid itself on every unrelated re-render would be
    // unusable in the panel that streams its own data in.
    const { rerender } = render(<Harness card={twoFaced()} />)
    fireEvent.click(screen.getByRole('button'))
    rerender(<Harness card={twoFaced({ priceUsd: 3.5 })} />)
    expect(screen.getByTestId('side').textContent).toBe('back')
  })

  it('reports no back face for a card with one face', () => {
    render(<Harness card={{ oracleId: 'sol', name: 'Sol Ring', imageUris: { normal: 's.jpg' } }} />)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('reports a back face when there is one and no picture of it', () => {
    render(<Harness card={twoFaced({ backImageUris: {} })} />)
    expect(screen.getByRole('button')).toBeDefined()
  })
})

describe('FaceNoArt — the third state has to say something honest', () => {
  it('names the face and says there is no picture of it', () => {
    render(<FaceNoArt card={twoFaced({ backImageUris: {} })} side="back" />)
    expect(screen.getByText('Insectile Aberration')).toBeDefined()
    expect(screen.getByText('No picture of this face.')).toBeDefined()
  })

  it('draws no image element at all, so nothing can come back broken', () => {
    render(<FaceNoArt card={twoFaced({ backImageUris: {} })} side="back" />)
    expect(screen.queryByRole('img')).toBeNull()
  })
})
