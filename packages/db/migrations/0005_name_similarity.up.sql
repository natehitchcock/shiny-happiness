-- Trigram matching, so a mistyped card name still finds the card.
--
-- Substring search answers "Ashnod" but not "Ashnods", and no amount of LIKE
-- will: the wrong character is in the middle. pg_trgm compares three-character
-- shingles, which degrade gracefully under a typo.
--
-- `word_similarity` rather than `similarity`, because `similarity` normalises
-- over the WHOLE string and Magic names are long: "Sekii" against
-- "Sekki, Seasons' Guide" scores below a dozen unrelated four-letter cards.
-- `word_similarity` compares the query against the closest run of words in the
-- name, which is the question actually being asked.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- GiST rather than GIN: GIN cannot serve the `<->` distance ordering this uses,
-- and the table is read-only reference data, so GiST's slower writes cost
-- nothing here.
CREATE INDEX IF NOT EXISTS cards_name_trgm_idx ON cards USING gist (lower(name) gist_trgm_ops);
