/**
 * @roundtable/ingest — scheduled ingestion workers (doc 04 §4.7).
 *
 * ING-01 (Scryfall) is implemented. ING-02 (Spellbook) is next. ING-03 (EDHREC)
 * is cut — see ADR-0008.
 */
export * from './scryfall-ingest.js'
