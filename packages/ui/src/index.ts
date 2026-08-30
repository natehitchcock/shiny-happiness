/**
 * @roundtable/ui — design tokens and, from UI-01, the card primitives.
 *
 * FOUND-02 is the token layer: values as data so their contrast can be
 * asserted, plus `tokens.css` declaring the same values as custom properties.
 * Import the CSS once at the app root; read the data when a value is needed in
 * TypeScript rather than retyping a hex.
 */
export * from './tokens.js'

/**
 * UI-01 — the four card representations (doc 07 §7.1). `presentation.ts` holds
 * the size budget and the colour encodings as data, for the same reason the
 * tokens are data: so a test can assert them.
 */
export * from './card/index.js'
