-- 0002 down
DROP INDEX IF EXISTS cards_universes_beyond_idx;
ALTER TABLE cards DROP COLUMN IF EXISTS universes_beyond;
ALTER TABLE decks DROP COLUMN IF EXISTS exclude_universes_beyond;
