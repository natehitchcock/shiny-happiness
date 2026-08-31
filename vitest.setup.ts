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
