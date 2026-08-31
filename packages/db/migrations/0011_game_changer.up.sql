-- 0011 Wizards' Game Changers list, from the corpus (DATA-05)

-- The bracket system counts Game Changers, so the app needs to know which cards
-- are on the list. Scryfall already publishes it as a `game_changer` boolean on
-- every card record in the bulk export we download nightly, which makes this a
-- column rather than a checked-in array of card names: the list is revised
-- (cards were added in February 2026 and ten removed the October before), and a
-- hardcoded copy would rot silently with nothing to fail.
--
-- NOT NULL DEFAULT false so the migration does not have to rewrite 34k rows
-- with a value it cannot know. That does mean every existing row reads `false`
-- until the ingest re-runs, and "false" and "not yet ingested" are genuinely
-- indistinguishable at the row level. They are told apart at the SET level
-- instead: a corpus in which NO card is a Game Changer has not been ingested,
-- and `loadBracketRules` refuses to load rather than pass every deck vacuously.
ALTER TABLE cards ADD COLUMN game_changer boolean NOT NULL DEFAULT false;

-- Partial, like the Universes Beyond index above it: the only query is "which
-- of these are Game Changers", the true rows number in the dozens against tens
-- of thousands, and a full index would be almost entirely `false` entries no
-- query ever asks for.
CREATE INDEX cards_game_changer_idx ON cards (game_changer)
  WHERE game_changer;
