# 36. A conflict is a loop, and a lost decision is never silent

Date: 2026-09-01

## Status

Accepted.

> **Number 0036 was assigned to this work.** 0033, 0034 and 0035 are claimed by
> agents running concurrently with this one; 0035 is the highest taken. The next
> agent should take 0037 and should not derive a free number by reading the
> directory — several pairs of agents have collided that way.

## Context

Reported by a builder: *"I rejected three cards, but only one ended up on the
rejected list. It looks like something can go wrong with quickly rejecting cards
in series."*

Reproduced in a browser against the real API and the real database. With ~900 ms
of command latency and clicks 700 ms apart, three rejections produced this on
the wire:

| batch | commands | baseVersion | result |
|---|---|---|---|
| 1 | `exclude A` | 5 | 200 → v6 |
| 2 | `exclude B` | 5 | **409** |
| 3 | `exclude C` | 6 | 200 → v7 |
| 2′ | `exclude B` | 6 | **409** — nothing caught it |

`deck_entries` afterwards held A and C and not B. The rejected list on screen
showed all three for about a second — the optimistic overlay was never swept,
because the run that would have swept it had failed — and then showed two. No
banner, no console error, nothing. The identical sequence on the accept path
lost the middle accept in the same way, as did a mixed accept-then-reject-then-
accept run.

### Why three clicks put three requests on the wire at once

By design. `usePipeline` buffers clicks for 600 ms; a click after that window
has closed restarts the cycle, and the run it interrupts stays in flight,
because nothing can cancel a request that is already away — and, crucially,
because **that run's writes are still wanted**. ADR-era comment in
`pipeline.ts`: *"A counter rather than an abort: the stale request's WRITES are
wanted … it is only its READ of the suggestions that is out of date."*

So three decisions in series mean up to three `load` runs racing, each having
read `serverDeckRef` before the others moved it. A 409 is therefore the normal
case, not the exceptional one.

### Why the recovery was not enough

`load`'s 409 handler re-read the deck, rebased the batch against `since`
(API-06), and re-sent it **once**, at the version it had just read. A third
run's batch commits in the window between that re-read and that re-send, so the
recovery itself earns a 409. `sendWithRetry` does not retry a 409 — correctly,
it needs a new version rather than patience — so the second conflict escaped
`load` as a rejected promise.

`usePipeline` then discarded it:

```ts
.catch((e) => {
  if (generation.current !== mine) return   // superseded — drop it
  setError(...)
})
```

That guard is the fix for the *earlier* reported bug ("I queued three adds and
only the first removed itself"), where a superseded run's stale **answer** was
being applied. It is correct for answers. Applied to failures it is wrong, and
the two defects compound exactly: the more decisions the user makes in a row,
the more runs get superseded, and the more likely it is that the one run that
failed is one whose failure will be thrown away.

**This is a sibling of the `generation` bug, not a recurrence of it.** The old
fix works and is untouched. What it did not cover is that a superseded run's
write half still matters, and its failure is part of that half.

### The second silence

`QueryResult.rejected` carried the server's refusals so `rejectionNotice` could
say *"X was not added — it is banned in Commander."* It was returned through the
run's result — and a superseded run never applies its result. So the runs whose
refusals matter most, the ones a user's next quick click interrupts, were
precisely the ones whose refusals were never spoken.

## Decision

**A version conflict is resolved in a bounded loop, and a decision that cannot
be placed is reported by name.**

Three parts, all in `apps/web/src/App.tsx`:

1. **`load` loops the 409 recovery**, up to five rounds. Each round re-reads the
   deck, rebases the surviving commands against `since`, and re-sends at the
   version it just read. Each round is strictly closer to done: the rebase drops
   commands whose intent is already true and re-sends the rest at a strictly
   newer version.

2. **Exhausting the loop produces a sentence, not an exception.** `unsavedNotice`
   names the card: *"Beta Bear was not saved — the deck kept changing while your
   click was on its way. Try it again."* An exception was what got swallowed;
   the whole point is to stop routing this through a channel that has a
   legitimate reason to discard things.

3. **Refusals are banked in a ref, not returned in the run's result.** `load`
   pushes what the server refused into `refusalsRef`; whichever run does apply
   drains it and says what *every* run before it was told. `QueryResult.rejected`
   is gone, so there is no second place for a refusal to be dropped.

`pipeline.ts` is unchanged. That was deliberate — see below.

### Rejected: serialise the sends so no two batches overlap

Chain every batch behind the previous one and the conflict cannot happen at all.
Rejected because it removes the point of superseding a run: the newest decision
would have to wait behind every slow recompute ahead of it, and the pipeline
exists precisely so a user can outrun the recompute. It trades a rare lost click
for a guaranteed slow one.

### Rejected: report the failure from `pipeline.ts` instead

The obvious fix is to make the superseded-run `catch` still call `setError`.
Rejected because `pipeline.ts` is generic — it cannot tell a failed **write**
from a failed **read**, and a superseded run's failed read is genuinely
uninteresting when a newer run has already answered. Reporting both would put an
error banner on screen every time a recompute lost a race it was supposed to
lose. The distinction lives in `load`, which knows whether it was sending
commands, so the reporting lives there too.

### Rejected: an unbounded retry loop

A deck another client is actively writing to would spin. Five rounds is well
past the three runs this client can have in flight; past that, the honest answer
is to tell the user rather than to keep trying in silence.

### Rejected: say the refusal at send time rather than at apply time

It would be simpler than banking it. But the sentence is timed to appear as
`setPending([])` sweeps the overlay that showed the card landing — said earlier
it explains a disappearance that has not happened yet, and `act` clears the
notice on the next click, so a fast clicker would wipe it before reading it.

## Consequences

- **Three decisions in series now all reach the database.** Verified in a
  browser against the real API: reject/reject/reject, add/add/add, and
  add/reject/add each produce a 409, a second 409, and then a successful third
  attempt, and `deck_entries` holds all three afterwards.

- **A conflicted batch can now cost three round trips instead of two.** Only
  when the deck is genuinely moving underneath it. The user sees nothing
  different: the run is unresolved for the whole of it, which is what already
  holds the progress bar at its halfway mark.

- **The `rejected` field is no longer on `QueryResult`.** It is local to
  `apps/web` and not part of doc 10's contract, so this is not an R2 change.

- **A refusal heard by any run is now announced.** Previously only the winning
  run's were, which meant an illegal add made during a fast sequence could still
  disappear without explanation — the exact failure `rejectionNotice` was
  written to close, reopened by a different route.

- Four regression tests in `apps/web/src/serial-decisions.test.tsx`, all four
  failing on `main` before this change. They drive the real `Workspace` against
  a fake server that enforces optimistic concurrency and keeps a `since` log,
  with latency long enough that the runs genuinely overlap — an instant server
  never produces the race, which is why nothing in the existing 2,141 tests
  caught this.
