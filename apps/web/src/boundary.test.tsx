// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Boundary } from './Boundary'

/**
 * One panel failing must not take the workspace with it.
 *
 * The case that prompted this: an API from before `bracket.gameChangers`
 * existed sends the field absent, `BracketChip` read `.length` off `undefined`,
 * and React unmounted the entire tree — a blank page from one optional field on
 * one response.
 */

const Boom = (): never => {
  throw new Error('this panel is broken')
}

afterEach(cleanup)

describe('a panel that throws', () => {
  it('does not take its siblings with it', () => {
    // React logs the error itself; silenced so the run stays readable, and
    // restored by `resetAllMocks` between tests.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <div>
        <Boundary name="The bracket chip">
          <Boom />
        </Boundary>
        <p>Deck · 42</p>
      </div>,
    )

    // The whole point: the rest of the workspace is still on screen.
    expect(screen.getByText('Deck · 42')).toBeTruthy()
    quiet.mockRestore()
  })

  it('says which panel broke, rather than vanishing', () => {
    // A panel that quietly disappears is a worse bug than one that says it
    // broke: the user goes looking for a feature that is still there, and
    // nobody ever files it.
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <Boundary name="The bracket chip">
        <Boom />
      </Boundary>,
    )

    expect(screen.getByText(/The bracket chip could not be shown/)).toBeTruthy()
    expect(screen.getByRole('status')).toBeTruthy()
    quiet.mockRestore()
  })

  it('keeps the error on the console for whoever has to fix it', () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    render(
      <Boundary name="The bracket chip">
        <Boom />
      </Boundary>,
    )

    // Not swallowed. This is the only record that the panel ever rendered.
    const ours = logged.mock.calls.filter((call) => String(call[0]).includes('The bracket chip'))
    expect(ours.length).toBeGreaterThan(0)
    expect(ours[0]?.[1]).toBeInstanceOf(Error)
    logged.mockRestore()
  })

  it('renders its children untouched when nothing throws', () => {
    render(
      <Boundary name="The bracket chip">
        <p>BRACKET 3 · 2/3 GAME CHANGERS</p>
      </Boundary>,
    )

    expect(screen.getByText('BRACKET 3 · 2/3 GAME CHANGERS')).toBeTruthy()
    expect(screen.queryByText(/could not be shown/)).toBeNull()
  })
})
