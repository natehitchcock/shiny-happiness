import { useSyncExternalStore } from 'react'
import type { JSX } from 'react'
import { App } from './App'
import { Gallery } from './Gallery'

/**
 * The whole router, until WEB-01 brings a real one.
 *
 * `#gallery` shows the UI-01 primitive gallery; anything else shows the app.
 *
 * It subscribes to `hashchange` rather than reading `location.hash` once at
 * module load, which is what the first version did — and that version only
 * worked on a hard reload. Following a link to `#gallery`, or editing the hash
 * in the address bar, changes the URL without reloading the document, so the
 * page kept showing whatever had been rendered when the module first ran. A
 * route you can only reach by pressing F5 is not a route.
 */
const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

const currentHash = (): string => window.location.hash

export const Root = (): JSX.Element => {
  // getServerSnapshot is omitted deliberately: this app does not server-render,
  // and supplying a fake constant would only hide it if that ever changed.
  const hash = useSyncExternalStore(subscribe, currentHash)
  return hash === '#gallery' ? <Gallery /> : <App />
}
