/*
 * jsdom does not implement `window.matchMedia`.
 *
 * The web app asks it whether the workspace has collapsed to a single column,
 * so without this every component test throws on render — and the fix inside
 * the app would be a `typeof matchMedia` branch that exists for no reason other
 * than the test runner. It belongs here instead.
 *
 * The stub answers "no" to everything, which is the desktop layout the existing
 * component tests were written against. A test that wants the narrow layout
 * replaces `window.matchMedia` itself before rendering.
 *
 * Guarded on `window` because this file also loads for the node-environment
 * tests, which are most of them.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia
}

/*
 * jsdom does not implement `ResizeObserver` either, and for the same reason it
 * belongs here rather than in the app: every browser this ships to has it, and
 * a `typeof ResizeObserver` branch in `ColumnLegend` would exist only to
 * satisfy the runner.
 *
 * It moved here when the two metric columns became `DEFAULT_COLUMNS`. The
 * legend used to render only after somebody promoted a query, so a test that
 * never did could not reach the observer, and the seventeen files that DID
 * reach it each carried their own copy of this stub. Now every workspace render
 * mounts the legend, which turned a gap those files had already worked around
 * into one every file has. The local copies are harmless — they simply
 * overwrite this one.
 *
 * It never fires: nothing in jsdom has a size to change. Tests assert what the
 * legend renders, not that it re-measures.
 */
if (typeof globalThis.ResizeObserver !== 'function') {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}
