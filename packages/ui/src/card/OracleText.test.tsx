// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { OracleText } from './OracleText.js'

afterEach(cleanup)

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

  it('preserves the newlines that separate abilities', () => {
    const { container } = render(<OracleText text={'Flying\n{T}: Draw a card.'} />)
    expect(container.textContent).toContain('\n')
  })

  it('says so when there is no rules text', () => {
    render(<OracleText text="" />)
    expect(screen.getByText('No rules text.')).toBeDefined()
  })

  it('can be told to say nothing instead', () => {
    // The L2 card face has no room for a sentence about absence.
    const { container } = render(<OracleText text="" empty="" />)
    expect(container.textContent).toBe('')
  })
})
