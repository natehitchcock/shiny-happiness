# ADR-0020 — A per-deck command log is what makes a `409` replayable

- **Status:** accepted
- **Date:** 2026-08-30
- **Supersedes:** nothing
- **Relates to:** [doc 10 §10.3](../10-api-contract.md) (the command endpoint),
  [doc 12 §12.7](../12-deck-library-and-persistence.md) (sync and conflict),
  [doc 12 §12.8](../12-deck-library-and-persistence.md) (snapshots),
  `API-06`, and `WEB-15` (the offline queue that will consume this)

## Context

Deck mutations use optimistic concurrency. The client sends the `version` it
last saw as `baseVersion`; if the deck has moved, the server answers `409`.

Doc 10 §10.3 specifies that response as:

```
→ 409 { deck: Deck, since: DeckCommand[] }   baseVersion is stale; the client
      replays its queue against `deck` and re-sends (doc 12 §12.7)
```

`since` shipped empty and stayed empty, which doc 10 §10.9 records as divergence
1: "`since` needs an ordered per-deck command log keyed by version, and no table
provides one."

An empty `since` is not merely incomplete — it is **actively misleading**. The
client cannot distinguish "nothing you care about changed" from "I cannot tell
you what changed", so `apps/web` did the only thing left: re-read the deck and
re-send the identical batch. For one user with two tabs that is usually
harmless. It has two real failure modes:

- **A silent clobber.** Another client excludes Sol Ring; ours accepts it; the
  accept is re-sent, clears the exclusion, and nothing anywhere records that a
  deliberate rejection was overturned. Doc 12 §12.7 requires the opposite:
  "Never silently discard a user action."
- **A rejection the user did not cause.** Another client already excluded the
  card ours is excluding. Re-sending earns `already-excluded`, which the UI can
  only present as a failure — for a click that in fact succeeded, elsewhere.

### Doc 10 and doc 12 do not agree, and the difference matters

Doc 10 §10.3 types `since` as `DeckCommand[]`. Doc 12 §12.7 says a genuine
conflict resolves to "the more recent user intent **by wall-clock timestamp**".
A bare `DeckCommand` carries no timestamp and no version, so the shape doc 10
pins cannot support the rule doc 12 states. Neither document is wrong about its
own subject; they were written for different halves of the problem. This ADR
resolves the gap additively rather than by choosing one.

## Decision

### 1. A new table, `deck_command_log` (migration `0012`)

```sql
CREATE TABLE deck_command_log (
  deck_id    uuid NOT NULL REFERENCES decks (id) ON DELETE CASCADE,
  version    integer NOT NULL,
  commands   jsonb NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (deck_id, version)
);
```

`version` is the version the deck **reached**, so `WHERE version > $baseVersion`
is exactly "what this client has not seen". Only *applied* commands are stored:
a rejected command changed nothing, and replaying the server's own refusals is
worse than replaying nothing. The row is written inside `applyBatch`'s
transaction, next to the entry rewrite and the idempotency receipt, so a version
bump the log cannot explain is impossible.

The primary key is the point, not decoration: it makes "one batch per version" a
fact the database enforces. `applyBatch` already holds the deck row `FOR UPDATE`
while it bumps the version, so a duplicate would be a bug in that lock — and a
loud failure beats a log that silently reports one batch twice.

### 2. Two new **optional** response fields, and no change to any existing one

```
409 {
  deck: Deck,
  since: DeckCommand[],              // unchanged shape, now populated
  sinceBatches?: DeckCommandBatch[], // NEW — the same data, grouped by version
  sinceComplete?: boolean            // NEW — false ⇒ refetch, do not replay
}
```

`since` keeps the flat shape doc 10 §10.3 pins, because other agents are coding
against it and populating a documented field is not a contract change.

`sinceBatches` is that same data grouped the way the server applied it — one
entry per version, each with `appliedAt`. This is what doc 12 §12.7's wall-clock
rule needs. A live client never needs it, because every batch in `since` is
already committed by the time its own request is sent; an **offline queue**
drained hours later does, because a command typed at 09:00 and sent at 17:00 is
not more recent than a foreign one from 12:00. That is `WEB-15`'s case, and
shipping the timestamp now is what stops `WEB-15` having to change this contract
a second time.

`sinceComplete` is the honesty field. It is `true` only when the log covers the
whole gap between the client's version and the deck's. Without it an empty
`since` still means two different things, and a client that assumed the harmless
one would rebase against history it never saw. It is optional in the type only
so a client compiled against the pre-`API-06` contract still typechecks; the
server always sends it, and a client must treat *absent* as "cannot tell".

Both fields are additive, so per AGENTS.md R2 they are not contract changes.
This ADR exists for the schema decision and for the doc-10/doc-12 gap above.

### 3. `rebaseCommands` in `packages/domain`, pure

The decision "does this queued command still need to be sent?" lives beside
`applyCommands`, for the reason the rest of that file does: `web` and `api` both
run it and must agree (doc 09 §9.4). It takes the queue and `since` and returns
three lists — `replay`, `superseded`, `overrides`.

It drops **only** commands whose intent is already true (`exclude` of an
already-excluded card, `restore` of a card no longer excluded, `remove` of a
card whose copies an exclusion already took, a `lock`/`setRole` already set to
the same value). That is not discarding a user action: the state they asked for
exists. Everything else is replayed, conflicts included, and the conflicts are
reported in `overrides` so a caller can say so rather than hide it.

It has no clock, so it does not apply doc 12 §12.7's timestamp rule itself. For
a live client the answer is always "our intent is newer". `WEB-15` will resolve
the offline case using `sinceBatches[].appliedAt` and its own queue timestamps.

## Consequences

**A 409 now costs one extra small query.** Bounded by `SINCE_LIMIT` (200
batches); past it, `sinceComplete` is `false` and the client refetches — which
is exactly what it did before this existed, so the fallback is the old,
already-shipped behaviour rather than a new untested path.

**Decks predating this migration report `sinceComplete: false`** until they have
been edited enough for the log to reach back. They degrade to the old behaviour
rather than to a wrong one, which is the reason `sinceComplete` exists.

**The log grows without bound.** A batch is a few hundred bytes and a deck's
history is bounded by how much a person edits it, so this is not urgent, but it
is real and nothing prunes it yet. See "not done" below.

**Doc 12 §12.8's snapshots get cheaper.** That section already says snapshots
are "cheap to implement on top of the command log" — it was written against a
table that did not exist. Now it does.

**Not done, deliberately:** no retention or pruning policy (a `DELETE` of rows
older than the oldest plausible offline queue is the obvious shape, and belongs
with `WEB-15`, which is what decides how old that is); no surfacing of
`overrides` in the undo history, which doc 12 §12.7 describes as *"Not applied:
excluded Sol Ring (changed on another device)"* — there is no undo history yet,
and inventing one here would be `WEB-15`'s work done badly in advance.

## Alternatives considered

**Add `version` to `command_receipts` and read `since` from there.** The
tempting one: receipts already store each batch's `applied` list keyed by deck,
so this would be one column instead of one table. Rejected on three counts.
Receipts exist for batches that applied *nothing*, so `version` would not be
unique per deck and "the batch that took the deck to version 7" would have no
single answer. Receipts are idempotency scratch, correct to prune once no client
can still retry — hours — whereas a replay log must outlive every client that
may still be behind, which with an offline queue is days; one table cannot hold
two retention policies without one of them quietly winning. And a receipt stores
`rejected` too, which `since` must never carry.

**Derive `since` by ordering receipts on `created_at`.** No new schema at all.
Rejected because `now()` is transaction-start time in Postgres, so two batches
can commit in an order their timestamps do not reflect — and there is still no
version to anchor "since `baseVersion`" to.

**Diff the deck instead of logging commands.** Compare the client's entry list
against the server's and send the difference. Rejected: a diff cannot tell
`exclude` from `remove` (both leave the card out of the accepted set, and one of
them is a pillar-P6 judgement while the other is an amount), and doc 12 §12.7's
resolution rule is stated over commands, not over states.

**Change `since` to a richer shape and drop the flat list.** Honest, and one
representation instead of two. Rejected because it is a breaking contract change
under AGENTS.md R2 for a field other agents are already coding against, and the
additive version costs one `flatMap` on a path that runs only on a conflict.

**Have the client drop a queued `accept` when `since` accepted the same card.**
The most tempting rebase rule, and wrong: a deck legitimately holds 34
Mountains, and `rebaseCommands` has no card data with which to tell a basic land
from a singleton. Dropping the accept would silently lose a real copy. Replaying
it earns an honest `not-singleton` for the cards where that is the truth. There
is a regression test asserting this so it cannot be "fixed" back in.
