/**
 * @roundtable/clients — third-party source adapters behind one shared rate limiter (AGENTS.md R3, doc 04 §4.0).
 *
 * Scryfall is implemented (ING-01). Spellbook is ING-02. EDHREC is not used and
 * will not be — see ADR-0008.
 */
export * from './scryfall.js'
