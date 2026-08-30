# 14. A deck belongs to a device, not to a person

Date: 2026-08-30

## Status

Accepted. Supersedes the `DEV_OWNER_ID` placeholder and removes `API-03` (auth)
from the critical path.

## Context

Every deck belonged to one hardcoded owner, `00000000-…-0001`, with a comment
saying ownership was `API-03`'s job. `API-03` was also the task gating any
deployment, because a deployed app where every visitor shares one deck list is
not deployable.

The obvious next step was accounts. But an account is a real cost paid by the
user before they get anything: a password to invent, an email to confirm, a
thing to lose. For a deck builder — a tool you open, use for an hour, and export
from — that is a poor trade, and it is the single most common reason someone
closes a tab.

## Decision

**The browser generates a v4 uuid once, stores it in `localStorage` as
`lw.deviceId`, and sends it as `X-Device-Id`.** The server scopes decks to that
value. There is no account, no password, and nothing to sign in to.

The `owner_id` column does not change shape — it was already a uuid with an
index. What changes is what it means, which is why migration `0004` is a comment
on the column plus the unrelated `description` field, and nothing else. That the
change is this small is the payoff from having read the owner through one
resolver rather than spreading `owner_id` through the queries.

`ownerOf(req)` validates the header against a uuid pattern and falls back to the
old fixed id when it is missing or malformed. Validated because the value goes
straight into a uuid column and an unparseable one would surface as a 500 from
the driver rather than a 400 from us. The fallback keeps decks built before this
existed reachable.

**A deck also gains a `description`** — free text, never parsed, empty rather
than null so nothing downstream has to decide what a missing one means.

## What this is not

**It is not security.** Anyone holding a device id can read that device's decks.
That is acceptable here because a deck list is not a secret and the id is a
random v4 uuid that never appears in a URL, a referrer, or a log line we emit.

It is not acceptable for anything else. **Nothing but decks may ever be scoped
by this header.** If this project grows something worth protecting, that feature
brings real auth with it; the seam is still one function.

## Consequences

- `API-03` is no longer a blocker. It becomes optional work — "sign in to sync
  across devices" — layered on top rather than underneath.
- **Clearing site data loses every deck on that device.** There is no recovery
  and no support channel that could recover it. Export is the only backup, which
  is why it sits in the masthead rather than behind a menu. A future "your decks
  live in this browser" note near Export would be worth adding.
- A deck cannot follow you to another machine. Import/export is the workaround,
  and it round-trips losslessly (doc 15).
- `GET /api/v1/decks` now exists, returning summaries for the calling device.
  Summaries, never full decks: drawing a switcher menu must not load twelve
  decks' worth of entries (doc 12 §12.2).
- Decks are still server-side, so the corpus and the deck share one database.
  The alternative — decks in IndexedDB, a stateless API — was considered and
  rejected as roughly four times the work for a privacy property this app does
  not need, since it would still have to host the 211 MB card corpus regardless.
