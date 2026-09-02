# 41. The deck is written in the order it was clicked

Date: 2026-09-01

## Status

Accepted. Amends [ADR-0036](0036-a-conflict-is-a-loop-and-a-lost-decision-is-never-silent.md).

> **Number 0041 was assigned to this work.** Do not derive a free number by
> reading the directory — several pairs of agents have collided that way.

## Context

Two reports, an hour apart, both about command integrity.

> "I clicked add card when the loading bar was at the middle, and the count of
> cards to add reset back to 1 (it was 2 before I clicked add). When the bar
> resets, it should continue to count changes since the last time it refreshed
> the view. This includes removals and adds."

> "at no point should an operation be undone that a user did. Basic lands
> should never be un-added if they add some in quick succession. Cards adds or
> removes should never be dropped. Build some playtesting tests to verify this
> is the case. The only time a dropped action is acceptable is if there is a
> catastrophic loss of connection."

ADR-0036 fixed one instance of the second: three rapid rejections produced two
409s, the second escaped `load` as a rejected promise, and `usePipeline`
discards a superseded run's rejection. That fix stands. What follows is what a
randomised playtest suite found once it went looking for the rest.

### The count was reading the wrong list

`usePipeline` kept ONE list. `items` was both "what to send next" and "what to
put in the label", and the tick empties it the moment a batch goes on the wire:

```ts
const batch = items.current
items.current = []            // sent
...
schedule = (item) => { items.current = [...items.current, item]
                       setQueued(items.current) }   // rebuilt from empty
```

So two cards in the buffer, a third click at the bar's halfway mark, and the
label went from "Adding 2 cards…" to "Adding 1 card…". Reproduced in a browser
against the real API at ~600 ms of command latency, and again with a removal in
the mix. The two earlier cards had not been applied and were not visible
anywhere else on the page, so the tally was the only thing counting them.

The user's own words are the specification: *changes since the last time it
refreshed the view*. That ends at the APPLY, not at the send.

### `refresh` threw the buffer away

`refresh` — a filter change, a deck option, a focus change — did this:

```ts
items.current = []
start(false, /* skipBuffer */ true)   // and `start` sent `[]`
```

A card clicked in the 600 ms before a filter committed was therefore never sent
at all, while the optimistic overlay showed it landing until the refresh's own
answer swept it off. That is a silent drop with no connection involved.

### A conflicted batch was re-sent behind the batches after it

The one the playtest suite found, and the one nobody would have scripted.

Sends were concurrent by design: three decisions in series put up to three runs
on the wire, each having read `serverDeckRef` before the others moved it. A 409
is the normal case, and ADR-0036 made the recovery a bounded rebase loop. But
the recovery re-sends, and the re-send goes out AFTER the batches queued behind
it have already committed. The server therefore applied the user's commands in
an order they did not click them in:

| batch | commands | outcome |
|---|---|---|
| C | `accept Forest` | 409 → re-read → rebase → re-send |
| D | `remove Forest` | 200, commits first |
| C′ | `accept Forest` | 200, commits second |

Clicked plus-then-minus; stored as minus-then-plus; a Forest left behind that
the user had taken out. `rebaseCommands` is not at fault — it correctly never
drops an `accept` — and the final state is only sometimes wrong, which is
exactly why twelve randomised seeds found it and four scripted cases did not.

This is the second report's sentence almost word for word: *"at no point should
an operation be undone that a user did."*

### A lost connection was still silent

`sendWithRetry` gives up after four attempts and throws. `load` rethrows
anything that is not a 409. `usePipeline` discards a superseded run's
rejection — which is the very channel ADR-0036 took the 409 path OFF, and the
network path was left on it. So the failure ADR-0036 was written to close was
still reachable, by a different route, whenever the connection went away during
a fast sequence.

The user allows this drop. They do not allow the silence.

## Decision

**Four changes. The deck is written in click order, and every way a command can
fail to land now produces a sentence.**

1. **`pipeline.ts` keeps two lists.** `items` is "not sent yet" and is emptied
   by the send. `unapplied` is "not applied yet", is emptied only by `finish`,
   and is what the label counts.

2. **`refresh` sends the buffer with the new question** instead of dropping it.
   A command is the user's intent and does not expire because the question
   changed.

3. **One batch is on the wire at a time** (`sendGate` in `App.tsx`). The queue
   is reserved synchronously, before `load`'s first `await`, so it is in the
   order the buffers closed, which is the order the clicks happened. The
   version is re-read after the wait, so the batch behind sends at the version
   the batch ahead produced.

4. **`droppedNotice` names the card when the send fails outright**, and says
   whether the connection went or the server refused. It is said in `load`,
   which knows a write was in flight, rather than left to `pipeline.error`,
   which is suppressed for a superseded run and names the fault rather than the
   card.

### On serialising the sends, which ADR-0036 rejected

ADR-0036 rejected "serialise the sends behind a promise chain". This is not a
reversal, and the difference is which half is held.

That rejection was about serialising the RUN — send *and* recompute — on the
grounds that "the newest decision would have to wait behind every slow
recompute ahead of it, and the pipeline exists precisely so a user can outrun
the recompute". That reasoning is correct and is preserved: only the send is
queued here. The recompute stays concurrent, a run is still superseded the
instant the user clicks again, and neither the bar nor the settle changes.

What was not weighed at the time is that concurrency on the send half does not
merely risk a 409 — it forfeits ordering, because a rebased batch re-enters the
queue at the back. There is no client-side repair for that: the rebase cannot
know that the command it is replaying is older than the one already committed.
Ordering has to be bought at the send, or not at all.

The wait costs nothing the user can see. The click is already on screen
optimistically; the batch behind was going to wait for a version number
anyway — it just used to wait by being refused and re-sent, which cost two
extra round trips instead of none.

### Rejected: a sequence number on the wire

Let the batches race and have the server order them. It is the general fix, it
is an API change, and it would put reordering logic in the one place that
currently has none. The client is the only thing that knows what order the user
clicked in; keeping the order there keeps the server's rule simple — the
version is the order.

### Rejected: leave the ordering alone, since the final state is usually right

It is usually right. "Usually" is the whole complaint: a plus and a minus on
the same basic, seconds apart, is a thing people do constantly while tuning a
mana base, and a Forest that comes back is indistinguishable from the app
losing a click.

### Rejected: report the dropped connection from `pipeline.ts`

Same answer ADR-0036 gave for the 409, and for the same reason: `pipeline.ts`
cannot tell a failed write from a failed read, and a superseded run's failed
read is genuinely uninteresting. The distinction lives in `load`.

## Consequences

- **The bar's count is now "what you have done since the list last moved".**
  Verified in a browser: two adds, a third click at the halfway mark, "Adding
  3 cards…", and all three in `deck_entries`. Then the same with a removal
  mixed in: "Updating 3 cards…", two accepts and one exclusion stored.

- **Six adds and one removal of the same basic, 700 ms apart, leave five
  copies.** In a browser, against the real API and database.

- **A conflicted batch no longer costs extra round trips for a single client**,
  because a single client no longer conflicts with itself. The bounded rebase
  loop from ADR-0036 is untouched and is still what handles another client
  writing to the same deck.

- **A batch that fails does not block the ones behind it.** The gate is
  released in a `finally` and the queue is awaited with `.catch`, because one
  lost connection is not a reason to drop later clicks.

- **`apps/web/src/playtest-integrity.test.tsx`** is a property-style suite:
  twelve seeded runs of randomised adds, removes and rejections at randomised
  intervals against a fake server with randomised latency and randomised
  conflicts, plus the basic-land and connection-loss cases the reports name.
  It asserts the ordered list of commands the server applied equals the ordered
  list of controls the user clicked. Every timer is virtual, so the file runs
  in about three seconds and cannot flake under load — which mattered, because
  the equivalent scripted suite takes forty seconds per case.

- Five of the twelve seeds failed on the ordering assertion before change 3.
  The seed is in the test name, so a failure replays exactly.
