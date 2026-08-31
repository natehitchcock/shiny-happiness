-- What happened to a deck between two versions (API-06, doc 12 §12.7).
--
-- `POST /decks/:id/commands` answers 409 with `since` — "the commands the
-- server has accepted since your version". Nothing could answer that: the deck
-- row carries only its CURRENT state and its current `version`, and a state is
-- not a history. A client that is behind could refetch and rebuild, but could
-- not tell whether the intervening edit conflicted with the batch it was about
-- to re-send, so two clients on one deck clobbered each other silently.
--
-- Rejected alternative: add `version` to `command_receipts` and read `since`
-- from there. It already stores each batch's `applied` list keyed by deck. It
-- was rejected for three reasons:
--   * receipts exist for batches that applied NOTHING, so `version` would not
--     be unique per deck and "the batch that took the deck to version 7" would
--     have no single answer;
--   * receipts are idempotency scratch, correct to prune once no client can
--     still retry (hours), while a replay log must outlive every client that
--     may still be behind (days, offline). One table cannot have two retention
--     policies without one of them quietly winning;
--   * a receipt stores `rejected` as well, which `since` must never carry —
--     a command the server refused did not happen and must not be replayed.
--
-- Doc 12 §12.8 already assumes this table exists ("snapshots ... cheap to
-- implement on top of the command log"), so this is the log that document was
-- written against rather than a new concept.
--
-- `version` is the version the deck REACHED, so `WHERE version > $baseVersion`
-- reads exactly the changes a client on `$baseVersion` has not seen.
--
-- Only APPLIED commands are stored. Rejected ones changed nothing, and a client
-- replaying them would be replaying the server's refusals.
CREATE TABLE deck_command_log (
  deck_id    uuid NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  version    integer NOT NULL,
  commands   jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  -- One batch per version, enforced rather than assumed. `applyBatch` holds the
  -- deck row `FOR UPDATE` while it bumps the version, so a duplicate here is a
  -- bug in that lock, not a race to tolerate — and a primary key turns it into
  -- a loud failure instead of a log that silently reports one batch twice.
  PRIMARY KEY (deck_id, version)
);

-- The primary key already orders by (deck_id, version), which is the only read
-- this table has: "everything after version N for this deck". No second index.
