/**
 * The `#web` mode switch (doc 17 §17.1).
 *
 * The same `hashchange` subscription `Root.tsx` uses for `#gallery`, and for
 * the reason spelled out there: reading `location.hash` once at module load
 * gives a route you can only reach by pressing F5.
 *
 * Not routed in `Root.tsx` alongside `#gallery`, deliberately. The gallery is a
 * standalone page with no data; the deck web is a second view of the deck the
 * workspace already has hydrated — cards, art and combos included. Routing it
 * at the top would mean a second component fetching all of it again, and every
 * mode toggle would be a fresh round of requests for data sitting in memory one
 * component away.
 */

import { useSyncExternalStore } from 'react'

export const WEB_HASH = '#web'

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const snapshot = (): boolean => window.location.hash === WEB_HASH

/** Whether the deck web is the current mode. */
export const useDeckWebMode = (): boolean =>
  // getServerSnapshot is omitted for the reason Root.tsx gives: this app does
  // not server-render, and a fake constant would only hide it if it ever did.
  useSyncExternalStore(subscribe, snapshot)

export const enterDeckWeb = (): void => {
  window.location.hash = WEB_HASH
}

/**
 * Leave the mode without leaving a `#` in the address bar.
 *
 * `location.hash = ''` leaves a bare `#` and, worse, does not always fire
 * `hashchange` when the hash was already empty. `replaceState` puts the URL
 * back and the caller dispatches the event, so the subscription above sees it.
 */
export const leaveDeckWeb = (): void => {
  history.replaceState(null, '', window.location.pathname + window.location.search)
  window.dispatchEvent(new HashChangeEvent('hashchange'))
}
