-- Drops every double-faced card's back art, and with it the corpus's only
-- record of which cards HAVE a back face at all.
--
-- Nothing else stores that: the front columns cannot express it, `cards.layout`
-- is not a column this schema has, and `oracle_text_faces` counts HALVES rather
-- than faces — `Fire // Ice` has two of those and one physical face. So there is
-- nowhere to migrate the data into, and going down is a decision to lose it.
--
-- Recovering it means re-running the Scryfall card ingest, which reads
-- `card_faces[1].image_uris` off the bulk export; no backfill from data already
-- in this database can do it.
--
-- The constraint goes first. Dropping the columns would take it with them, but
-- naming it here keeps the reversal an exact mirror of the forward migration
-- rather than something that happens to work.
ALTER TABLE printings DROP CONSTRAINT printings_back_face_pair;

ALTER TABLE printings
  DROP COLUMN image_back_art_crop,
  DROP COLUMN image_back_normal;
