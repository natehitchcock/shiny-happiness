-- Drops every builder's saved columns, and with them the distinction between a
-- deck that never set any and one that cleared them all. Nothing else reads the
-- column, so there is nothing to migrate the data into; going down is a decision
-- to lose it and to hand everyone the defaults back.
ALTER TABLE decks DROP COLUMN columns;
