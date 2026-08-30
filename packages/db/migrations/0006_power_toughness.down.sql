DROP INDEX IF EXISTS cards_toughness_idx;
DROP INDEX IF EXISTS cards_power_idx;
ALTER TABLE cards
  DROP COLUMN power,
  DROP COLUMN toughness,
  DROP COLUMN loyalty,
  DROP COLUMN power_num,
  DROP COLUMN toughness_num;
