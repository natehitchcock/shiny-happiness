-- 0003 down
DROP INDEX IF EXISTS cards_synergy_produces_idx;
DROP INDEX IF EXISTS cards_synergy_wants_idx;
ALTER TABLE cards DROP COLUMN IF EXISTS synergy_produces;
ALTER TABLE cards DROP COLUMN IF EXISTS synergy_wants;
