-- The BACK face's art, so a flip control has something to show.
--
-- `image_art_crop` / `image_normal` are the FRONT face and stay exactly what
-- they are: the front is the card — the side that enters the battlefield, the
-- side Scryfall names and sorts by, and the side a tile, the detail panel and
-- the deck-web crop draw. Nothing about this migration moves them.
--
-- Carried only now. It was deliberately left out until there was a reader:
-- `cards.oracle_text_faces` (0009) is the precedent for per-face data and it
-- earned its place because `OracleText` draws both faces' rules. Nothing drew a
-- back image, so two columns and a wire change would have fed nobody. The flip
-- control is being built, so the cost is worth paying — see ADR-0027 and the
-- rewritten docblock above `faceImages` in packages/clients/src/scryfall.ts.
--
-- NULLABLE AND ABSENT BY DEFAULT, not `DEFAULT ''`. Nine cards in ten have one
-- physical face, and a default would make every one of them claim to have a
-- back whose picture is missing. This is the same argument 0009 made for
-- `oracle_text_faces` being nullable rather than `DEFAULT '{}'`.
ALTER TABLE printings
  ADD COLUMN image_back_art_crop text,
  ADD COLUMN image_back_normal   text;

-- THREE STATES IN TWO COLUMNS, and the constraint is what makes the third one
-- readable rather than a convention someone has to be told about:
--
--   both NULL          = this card has ONE physical face. There is no back.
--                        Also what every row written before this migration
--                        says, which is the honest answer for them.
--   both NOT NULL      = this card HAS a back face. The values are its art, and
--                        `''` in either means that asset did not resolve — the
--                        same spelling of "no cached art" the front columns'
--                        NULL carries, kept distinct here because the row still
--                        has to be able to say "there IS a second side".
--
-- That distinction is the entire reason this is not one nullable column pair
-- read the obvious way. A flip control must be able to tell "no second side"
-- from "second side, no picture": the first draws no button, the second draws a
-- button over a fallback panel. Collapse them and a transform card with an
-- unresolved image is indistinguishable from Sol Ring.
--
-- Rejected alternative: a third `has_back_face boolean` column. It says the same
-- thing in an extra column and adds a fourth state — `has_back_face = false`
-- with URLs in the other two — that means nothing and that nothing prevents.
-- The CHECK below has no such gap.
--
-- Rejected alternative: one `image_back jsonb` column. It encodes the states
-- exactly and in one place, but it would be the only jsonb in this table, it
-- cannot be indexed or queried the way the sibling text columns can, and
-- "beside `image_art_crop` / `image_normal`, shaped like them" is worth more
-- here than saving a column.
ALTER TABLE printings
  ADD CONSTRAINT printings_back_face_pair
    CHECK ((image_back_art_crop IS NULL) = (image_back_normal IS NULL));

-- No index. The columns are never a search key: they are read with the printing
-- row they sit on, through `printings_oracle_idx` or the `cards.default_printing`
-- join `printingFactsForAll` already makes. Same reasoning as 0013–0015.
