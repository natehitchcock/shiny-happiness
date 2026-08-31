-- Drops every builder's tuned targets. Nothing else reads the column, so there
-- is nothing to migrate the data into; going down is a decision to lose it.
ALTER TABLE decks DROP COLUMN target_overrides;
