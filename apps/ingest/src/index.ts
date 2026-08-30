/**
 * @roundtable/ingest — scheduled ingestion workers (doc 04 §4.7).
 *
 * ING-01 (Scryfall) and ING-02 (Spellbook) are implemented. ING-03 (EDHREC) is
 * cut — see ADR-0008.
 */
export * from './scryfall-ingest.js'
export * from './spellbook-ingest.js'
