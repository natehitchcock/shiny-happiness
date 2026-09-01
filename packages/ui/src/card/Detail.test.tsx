// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Detail } from './Detail.js'
import type { ComboLine } from './Detail.js'
import { CARD_ASPECT } from './presentation.js'
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

describe('Detail — the image', () => {
  it('loads the full card, lazily and asynchronously', () => {
    render(<Detail card={card({ imageUris: { artCrop: 'art.jpg', normal: 'full.jpg' } })} />)
    const image = screen.getByRole('img')
    expect(image.getAttribute('src')).toBe('full.jpg')
    expect(image.getAttribute('loading')).toBe('lazy')
    expect(image.getAttribute('decoding')).toBe('async')
  })

  it('holds the card shape open before the art arrives', () => {
    /*
     * `.rt-detail-image` sets `height: auto`, so whether the box is reserved by
     * the width and height attributes alone depends on a UA rule deriving a
     * ratio from them. Stating the ratio makes it not depend on that — and the
     * everything-below, which is the rules text and the reasons, does not jump
     * up the panel while the art is in flight.
     */
    const { container } = render(<Detail card={card()} width={280} />)
    const image = container.querySelector<HTMLElement>('.rt-detail-image')
    expect(image?.getAttribute('width')).toBe('280')
    expect(image?.getAttribute('height')).toBe(String(Math.round(280 * CARD_ASPECT)))
    expect(image?.style.aspectRatio).not.toBe('')
  })

  it('draws no image element at all rather than an empty one', () => {
    // `''` is how the database spells absent art on the way out. An `<img src="">`
    // asks the browser for the page again and draws it broken.
    render(<Detail card={card({ imageUris: { normal: '' } })} />)
    expect(screen.queryByRole('img')).toBeNull()
    // The card still reads in full — the image was never the only copy.
    expect(screen.getByText(/At the beginning of your end step/)).toBeDefined()
  })
})

/**
 * ADR-0027's three states, at L3. All three are named, because a suite of only
 * two-faced cards cannot detect the first and a suite of only resolved art
 * cannot detect the third.
 */
describe('Detail — the flip control', () => {
  const twoFaced = (over: Partial<CardView> = {}): CardView =>
    card({
      oracleId: 'delver',
      name: 'Delver of Secrets // Insectile Aberration',
      oracleText: 'At the beginning of your upkeep, look at the top card of your library.',
      oracleTextFaces: [
        'At the beginning of your upkeep, look at the top card of your library.',
        'Flying',
      ],
      imageUris: { normal: 'front.jpg' },
      backImageUris: { normal: 'back.jpg' },
      ...over,
    })

  it('offers no control at all for a card with one physical face', () => {
    // State one. Sol Ring has no other side and must not be asked about one.
    render(<Detail card={card()} />)
    expect(screen.queryByRole('button', { name: /Show the .* face/ })).toBeNull()
  })

  it('offers no control for a split card, which is two halves of one face', () => {
    // Fire // Ice has a `//` in its name and two entries in `oracleTextFaces`,
    // and neither is a second physical face. The control keys off the back art
    // being PRESENT, which the layout gate in `packages/clients` decides.
    render(
      <Detail
        card={card({
          name: 'Fire // Ice',
          oracleTextFaces: ['Fire deals 2 damage divided as you choose.', 'Tap target permanent.'],
        })}
      />,
    )
    expect(screen.queryByRole('button', { name: /Show the .* face/ })).toBeNull()
  })

  it("names a split card's picture with the whole name, both halves", () => {
    // Its one image shows Fire AND Ice. An `alt` of "Fire" would name half of
    // what is on screen — found in a browser, not by the test above.
    render(<Detail card={card({ name: 'Fire // Ice' })} />)
    expect(screen.getByRole('img').getAttribute('alt')).toBe('Fire // Ice')
  })

  it('swaps the picture for the back face, and back again', () => {
    // State two. The two URLs differ — on the real CDN they differ by /front/
    // versus /back/ — so this is the assertion that the flip shows the OTHER
    // side rather than re-drawing the same one.
    render(<Detail card={twoFaced()} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('front.jpg')
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    expect(screen.getByRole('img').getAttribute('src')).toBe('back.jpg')
    fireEvent.click(screen.getByRole('button', { name: /Show the front face/ }))
    expect(screen.getByRole('img').getAttribute('src')).toBe('front.jpg')
  })

  it('names the face on screen in the image alt text', () => {
    render(<Detail card={twoFaced()} />)
    expect(screen.getByRole('img').getAttribute('alt')).toBe('Delver of Secrets')
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    expect(screen.getByRole('img').getAttribute('alt')).toBe('Insectile Aberration')
  })

  it('keeps drawing the control when there is a back face and no picture of it', () => {
    // State three, and the one the CHECK constraint exists for. The card really
    // does have another side; hiding the control would make it indistinguishable
    // from Sol Ring.
    render(<Detail card={twoFaced({ backImageUris: {} })} />)
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByText('No picture of this face.')).toBeDefined()
    expect(screen.getByText('Insectile Aberration')).toBeDefined()
  })

  it('draws the control even when the FRONT art is the missing one', () => {
    // The panel used to render nothing at all when `imageFor` came back null,
    // so a two-faced card with an unresolved front lost its second side along
    // with its picture — the third state silently becoming the first.
    render(<Detail card={twoFaced({ imageUris: { normal: '' } })} />)
    expect(screen.getByRole('button', { name: /Show the back face/ })).toBeDefined()
    expect(screen.getByText('No picture of this face.')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    expect(screen.getByRole('img').getAttribute('src')).toBe('back.jpg')
  })

  it('still draws nothing where a single-faced card has no art', () => {
    // Unchanged behaviour for the 99%: no picture, no panel, no control. The
    // name, cost, type and rules text are all in the panel around it already.
    const { container } = render(<Detail card={card({ imageUris: { normal: '' } })} />)
    expect(screen.queryByRole('img')).toBeNull()
    expect(container.querySelector('.rt-noart')).toBeNull()
  })

  it('leaves both faces of the rules text on screen whichever face is showing', () => {
    // The picture flips; the text does not. `OracleText` already draws both
    // faces with the boundary marked, and hiding half of it on flip would take
    // away information the reader has today.
    render(<Detail card={twoFaced()} />)
    expect(screen.getByText(/look at the top card/)).toBeDefined()
    expect(screen.getByText('Flying')).toBeDefined()
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    expect(screen.getByText(/look at the top card/)).toBeDefined()
    expect(screen.getByText('Flying')).toBeDefined()
  })

  it('goes back to the front when the panel moves to another card', () => {
    const { rerender } = render(<Detail card={twoFaced()} />)
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    expect(screen.getByRole('img').getAttribute('src')).toBe('back.jpg')

    rerender(
      <Detail
        card={twoFaced({
          oracleId: 'tergrid',
          name: "Tergrid, God of Fright // Tergrid's Lantern",
          imageUris: { normal: 't-front.jpg' },
          backImageUris: { normal: 't-back.jpg' },
        })}
      />,
    )
    expect(screen.getByRole('img').getAttribute('src')).toBe('t-front.jpg')
  })

  it('is not still flipped when the panel comes back to the same card', () => {
    // Three renders, because the wrong state is invisible on the middle one:
    // a reset that only DRAWS the front, without committing it, leaves the
    // stale entry to reappear the moment its own card does.
    const other = twoFaced({
      oracleId: 'tergrid',
      name: "Tergrid, God of Fright // Tergrid's Lantern",
      imageUris: { normal: 't-front.jpg' },
      backImageUris: { normal: 't-back.jpg' },
    })
    const { rerender } = render(<Detail card={twoFaced()} />)
    fireEvent.click(screen.getByRole('button', { name: /Show the back face/ }))
    rerender(<Detail card={other} />)
    rerender(<Detail card={twoFaced()} />)
    expect(screen.getByRole('img').getAttribute('src')).toBe('front.jpg')
  })
})
