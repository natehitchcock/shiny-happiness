-- A deck gets a description, and its owner becomes a device rather than a person.
--
-- `owner_id` was already a uuid column with an index; nothing about its SHAPE
-- changes here. What changes is what it means: a random id the browser keeps in
-- localStorage, not a user account. That needs no schema change at all, which is
-- the point of having read the owner from one resolver — this migration is only
-- the description column and a comment recording the reinterpretation.

ALTER TABLE decks ADD COLUMN description text NOT NULL DEFAULT '';

COMMENT ON COLUMN decks.owner_id IS
  'A device id from the browser''s localStorage, not a user account (ADR-0014). '
  'There is no login; losing site data loses the decks, which is why export exists.';

COMMENT ON COLUMN decks.description IS
  'Free text the builder writes about the deck. Never parsed.';
