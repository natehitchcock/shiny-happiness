// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Root } from './Root'

// The gallery is the cheap half to render; App reaches for the API on mount, so
// it is stubbed down to a marker. What is under test is the routing, not either
// destination.
vi.mock('./App', () => ({ App: () => <div>THE APP</div> }))

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

const setHash = (hash: string): void => {
  act(() => {
    window.location.hash = hash
    // jsdom does not fire hashchange for a programmatic assignment.
    window.dispatchEvent(new HashChangeEvent('hashchange'))
  })
}

describe('Root', () => {
  it('shows the app by default', () => {
    render(<Root />)
    expect(screen.getByText('THE APP')).toBeDefined()
  })

  it('shows the gallery when the hash is already #gallery on load', () => {
    window.location.hash = '#gallery'
    render(<Root />)
    expect(screen.getByText('Card primitives')).toBeDefined()
  })

  it('switches when the hash changes, without a reload', () => {
    // The regression. The first version read location.hash once at module load,
    // so following a link to #gallery changed the URL and nothing else — the
    // route was only reachable by pressing F5.
    render(<Root />)
    expect(screen.getByText('THE APP')).toBeDefined()

    setHash('#gallery')
    expect(screen.getByText('Card primitives')).toBeDefined()
    expect(screen.queryByText('THE APP')).toBeNull()
  })

  it('switches back again', () => {
    window.location.hash = '#gallery'
    render(<Root />)
    setHash('')
    expect(screen.getByText('THE APP')).toBeDefined()
  })

  it('unsubscribes on unmount rather than leaking a listener', () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<Root />)
    unmount()
    expect(remove).toHaveBeenCalledWith('hashchange', expect.any(Function))
    remove.mockRestore()
  })
})
