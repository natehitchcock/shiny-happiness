-- Power, toughness and loyalty, which were never ingested.
--
-- Stored as TEXT, not as numbers. Magic prints "*", "1+*", "2+*" and "?" as
-- power and toughness, and a card whose power is "*" has a power — it is just
-- not an integer. A numeric column would have to store null for those and the
-- card would then read as having no power at all, which is a different and
-- wrong claim.
--
-- `power_num` and `toughness_num` carry the parsed value where one exists, so
-- `power>=4` can be answered without every reader re-parsing the text. Null
-- there means "not a fixed number", which is exactly what a range query should
-- exclude.
ALTER TABLE cards
  ADD COLUMN power         text,
  ADD COLUMN toughness     text,
  ADD COLUMN loyalty       text,
  ADD COLUMN power_num     integer,
  ADD COLUMN toughness_num integer;

CREATE INDEX IF NOT EXISTS cards_power_idx ON cards (power_num) WHERE power_num IS NOT NULL;
CREATE INDEX IF NOT EXISTS cards_toughness_idx ON cards (toughness_num) WHERE toughness_num IS NOT NULL;
