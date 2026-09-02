# 49. The barometer findings nobody drew, and the last 41 stale combos

Date: 2026-09-02

## Status

Accepted.

> **Number 0049 was assigned to this ADR, not chosen.** The directory was
> deliberately not listed: reading it to find "the next free number" is how 0027
> was claimed twice and how 0038 nearly was. The next agent should take 0050.

## Context

One playtest. A 100-card Kess, Dissident Mage deck built to bracket 3, and two
defects that between them make the tool untrustworthy for bracket-restricted
play. They are unrelated to each other and both are narrow.

### Report 1 — the bracket panel was silent by construction

`GET /decks/:id/analysis` answered, for a deliberately-built deck:

```
two-card-infinites  warn   3   ['1259-4872', '481-4872', '542-5034']
extra-turns         error  1
mass-land-denial    warn   1
```

The panel showed **four rows of "no published rule" and nothing else**, directly
underneath the server's own sentence saying the findings *are* reported:

> only the Game Changers allowance is checked against a published rule. Wizards
> withdrew the tutor restriction and publishes no current per-bracket value for
> mass land denial, extra turns or two-card infinites, **so those are reported as
> findings about the deck** and no bracket is assessed

A builder reading that panel would take the deck to a bracket-3 table believing
the tool had looked at it.

### Report 2 — 41 stale combo rows, concentrated

```sql
SELECT count(*) FROM combos WHERE combo_id LIKE '%--%';  -- 41
```

All three pieces (34) or four (7). By colour identity: **B 18, WB 12, UR 7,
BG 3, BR 1** — so a Grixis or mono-black deck is the worst case, and 30 of the
41 are one Veinwitch Coven + Phyrexian Altar family. On the playtest deck, **5
of 12 "assembled" combos were these**, every one of them claiming
`infinite-creatures, infinite-lifeloss`.

## Decision

### 1. The client reads `bracket.barometers`. It never did.

`apps/web/src/api.ts`'s `BracketReport` had **no `barometers` field**. Every
occurrence of the word in `apps/web/src` was a comment or the
`bracket-barometers` CSS class. The client rendered a static four-row table from
`rules.targetBracket`'s four nulls and never looked at the findings.

**The domain and the API needed nothing**, and that was checked rather than
assumed: `bracketFindings`, `BAROMETER_BASIS` and the analysis route were read,
and then a local API was pointed at the live corpus and asked for a deck built
to trip all three barometers. It answered all three, correctly, with `basis`
attached. The whole defect was in the last hop.

**A row now carries both claims**, because they are about two different things:
what the FORMAT publishes for that barometer (nothing, so far) and what WE
counted in this deck. A barometer with a finding and a barometer with no
published rule are different states and neither may erase the other, so the
"no published rule" line stays exactly where it was and the finding is drawn
under it.

The reasoning the old code carried is kept and extended, not deleted. The four
rows are still rendered from the server's own nulls rather than from a list in
the client, for the reason ADR-0018 gives: a client-side table of barometers
would be the retired ruleset AGENTS.md §8 rejects, and would keep saying "no
published rule" for a barometer Wizards had since published.

Four things the panel does that are decisions rather than detail:

- **`basis` is rendered**, in the server's own words, in BOTH states — with
  findings it qualifies them, without findings it says what was looked for.
  It travels with the findings precisely so the client cannot forget it or
  invent its own; a panel that dropped it would turn our count into Wizards'
  ruling. Silence is not the safe option here: an empty panel reads as "not
  checked", which is the defect one size smaller.
- **Severity is a word, not a colour.** Rust and sage sit at ΔE 4.5 under
  deuteranopia (`packages/ui/src/tokens.ts`), so "Warning" and "Error" are
  spelled out and `data-severity` only paints them — the same rule the bracket
  chip next door already follows with its `!` marker.
- **Every count opens** into the deck's cards behind it, each of which opens the
  card (P4). The toggle is labelled for its barometer, because two findings of
  the same size otherwise produce two buttons with the identical accessible name
  "2 cards behind this count" and a screen-reader user has nothing to tell them
  apart.
- **Findings do not wait on `rules.targetBracket`.** The server sends them
  whether or not the rules file loaded, so hanging them off the published entry
  would drop them exactly when the panel has least else to say. A finding for a
  barometer this build has never heard of renders too, humanised — dropping it
  would be the client deciding what the format's barometers are.

`doc 10` gains the `barometers` shape, which it never documented even though the
server has been sending it.

#### 1a. Drawing the sentence is what showed it was ungrammatical

The land-denial message read, at any count but one:

> 2 cards in this deck destroy, **exiles, forces** the sacrifice of, or
> **overwrites** the type of a land.

Only the first of four verbs went through `plural`. It is a one-line fix and it
is recorded because of *why* it survived: **a message no surface draws is a
message nobody reads.** The unit tests asserted `toContain('2 cards')` and were
right to pass.

### 2. `DELETE FROM combos WHERE combo_id LIKE '%--%'` — and why it is exact

ADR-0038 §"Found, and deliberately not done" recorded these 41 rows as
unreachable, and its reasoning was correct as far as it went. Its prune deletes
variants the ingest **reads and positively rejects**; these are variants
Spellbook has **withdrawn from the feed entirely**, so nobody reads them, nobody
rejects them, and there is no id to pass to `deleteCombos`. Reaching them by id
needs "delete every id this run did not write", which empties the table on a
truncated download or a `--limit` run — refused there, and still refused here.

The third way is to delete on the ID SHAPE, with no reference to the feed at
all. **The premise was tested before it was used**, in three parts:

**No legitimate combo id contains `--`.** Spellbook's variant id is
`<card ids>--<template ids>`, and the doubled hyphen is an EMPTY CARD SEGMENT —
the source's own mark for a piece that is a card class. A card segment is a
non-empty run of digits, so `--` cannot arise any other way. Checked against the
live corpus rather than reasoned about: all **104,616** stored ids match
`^[0-9]+(-[0-9]+)*(--[0-9]+)*$`; all 41 with a `--` carry it as a trailing
`--<digits>`; and for every one of the 41 the id's card-segment count equals its
stored piece count, so the `--<n>` is demonstrably not a card.

**Only one code path writes this table.** `insertCombos` is the sole `INSERT`,
its only non-test caller is `ingestSpellbook`, and that call is reached only
after `variantSkipReason(variant)` has returned null.

**And that is where the premise had a hole**, which is the part worth recording.
`variantSkipReason` refused a template variant on `requires[]` alone. So "the
ingest cannot write a `--` id" rested on a promise about the FEED: that
Spellbook never publishes a `--` id with `requires[]` absent or empty. Nothing
in this repository can hold Spellbook to that, and the cost of it breaking is
not cosmetic — the prune runs after the writes, so such a row would be written
and deleted again on every single run, losing a real combo silently and forever.

So the hole is closed in code rather than argued away: **`variantSkipReason` now
reads the id as well.** The population the ingest refuses and the population the
prune removes are now the same set by construction, whatever the feed does. It
is also the better answer on its own merits — an id that names a template beside
a body that does not is a variant we cannot represent either way, and ADR-0038
already ruled that such a variant is skipped rather than stored short, because
that is the one of the two that is wrong in the safe direction.

**It cannot truncate.** The prune reads no feed and counts no variants, so a run
that downloaded one variant removes exactly the rows a complete run would. That
is the property the refused sweep could not offer, and it is why this is not the
sweep wearing a different hat.

**Where it lives.** In the ingest, after `deleteCombos`, for the same reason
ADR-0038 put the first prune there: a cleanup that lives only in a command
someone ran once comes back the next time a database is rebuilt from an old
dump. `ComboIngestReport` gains `removedTemplateVariants`, counted apart from
`removed` because the pair tells the operator which mechanism did the work, and
`ingest combos` prints it only when it moved — a permanent `pruned 0` after the
first run would be noise rather than the signal `removed` is.

**The guard.** `packages/clients/src/spellbook.test.ts` has a
`describe('the invariant the \`--\` prune depends on')` block whose three cases
fail the moment `variantSkipReason` stops refusing `template-piece`, on
`requires[]` or on the id. Its comment names the prune and says plainly that if
those fail, the prune is unsafe and must be changed in the same commit rather
than the test being "fixed". This is deliberate: a future change that starts
storing template variants — which ADR-0038 wants, under "template pieces should
be MODELLED, not dropped" — must not silently delete them on the next ingest.

## Measured

Verified on an **isolated clone** of the shared database holding one deck's 101
cards, the 13,707 combos overlapping them, and the deck itself. Nothing
destructive was run against the shared corpus; it still holds all 41 rows.

| | before | after |
| --- | ---: | ---: |
| clone combos | 13,707 | **13,673** |
| clone rows carrying `--` | 34 | **0** |
| Kess deck "Combos assembled" | **12** | **7** |

The five that went are Veinwitch Coven + Phyrexian Altar + (Vindictive Vampire /
Blood Artist / Vein Ripper / South Wind Avatar / Falkenrath Noble), every one
claiming `infinite-creatures, infinite-lifeloss`. The Forsaken Miner + Phyrexian
Altar combos in the same list SURVIVE, which is the guard on over-deleting: they
are genuine three-card combos with ordinary ids.

Across the shared corpus the prune would remove **41 of 104,616** rows.

## Consequences

- **`apps/web/src/api.ts`** gains `BracketFinding` and `BracketBarometers`, and
  `BracketReport.barometers`. Optional, additive — not a contract change (R2).
- **`packages/domain`** changes one message and nothing else. No exported type
  moved.
- **`packages/clients`** — `variantSkipReason` returns `template-piece` for one
  more input shape. No new union member, and its one consumer already handles
  the reason.
- **`packages/db`** gains `pruneTemplateVariantCombos`, its second `DELETE` on
  `combos`.
- **The combo count DROPS by 41 on the next combo ingest**, and by 0 on every
  run after that. `ingest combos` prints `pruned 41 rows for template variants
  no longer in the feed`. This is the intended effect and is not an ingest
  failure.
- **Neither ingest was run as part of this change**, and nothing destructive was
  run against the shared database. The commands are in the PR for the operator.

## Found, and deliberately not done

- **`BracketFinding.combos` is carried on the wire and not drawn.** A Spellbook
  variant id (`1039-4702`) is not something a builder can read, and the combo
  count is already in `message`. `cards` is the openable half and it holds the
  pieces of exactly those combos. Naming them would need the combo list's own
  renderer, which is a different panel.
- **A deck with no findings still shows the four rule rows and the basis, and
  nothing that says "0".** `bracketFindings` omits a barometer with nothing to
  report, deliberately — "this deck has 0 extra-turn cards" is a sentence nobody
  needs — so the client cannot distinguish "counted zero" from "not counted"
  per barometer, only for the block as a whole. That is the right trade at this
  size and it is worth knowing it was a trade.
- **Template pieces are still DROPPED rather than MODELLED.** ADR-0038's
  preferred fix — carry the template count on `Combo` so these read "one piece
  away, and the piece is a card class" — still needs a column, a migration and
  an ingest write. When it happens, the guard block in
  `spellbook.test.ts` is the thing that will fail, which is what it is for.
- **The mutation harness earned its keep twice.** Once on the CRLF working tree,
  where a multi-line needle typed with `\n` matches nothing and a harness that
  does not check would report "the test caught it" about a run in which nothing
  was mutated; and once on a real sleeping test — the first Escape test for a
  finding's card list passed with `stopPropagation` deleted, because the Game
  Changers list was closed in that fixture and the panel's own handler returned
  early either way. The property only becomes observable with two lists open at
  once, and the test now opens two.
