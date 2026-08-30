import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { Gallery } from './Gallery'
import './styles.css'

const root = document.getElementById('root')
if (root === null) throw new Error('#root is missing from index.html')

/**
 * `#gallery` is the UI-01 primitive gallery (see Gallery.tsx). A hash rather
 * than a route because the app has no router yet — WEB-01 adds one, and a
 * placeholder router would be a thing to unpick rather than build on.
 */
const isGallery = window.location.hash === '#gallery'

createRoot(root).render(<StrictMode>{isGallery ? <Gallery /> : <App />}</StrictMode>)
