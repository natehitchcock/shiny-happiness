-- 0001 initial schema (DB-01, docs 02 and 12)

-- `schema_migrations` is owned by the migration runner, not by a migration.

-- ---------------------------------------------------------------- card data

CREATE TABLE cards (
  oracle_id          uuid PRIMARY KEY,
  name               text NOT NULL,
  mana_cost          text,
  mana_value         real NOT NULL,
  color_identity     char(1)[] NOT NULL DEFAULT '{}',
  colors             char(1)[] NOT NULL DEFAULT '{}',
  type_line          text NOT NULL,
  types              text[] NOT NULL DEFAULT '{}',
  oracle_text        text NOT NULL DEFAULT '',
  keywords           text[] NOT NULL DEFAULT '{}',
  legality_commander text NOT NULL,
  edhrec_rank        integer,
  default_printing   uuid,
  roles              text[] NOT NULL DEFAULT '{}',
  primary_role       text NOT NULL,
  -- Populated by ING-01; a card whose commander legality is unknown must not
  -- silently read as legal.
  CONSTRAINT cards_legality_known
    CHECK (legality_commander IN ('legal', 'not_legal', 'banned', 'restricted'))
);

-- Candidate eligibility filters on colour identity and legality together
-- (doc 05 §5.2), so they are indexed together.
CREATE INDEX cards_legality_idx ON cards (legality_commander);
CREATE INDEX cards_color_identity_idx ON cards USING gin (color_identity);
CREATE INDEX cards_name_lower_idx ON cards (lower(name));
CREATE INDEX cards_primary_role_idx ON cards (primary_role);

CREATE TABLE printings (
  printing_id      uuid PRIMARY KEY,
  oracle_id        uuid NOT NULL REFERENCES cards (oracle_id) ON DELETE CASCADE,
  set_code         text NOT NULL,
  set_name         text NOT NULL,
  collector_number text NOT NULL,
  rarity           text NOT NULL,
  image_art_crop   text,
  image_normal     text,
  price_usd        numeric(10, 2),
  reserved         boolean NOT NULL DEFAULT false
);

CREATE INDEX printings_oracle_idx ON printings (oracle_id);
CREATE INDEX printings_set_idx ON printings (lower(set_code));

-- ---------------------------------------------------------------- combos

CREATE TABLE combos (
  combo_id       text PRIMARY KEY,
  pieces         uuid[] NOT NULL,
  prerequisites  text NOT NULL DEFAULT '',
  steps          text[] NOT NULL DEFAULT '{}',
  produces       text[] NOT NULL DEFAULT '{}',
  color_identity char(1)[] NOT NULL DEFAULT '{}',
  -- A combo with no pieces is malformed. ING-02 must reject and report it
  -- (doc 04 §4.2); the constraint makes storing one impossible.
  CONSTRAINT combos_have_pieces CHECK (cardinality(pieces) > 0)
);

-- THE hot path: oracle_id -> combos containing it (doc 05 §5.8). Every
-- combo-degree computation starts here, so it is a GIN index on the array
-- rather than a join table.
CREATE INDEX combos_pieces_idx ON combos USING gin (pieces);
CREATE INDEX combos_produces_idx ON combos USING gin (produces);

-- ---------------------------------------------------------------- decks

CREATE TABLE decks (
  id                  uuid PRIMARY KEY,
  owner_id            uuid NOT NULL,
  name                text NOT NULL,
  commanders          uuid[] NOT NULL DEFAULT '{}',
  target_bracket      smallint NOT NULL,
  archetype           text NOT NULL,
  archetype_secondary text,
  color_identity      char(1)[] NOT NULL DEFAULT '{}',
  budget_max_total    numeric(10, 2),
  budget_max_card     numeric(10, 2),
  status              text NOT NULL DEFAULT 'active',
  -- Optimistic concurrency (doc 12 §12.7). Bumped per accepted command batch.
  version             integer NOT NULL DEFAULT 1,
  workspace           jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  last_opened_at      timestamptz NOT NULL DEFAULT now(),
  -- 30-day soft delete (doc 12 §12.2). NULL = not deleted.
  deleted_at          timestamptz,
  CONSTRAINT decks_bracket_range CHECK (target_bracket BETWEEN 1 AND 5),
  CONSTRAINT decks_status_known CHECK (status IN ('active', 'archived')),
  CONSTRAINT decks_commander_count CHECK (cardinality(commanders) <= 2)
);

CREATE INDEX decks_owner_idx ON decks (owner_id) WHERE deleted_at IS NULL;
CREATE INDEX decks_last_opened_idx ON decks (owner_id, last_opened_at DESC)
  WHERE deleted_at IS NULL AND status = 'active';

-- Entries are individual rows, NOT keyed by (deck_id, oracle_id): a deck holds
-- 34 Mountains and may hold nine Nazgul, and collapsing them by oracle id is
-- exactly the bug that let a four-Sol-Ring deck validate.
CREATE TABLE deck_entries (
  id            bigserial PRIMARY KEY,
  deck_id       uuid NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  oracle_id     uuid NOT NULL,
  zone          text NOT NULL,
  origin        text NOT NULL,
  locked        boolean NOT NULL DEFAULT false,
  role_override text[],
  tags          text[] NOT NULL DEFAULT '{}',
  added_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT deck_entries_zone_known CHECK (zone IN ('accepted', 'excluded')),
  CONSTRAINT deck_entries_origin_known
    CHECK (origin IN ('core', 'manual', 'recommended', 'imported'))
);

CREATE INDEX deck_entries_deck_idx ON deck_entries (deck_id);
-- Pillar P6: an excluded card must never be suggested again, so the exclusion
-- lookup is its own index and a card may be excluded only once per deck.
CREATE UNIQUE INDEX deck_entries_excluded_once_idx
  ON deck_entries (deck_id, oracle_id) WHERE zone = 'excluded';

CREATE TABLE deck_snapshots (
  id         uuid PRIMARY KEY,
  deck_id    uuid NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  label      text NOT NULL,
  automatic  boolean NOT NULL DEFAULT false,
  payload    jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX deck_snapshots_deck_idx ON deck_snapshots (deck_id, created_at DESC);

-- Idempotency for the batched command endpoint (doc 10 §10.3), so an offline
-- client can retry a queued batch without applying it twice.
CREATE TABLE command_receipts (
  idempotency_key text PRIMARY KEY,
  deck_id         uuid NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  result          jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- statistics

CREATE TABLE card_stats (
  commander_oracle_id uuid NOT NULL,
  oracle_id           uuid NOT NULL,
  inclusion           real NOT NULL,
  synergy             real,
  source              text NOT NULL,
  fetched_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (commander_oracle_id, oracle_id)
);

CREATE INDEX card_stats_commander_idx ON card_stats (commander_oracle_id, inclusion DESC);

-- Ingest is snapshot-and-swap, never in-place (doc 04 §4.7). This records which
-- dataset a recommendation was computed against, so a bug report reproduces.
CREATE TABLE dataset_snapshots (
  id          uuid PRIMARY KEY,
  source      text NOT NULL,
  card_count  integer NOT NULL DEFAULT 0,
  combo_count integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  is_live     boolean NOT NULL DEFAULT false
);

CREATE UNIQUE INDEX dataset_snapshots_live_idx ON dataset_snapshots (source) WHERE is_live;
