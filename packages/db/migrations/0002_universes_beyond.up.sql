-- 0002 Universes Beyond provenance (ADR-0011)

-- A card is Universes Beyond iff EVERY printing of it carries the
-- `universesbeyond` promo type. Computed at ingest across all printings, because
-- the flag is printing-level: Scryfall's oracle export picked a Marvel Commander
-- printing for Sol Ring, and filtering on that one printing would have dropped
-- Sol Ring from every deck. NULL is not allowed — "unknown provenance" would
-- read as "not Universes Beyond" and silently defeat the filter.
ALTER TABLE cards ADD COLUMN universes_beyond boolean NOT NULL DEFAULT false;

-- Partial: the filter asks "exclude the UB ones", and they are the minority.
CREATE INDEX cards_universes_beyond_idx ON cards (universes_beyond)
  WHERE universes_beyond;

-- Per-deck setting, not a global default (ADR-0011). The corpus keeps every
-- card; only this deck's view of it narrows.
ALTER TABLE decks ADD COLUMN exclude_universes_beyond boolean NOT NULL DEFAULT false;
