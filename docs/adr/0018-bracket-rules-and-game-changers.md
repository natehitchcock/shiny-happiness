# ADR-0018: Bracket rules — fetched what exists, null for what does not

- **Status:** Accepted
- **Date:** 2026-08-30
- **Supersedes:** the `DATA-05` section of [ADR-0006](0006-data-source-terms-verification.md)

## Context

`DATA-05` was the last open question in ADR-0006. Three things were wanted:

1. the current bracket definitions and their exact allowances,
2. the current Game Changers list, verbatim,
3. whether a machine-readable canonical source exists.

`packages/domain/src/brackets/rules.data.json` shipped empty, `loadBracketRules`
reported it as unloaded, and every deck's analysis returned
`"bracket": {"target": 3, "assessed": null, "violations": []}` with an
`unavailable` entry. The Bracket selector on the landing page did nothing that
could be checked.

Both halves were answered on 2026-08-30 by reading Wizards' own pages. The
answers are asymmetric, and that asymmetry is the substance of this decision.

## What the source says

**Retrieved 2026-08-30 from <https://magic.wizards.com/en/formats/commander>:**

> Bracket 1 and 2 decks exclude Game Changers. Bracket 3 allows for up to three
> Game Changers. Brackets 4 and 5 allow for unlimited Game Changers.

> There are five Commander Brackets. Each one is meant to classify a different
> kind of game experience. Brackets 1, 2, and 3 are different levels of socially
> focused play. Brackets 4 and 5 are focused on a higher power or even a
> competitive experience.

> Each bracket has an intent and philosophy behind it, which is the most
> important part. There is also a list of what is expected at that level in a few
> barometers: two-card infinite combos, extra turns, mass land denial.

That last sentence names the barometers but the page **publishes no per-bracket
value for any of them.** Each bracket's entry is a prose "Players expect:" list
plus a turn-count expectation — Bracket 1 "at least nine turns before you win or
lose", 2 "eight", 3 "six", 4 "four", and Bracket 5 "These games could end on any
turn." None of those states permitted, discouraged or forbidden.

**Retrieved 2026-08-30 from the [Commander Brackets Beta Update of 2025-10-21](https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-october-21-2025):**

> So, after much discussion, the avenue we'd like to take is to remove the tutor
> restrictions from Commander Brackets entirely and rely on Game Changers to
> catch the most efficient tutors.

> Our hope is this also makes things a lot clearer in terms of big game-ending
> cards and combos, explaining where they should show up. For example, instead of
> wondering what "no early-game combos" means, saying "you don't expect to win or
> lose before turn six" gives you a pretty clear indicator of what kind of combos
> could be allowed: not ones that tend to happen in the first six turns.

So the tutor barometer was **withdrawn**, and the other three were **replaced**
by the turn-count framing. The [update of 2026-02-09](https://magic.wizards.com/en/news/announcements/commander-brackets-beta-update-february-9-2026)
made no bracket-level changes ("we really want to cool it on bracket-level
changes for the time being") and added `Farewell` and `Biorhythm` to the Game
Changers list with an explicit exception for `Lutri, the Spellchaser`.

Earlier articles — the original beta announcement, the April 2025 update — do
carry a per-bracket permitted/forbidden table. **Those are superseded.** Copying
one would encode a ruleset the format has retired, which is the same failure as
writing it from memory and harder to spot, because it would have a citation.

## Decision

### 1. Populate the allowance that exists; leave the rest null

`gameChangersAllowed` is `0, 0, 3, unlimited, unlimited`, with `sourceUrl`,
`retrievedAt` and the quoted wording in the data file.

`massLandDenial`, `extraTurnChaining`, `twoCardInfinites` and `tutorDensity` stay
`null`, and `BracketRules` now types them as nullable. `null` means "the format
publishes no rule here", which is a different claim from `'allowed'`, and the
only one the source supports.

`loadBracketRules` therefore requires only `gameChangersAllowed`. Requiring all
five is what kept the file unloadable and the feature dark; it conflated "we have
not fetched this" with "there is nothing to fetch".

`analysis.bracket.assessed` stays `null`. Deciding which bracket a deck *is*
needs all five barometers; one out of five is not a verdict. What can be said —
this deck breaks the Game Changers allowance of the bracket you chose — is said,
with the counts and the offending cards attached, and the `unavailable` entry now
names precisely which part is missing instead of claiming the whole file is
unpopulated.

### 2. The Game Changers list comes from the corpus, not from a checked-in array

ADR-0006 question 3 asked whether a machine-readable canonical source exists.
It does, and the project already downloads it nightly: **Scryfall carries a
`game_changer` boolean on every card record.** It was already declared on
`ScryfallCard` and never mapped through.

Verified on 2026-08-30: Scryfall's `is:gamechanger` returns 53 cards, and the
Wizards page lists the same 53. The only difference is spelling — Scryfall names
the double-faced card `Tergrid, God of Fright // Tergrid's Lantern` where Wizards
writes `Tergrid, God of Fright` — which is exactly the kind of mismatch a
name-matched array would have to solve and a flag on the record does not.

So the list is mapped to `Card.gameChanger`, stored by migration `0011`, and read
back as the `gameChangers` set that `loadBracketRules` takes as an argument. The
`gameChangers` array is gone from `rules.data.json`.

The list is revised often enough for this to matter: ten cards came off it in
October 2025 and two went on in February 2026. A hand-maintained copy would be
wrong within months with nothing failing to say so.

### 3. An empty Game Changers set is a load error, not an empty deck check

Migration `0011` defaults 34k existing rows to `false`, so between the migration
and the next ingest the corpus reports no Game Changers at all. An empty set
satisfies every allowance vacuously: a deck of nothing but Game Changers would
pass Bracket 1 and the app would say so confidently.

`loadBracketRules` returns a distinct `game-changers-empty` error instead, and
the API reports bracket checks as unavailable. Its own error kind because the fix
differs — "run the ingest", not "fetch the rules".

## Consequences

- **A re-ingest is required.** Until `ingest:cards` runs against migration
  `0011`, `game_changer` is `false` for every row and bracket checks report
  themselves unavailable. That is the designed behaviour, not a regression.
- `is:gamechanger` in the candidate query now answers. It was refused outright
  before, because answering `-is:gamechanger` from an empty flag list returns
  every Game Changer as though it were clean.
- Recommendation scoring's `bracketRisk` weight reads `bracketFlags.length`,
  which was always empty. This is the first release in which that weight does
  anything, so candidate ordering changes.
- **Contract change (AGENTS.md R2).** `Card` gains a required `gameChanger`;
  `BracketRules`' four barometers become nullable; `loadBracketRules` takes a
  second argument; `RawBracketData` loses `gameChangers`;
  `analysis.bracket` gains `gameChangers` and `rules`.
- ADR-0006 stays open only for Scryfall question 4 (image serving, gating
  `ING-04`). `DATA-05` is closed by this ADR.

## Alternatives considered

- **Copying the per-bracket table from the original beta announcement.** It is
  fetchable and quotable, which makes it look like it satisfies ADR-0006. It is
  also retired: it still restricts tutors, which the format explicitly stopped
  doing. Rejected — a citation to a superseded page is worse than a null, because
  it survives review.
- **Deriving the missing barometers from the turn-count expectations.** "You
  should expect to play at least six turns" plainly implies something about
  two-card combos, but turning it into `twoCardInfinites: 'forbidden'` is our
  inference, not Wizards' rule, and the product would present it as the latter.
  If the project wants to model turn counts, that is a design task with its own
  data field — not a translation done quietly inside a loader.
- **Assessing a bracket from the Game Changers count alone.** A deck with no
  Game Changers is not thereby a Bracket 1 deck, so the lowest satisfying bracket
  is not an assessment. Rejected as a verdict dressed up from one dimension.
- **Keeping the Game Changers list in the data file, fetched from Wizards.** It
  would have to be matched to cards by name, across double-faced spellings, and
  re-fetched by hand on every revision. The corpus flag is the same list with a
  maintenance cost of zero.
