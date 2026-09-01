# 31. A card is offered under the role it is counted as

Date: 2026-09-01

## Status

Accepted.

> **Number 0031 was assigned to this work.** 0030 (the picture flips and the
> text does not) is the highest taken. The next agent should take 0032 and
> should not derive a free number by reading the directory — three pairs of
> agents have collided that way.

## Context

Found while measuring Quickbuild's open question Q1 (doc 19 §19.4), on eight
real decks against the real pool. It is not a Quickbuild defect; it is older
than Quickbuild and it ships today.

This product has three different answers to "what role is this card?", and two
of them are supposed to be the same answer.

| | what it computes | who reads it |
|---|---|---|
| `card.roles` | the full set | the `role:` **query filter** (`roles.some(...)`) |
| `primaryRole(card.roles)` | one role, by `ROLE_PRECEDENCE` | composition **counting**, and therefore every meter |
| `pooled.roles[0]` | one role, by **database array order** | candidate **grouping**, and the `fills-deficit` reason |

The first is a different question and is correct as it stands — see "What is
not changing" below. The second and third are the same question, asked twice,
answered differently.

`countComposition` counts a card under `primaryRole(roles)` because composition
totals need exactly one role per card or they double-count (doc 02 §2.4).
`recommend` assigned `fills-<role>` from `pooled.roles[0]`, which is whatever
order the roles happened to come out of the database in and carries no meaning
at all. Nothing held the two together, and nothing could: they are two
expressions in two files with no shared definition.

Measured over eight real decks (10–99 cards accepted, ~5,000 eligible
candidates each):

- **8.4%** of the candidate pool is assigned a different role by the two rules.
- **20.4%** of the rows actually shown under a `Fills gap · X` heading — 80 of
  392 — would not have moved meter X if accepted.

Real rows on `main` before this change. "Fills gap · draw −9" offered Shorikai,
Genesis Engine, Ominous Seas, Bone Miser and Idol of Oblivion; all five count as
`token-maker`. "Fills gap · tutor −1" offered Nurturing Bristleback, which
counts as `token-maker`. Nothing on the row said so.

That breaks **P4**. A recommendation must carry a reason that is true, and
`fills-deficit` naming a dimension the card does not count toward is a false
one — not imprecise, false. The builder accepts the card the app asked for, and
the meter the app pointed at does not move.

## Decision

**Grouping and the `fills-deficit` reason use `primaryRole(roles)` — the same
function the meters count with.**

Stated once, as `countedRole` in `recommend.ts`, rather than corrected at each
of the two call sites. The whole defect was two places computing a card's role
independently; fixing it by adding a third correct copy would leave the next
edit free to reintroduce it.

### What is NOT changing: the `role:` query filter

`role:token-maker` still matches the full role set, and should. A card that is
both removal and a token maker genuinely *is* a token maker, and a filter that
missed it would be wrong. The two questions are different:

- **filtering** asks "is this card one of these?" — a set membership test;
- **counting** asks "which single bucket does this card occupy?" — a partition.

Only the second has to agree with the meters, and only the second was wrong.
Changing the filter as well would have been a second, unrelated behaviour
change smuggled in under one heading.

### Rejected: leave it, and narrow Quickbuild's wording

The cheap fix was for Quickbuild to say "related to your draw gap" instead of
"fills it". Rejected because the defect is not Quickbuild's and does not go away
when Quickbuild describes it more vaguely — the suggestion feed makes the same
false claim today, to every user, on a fifth of its gap rows. Softening the
language downstream would leave the untrue reason on screen and add a second
vaguer one beside it.

### Rejected: make counting use `roles[0]` instead

It would also make the two agree, and it is the smaller diff. But `roles[0]` is
database insertion order. Agreeing on a meaningless rule is not agreement, it is
two things being arbitrary together, and it would have made the meters — which
are correct today — wrong instead.

## Consequences

- **The suggestion feed changes for every deck, and this is deliberate.** Across
  the eight decks measured, 2,197 candidates change which `fills-` group they
  qualify for, and **43 of 705 shown rows (6.1%)** are affected.

- **Some genuinely useful cards stop appearing under a gap heading.** Skullclamp
  (`[draw, equipment]`), Mask of Memory, Sword of Fire and Ice and Life from the
  Loam all leave `fills-draw`, because `ROLE_PRECEDENCE` counts them as
  equipment or recursion and most archetypes have no target for those. They are
  not removed from the suggestions — they fall through to `high-synergy` or
  `staple`, where they are ranked by the same score as before.

  This is correct-but-surprising, and it is worth stating plainly rather than
  discovering later: a card that the meters do not count as draw was never
  closing the draw gap, however much it draws cards. If Skullclamp *should*
  count as draw, that is an argument about `ROLE_PRECEDENCE` — and the value of
  this change is that `ROLE_PRECEDENCE` is now the single place to win it. It
  used to be winnable in one place and lost in the other.

- **Others move to a truer heading.** Inspiring Call, Toski, Bearer of Secrets
  and Veil of Summer move from `fills-draw` to `fills-protection`, which is
  what the meters have always counted them as.

- `total` and `withheldByFilter` are per group, so both move with the
  membership. No count is now reported against a group it was not computed for.

- The whole suite passes unchanged — 2,073 tests, 91 files. Nothing was pinning
  the old behaviour, which is itself the finding: the disagreement was invisible
  to the tests because no test compared grouping against counting. Two now do,
  and one of them asserts the agreement against `countComposition` itself rather
  than against a literal, so a future change to `ROLE_PRECEDENCE` cannot let the
  two drift apart again while the tests still look like they check something.

- Downstream, Quickbuild's gap answers went from 7/12 gaps exactly right to
  **12/12**, and from 28/36 to **36/36** cards, with no other change. Every one
  of its previous misses was this defect.
