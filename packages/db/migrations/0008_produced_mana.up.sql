-- Which colours a card can actually produce.
--
-- A land's whole job is mana, and nothing in the corpus said what mana. The
-- scorer therefore ranked lands by the only thing it could see — their rules
-- text — so cycling deserts and MDFCs with a spell side beat every real dual,
-- because a dual's text is a mana ability and produces no synergy tags.
--
-- `color_identity` is not a substitute. It agrees for Steam Vents (`{R,U}`) and
-- disagrees for exactly the lands that matter most: Command Tower has an empty
-- identity and taps for any colour, and every fetchland has an empty identity
-- while fixing perfectly. Scryfall's `produced_mana` is the field that answers
-- the question being asked.
--
-- Colourless `{C}` is deliberately kept rather than filtered to WUBRG: "produces
-- only colourless" is a real and useful answer, and it is how a utility land is
-- told apart from a land with no mana ability at all.
ALTER TABLE cards ADD COLUMN produced_mana char(1)[] NOT NULL DEFAULT '{}';

-- Answers "which lands produce any of these colours", which is the filter the
-- land scoring runs for every candidate.
CREATE INDEX IF NOT EXISTS cards_produced_mana_idx ON cards USING gin (produced_mana);
