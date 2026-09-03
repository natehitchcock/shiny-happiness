# ADR-0056 — A pick passes over the trio it was made from

**Status:** accepted
**Date:** 2026-09-02
**Extends:** [ADR-0040](0040-lands-are-built-last-and-the-loop-ends-with-a-question.md) (the queue is refilled,
and the ending is a question), [ADR-0051](0051-remove-is-not-reject-and-a-cost-is-stated-before-the-click.md) (remove
is not reject). **Changes:** `apps/web/src/Quickbuild.tsx` only — no domain, no
API contract, no command that did not exist before.

---

## Context

> "The quickbuild should cycle all three options out when you pick one. They can
> come back later, but if only one card cycles out then your decision is
> basically the same, and you just either pick the new card or pass. I'd rather
> see whole new options and not have to mash pass to see more useful stuff."

Quickbuild offers three candidates for one gap (doc 19 D1) out of a queue that
holds twenty-four (§19.7). Taking one retired that card through `retiredIds` and
nothing else, so the window advanced by exactly one position.

The builder therefore saw, as the next question, two cards they had just
declined — declined by the act of choosing something else — with one new card
beside them. The second decision is then "this one card, yes or no". Q4 and D6
both say the panel must never take that shape: "it must never become *yes or no
to this one card*: that is a different and worse question than *which of these
three*". The only route to a genuinely fresh three was pressing Skip, which is
what "mash pass" describes.

Measured in a browser, eight consecutive picks on a live `creature` gap: **8 of
8 kept two of the previous three on screen.**

## Decision

**A pick passes over all three, exactly as Skip does.** The difference between
Pick and Skip is now the whole of the difference between them: one of them also
adds a card.

The two cards not taken are **passed, not rejected** — nothing is sent, no
command is queued, and P6 is not engaged. This is D5 applied to a second
control, and it is the trap ADR-0051 found live one surface over: the deck
rail's Remove was issuing `exclude` until that ADR. Driven to 49 picks in a
browser, with 98 cards passed over, the deck's command log held 49 `accept`
commands and zero `exclude`, and the `excluded` zone stayed empty.

**A card passed over comes back on the next FRESH ASK for the gap** — a
different gap, a changed filter, a reopened panel, or a queue that has run out
entirely. It does **not** come back on a background top-up or a refill, which
re-ask the same question and return the same cards at the top: putting them back
there would restore the defect one request later.

**Reject is deliberately not this.** It names one card and is permanent; the two
beside it are still the answer to the question on screen, so they stay and one
new card slides up. The same holds for a card retired in the feed behind the
panel, which is a decision made elsewhere about a trio the builder may not have
finished reading. Only the panel's own Add passes over three.

## Consequences

**The skip cursor becomes a set of ids.** `passed` was a count, and a count
cannot express this: the taken card leaves the queue a render later through
`retiredIds`, so "advance by three" and "advance by two because one of them has
already gone" are different arithmetic for one intent, and both are wrong the
moment a refill rebuilds the list with the same cards at different indices.

The set needs no gap key, which the cursor did. It is emptied by every
foreground `load`, and the panel makes a foreground load on exactly the
condition that discards the queue — so the rule that kept a stale cursor out of
the next gap's page is now the queue's own staleness rule, with nothing to keep
in step. The cursor needed its own key precisely because it was never released.

**The refill moves from one trio of headroom to two.** Three candidates leave
per pick rather than one, so "fewer than three left" is "the next click empties
the panel" and the request would be racing it. Two trios is the threshold
`TOPUP_BELOW_TRIOS` already carries for the deepening, applied to the faster
loop. Eight consecutive picks in a browser showed no loading bar on any of them,
and the click → trio time is unchanged: median 43 ms after, 46 ms before, on the
same deck and gap.

**The empty panel gains a third sentence.** "No more candidates for this gap"
would be false while the panel holds cards it is not offering, so a gap with
cards held back says *"You've seen every candidate we're holding for this gap"*
and carries a **Show the ones you passed** control. The two existing sentences
are untouched: a gap the server never answered still blames the colours or the
filter (Q3), and a gap whose candidates were all taken or rejected still says
there are no more.

The distinction is drawn on **how many held cards are being withheld**, not on
how many ids have been remembered. A refill that comes back empty takes the
whole list away, ids and all — there is then nothing to show again, and the
honest sentence is the one about the gap.

## What was rejected

**Advancing the cursor by two.** Arithmetically equivalent on the render where
the pick happens, and wrong on every other: it depends on the taken card having
already left the list, so it double-counts if the optimistic deck update is late
and it means nothing at all once a refill reorders the queue.

**Releasing the passed-over cards on any refetch.** The deep top-up fires within
a pick or two of the first, and the cards just passed over are at the head of
its answer — the builder would have seen them again immediately, which is the
report.

**Never releasing them inside the gap.** Honest, but it makes "they can come
back later" mean "close the panel and start again", and it leaves the panel
claiming a gap is empty while it holds twenty cards. The **Show the ones you
passed** control is the smaller answer, and it says what it does.
