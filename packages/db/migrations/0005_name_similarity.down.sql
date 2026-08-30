DROP INDEX IF EXISTS cards_name_trgm_idx;
-- The extension is left in place: other things may have come to depend on it,
-- and dropping it would take their indexes with it.
