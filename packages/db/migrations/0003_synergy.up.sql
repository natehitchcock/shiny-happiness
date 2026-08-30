-- 0003 mechanical synergy tags (ADR-0011)

-- Derived at ingest from oracle text, the way `roles` already is. Deriving over
-- 34k cards per request would not fit API-02's 200 ms budget.
--
-- `produces` = this card causes the event. `wants` = this card pays off when it
-- happens. A commander with a death trigger WANTS creature-death; a sacrifice
-- outlet PRODUCES it.
ALTER TABLE cards ADD COLUMN synergy_produces text[] NOT NULL DEFAULT '{}';
ALTER TABLE cards ADD COLUMN synergy_wants text[] NOT NULL DEFAULT '{}';

-- The matcher asks "which candidates produce what this deck wants", which is an
-- array-overlap query in both directions.
CREATE INDEX cards_synergy_produces_idx ON cards USING gin (synergy_produces);
CREATE INDEX cards_synergy_wants_idx ON cards USING gin (synergy_wants);
