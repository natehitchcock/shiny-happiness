// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { OracleText, type OracleSegment } from './OracleText.js'

afterEach(cleanup)

/** Fire // Ice: one ability on the front, two on the back, joined by newlines. */
const FIRE = 'Fire deals 2 damage divided as you choose among one or two targets.'
const ICE = 'Tap target permanent.\nDraw a card.'

describe('OracleText', () => {
  it('draws the symbols embedded in a sentence', () => {
    const { container } = render(<OracleText text="{T}: Add {C}{C}." />)
    expect(container.querySelectorAll('.rt-inline-sym')).toHaveLength(3)
  })

  it('keeps the prose around them', () => {
    const { container } = render(<OracleText text="{T}: Add {C}{C}." />)
    // The words must survive the split, in order.
    expect(container.textContent).toContain(': Add')
    expect(container.textContent?.trimEnd().endsWith('.')).toBe(true)
  })

  it('reads in order for a screen reader, one word per symbol', () => {
    // NOT one hidden copy of the paragraph, which is what a cost does — that
    // would double every card's text. Each symbol carries its own word in
    // place, so the sentence still reads as a sentence.
    render(<OracleText text="{T}: Add {C}{C}." />)
    expect(screen.getByText('tap')).toBeDefined()
    expect(screen.getAllByText('colourless')).toHaveLength(2)
  })

  it('leaves an unreadable token exactly as written', () => {
    // A symbol silently dropped from rules text changes what the card does.
    const { container } = render(<OracleText text="Whenever {ZZZ9} happens." />)
    expect(container.textContent).toContain('{ZZZ9}')
    expect(container.querySelectorAll('.rt-inline-sym')).toHaveLength(0)
  })

  describe('abilities', () => {
    it('gives each ability of a face its own block', () => {
      // The defect: the abilities were emitted as one run with literal newlines
      // between them, and two of the three call sites do not set `pre-wrap`, so
      // three abilities read as one paragraph. A block each is what puts the
      // space there wherever the component is used.
      const { container } = render(<OracleText text={'Flying\nVigilance\n{T}: Draw a card.'} />)
      const abilities = [...container.querySelectorAll('.rt-oracle-ability')]
      // The third reads "Ttap" because the drawn `{T}` disc carries the letter
      // and its own hidden word — see the screen-reader test above.
      expect(abilities.map((a) => a.textContent)).toEqual([
        'Flying',
        'Vigilance',
        'Ttap: Draw a card.',
      ])
    })

    it('still blocks a card with a single ability', () => {
      // One ability is one block, not bare text: the spacing rule is written as
      // `.rt-oracle-ability + .rt-oracle-ability`, so a lone ability that came
      // out unwrapped would look identical here and wrong the moment a second
      // ability arrived.
      const { container } = render(<OracleText text="Flying" />)
      const abilities = container.querySelectorAll('.rt-oracle-ability')
      expect(abilities).toHaveLength(1)
      expect(abilities[0]?.textContent).toBe('Flying')
    })

    it('does not emit a block for the gap between two abilities', () => {
      // A blank line between abilities would render as an empty block and take
      // the ability spacing twice.
      const { container } = render(<OracleText text={'Flying\n\nVigilance'} />)
      expect(container.querySelectorAll('.rt-oracle-ability')).toHaveLength(2)
    })
  })

  describe('faces', () => {
    it('rules a line between two faces', () => {
      const { container } = render(<OracleText text={`${FIRE}\n${ICE}`} faces={[FIRE, ICE]} />)
      expect(container.querySelectorAll('.rt-oracle-facebreak')).toHaveLength(1)
    })

    it('puts the rule at the face boundary, not at every newline', () => {
      // The whole point. Fire // Ice is three newline-separated chunks and only
      // the FIRST boundary is a face change; a renderer that split the joined
      // string on newlines would rule three lines into two cards.
      const { container } = render(<OracleText text={`${FIRE}\n${ICE}`} faces={[FIRE, ICE]} />)
      const blocks = [...container.querySelectorAll('.rt-oracle-ability, .rt-oracle-facebreak')]
      expect(blocks.map((b) => b.className)).toEqual([
        'rt-oracle-ability',
        'rt-oracle-facebreak',
        'rt-oracle-ability',
        'rt-oracle-ability',
      ])
    })

    it('tells a screen reader that the face changed', () => {
      // The rule is a border, which assistive technology never reads. Left at
      // that, a listener would hear the back face continue the front's sentence
      // — the same defect being fixed for sighted readers. The words go in
      // place, in reading order, like the symbol labels do.
      const { container } = render(<OracleText text={`${FIRE}\n${ICE}`} faces={[FIRE, ICE]} />)
      expect(screen.getByText('Other face:')).toBeDefined()
      // In place: after the front face's text and before the back's.
      const text = container.textContent ?? ''
      expect(text.indexOf('Fire deals')).toBeLessThan(text.indexOf('Other face:'))
      expect(text.indexOf('Other face:')).toBeLessThan(text.indexOf('Tap target'))
    })

    it('keeps the words of both faces', () => {
      const { container } = render(<OracleText text={`${FIRE}\n${ICE}`} faces={[FIRE, ICE]} />)
      expect(container.textContent).toContain('Fire deals 2 damage')
      expect(container.textContent).toContain('Draw a card.')
    })

    it('draws no rule for a single-faced card', () => {
      const { container } = render(<OracleText text={'Flying\n{T}: Draw a card.'} />)
      expect(container.querySelectorAll('.rt-oracle-facebreak')).toHaveLength(0)
      expect(container.querySelectorAll('.rt-oracle-ability')).toHaveLength(2)
    })

    it('ignores a faces list of one, which is not a boundary', () => {
      // A card ingested before the field existed has no faces at all, and a
      // one-entry list is the same claim. Neither is a place to draw a line.
      const { container } = render(<OracleText text="Flying" faces={['Flying']} />)
      expect(container.querySelectorAll('.rt-oracle-facebreak')).toHaveLength(0)
    })

    it('draws no rule against a face that has no rules text', () => {
      // Plenty of backs are a bare land. A rule drawn there would announce a
      // side with nothing on it.
      const { container } = render(
        <OracleText text={'{T}: Add {R}.\n'} faces={['{T}: Add {R}.', '']} />,
      )
      expect(container.querySelectorAll('.rt-oracle-facebreak')).toHaveLength(0)
      expect(container.querySelectorAll('.rt-oracle-ability')).toHaveLength(1)
    })

    it('draws the symbols on the far face too', () => {
      const { container } = render(
        <OracleText text={'Flying\n{T}: Add {R}.'} faces={['Flying', '{T}: Add {R}.']} />,
      )
      expect(container.querySelectorAll('.rt-inline-sym')).toHaveLength(2)
    })
  })

  describe('no rules text', () => {
    it('says so when there is none', () => {
      render(<OracleText text="" />)
      expect(screen.getByText('No rules text.')).toBeDefined()
    })

    it('renders no ability block for it', () => {
      const { container } = render(<OracleText text="" />)
      expect(container.querySelectorAll('.rt-oracle-ability')).toHaveLength(0)
    })

    it('can be told to say nothing instead', () => {
      // The L2 card face has no room for a sentence about absence.
      const { container } = render(<OracleText text="" empty="" />)
      expect(container.textContent).toBe('')
    })

    it('says so when every face is empty', () => {
      // Two art-series faces, both blank: nothing to rule between, and nothing
      // to say. The blank-face path must reach the same answer as `text === ''`.
      render(<OracleText text={'\n'} faces={['', '']} />)
      expect(screen.getByText('No rules text.')).toBeDefined()
    })
  })

  describe('card names inside the text', () => {
    /*
     * `splitNames` is a FUNCTION, not a list of names.
     *
     * `@roundtable/ui` does not depend on `@roundtable/domain` (see types.ts),
     * and the matcher that decides which spans are references is domain logic
     * over the card table. Passing the split in keeps that boundary and — more
     * importantly — keeps the answer positional. A list of names would make
     * this component match by substring, which is exactly the mistake the
     * matcher exists to avoid: "Sol Ring" also occurs inside the token name
     * "Sol Ring Replica", and a substring match would link it there too.
     */
    const splitOnSolRing = (ability: string): readonly OracleSegment[] => {
      const at = ability.indexOf('named Sol Ring')
      if (at === -1) return [{ kind: 'text', text: ability }]
      const start = at + 'named '.length
      return [
        { kind: 'text', text: ability.slice(0, start) },
        { kind: 'name', text: 'Sol Ring' },
        { kind: 'text', text: ability.slice(start + 'Sol Ring'.length) },
      ]
    }

    const NAMES = 'Search your library for a card named Sol Ring, reveal it.'

    it('draws a named card as a control', () => {
      render(<OracleText text={NAMES} splitNames={splitOnSolRing} onOpenName={vi.fn()} />)
      expect(screen.getByRole('button', { name: /Sol Ring/ })).toBeDefined()
    })

    it('says what the control opens, not just the name (R4)', () => {
      // "Sol Ring" alone tells a screen-reader user nothing about what the
      // control does. The accessible name has to name the action.
      render(<OracleText text={NAMES} splitNames={splitOnSolRing} onOpenName={vi.fn()} />)
      expect(screen.getByRole('button', { name: 'Open Sol Ring' })).toBeDefined()
    })

    it('opens the card it names when chosen', () => {
      const onOpenName = vi.fn()
      render(<OracleText text={NAMES} splitNames={splitOnSolRing} onOpenName={onOpenName} />)

      fireEvent.click(screen.getByRole('button', { name: 'Open Sol Ring' }))

      expect(onOpenName).toHaveBeenCalledWith('Sol Ring')
    })

    it('is a real button, so it is reachable and operable by keyboard (R4)', () => {
      // Not a styled span with a click handler. A `<button>` is focusable, has
      // a role, and fires on Enter and Space without any of it being written
      // here — which is why it is the element rather than a div.
      render(<OracleText text={NAMES} splitNames={splitOnSolRing} onOpenName={vi.fn()} />)
      const link = screen.getByRole('button', { name: 'Open Sol Ring' })

      expect(link.tagName).toBe('BUTTON')
      expect(link.getAttribute('type')).toBe('button')
      link.focus()
      expect(document.activeElement).toBe(link)
    })

    it('keeps the prose around the name intact', () => {
      const { container } = render(
        <OracleText text={NAMES} splitNames={splitOnSolRing} onOpenName={vi.fn()} />,
      )
      expect(container.textContent).toBe(NAMES)
    })

    it('still draws mana symbols in the prose beside a name', () => {
      const text = '{T}: Search for a card named Sol Ring.'
      const { container } = render(
        <OracleText text={text} splitNames={splitOnSolRing} onOpenName={vi.fn()} />,
      )
      expect(container.querySelectorAll('.rt-inline-sym')).toHaveLength(1)
      expect(screen.getByRole('button', { name: 'Open Sol Ring' })).toBeDefined()
    })

    it('draws plain text when nothing is passed to split it', () => {
      // The default for every existing call site, and for a server that does
      // not send references at all.
      const { container } = render(<OracleText text={NAMES} />)
      expect(container.querySelectorAll('button')).toHaveLength(0)
      expect(container.textContent).toBe(NAMES)
    })

    it('draws no control when there is no handler to make it do anything', () => {
      // A link that cannot open anything is worse than plain text: it invites a
      // click, takes focus in the tab order, and then does nothing.
      const { container } = render(<OracleText text={NAMES} splitNames={splitOnSolRing} />)

      expect(container.querySelectorAll('button')).toHaveLength(0)
      expect(container.textContent).toBe(NAMES)
    })

    it('draws plain text when the split finds no name', () => {
      const { container } = render(
        <OracleText text="Flying, vigilance." splitNames={splitOnSolRing} onOpenName={vi.fn()} />,
      )
      expect(container.querySelectorAll('button')).toHaveLength(0)
    })

    it('links a name on either face of a two-faced card', () => {
      render(
        <OracleText
          text={`${NAMES}\nTap target permanent.`}
          faces={['Tap target permanent.', NAMES]}
          splitNames={splitOnSolRing}
          onOpenName={vi.fn()}
        />,
      )
      expect(screen.getByRole('button', { name: 'Open Sol Ring' })).toBeDefined()
    })
  })
})
