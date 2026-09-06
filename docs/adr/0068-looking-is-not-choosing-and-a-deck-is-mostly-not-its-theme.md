# ADR-0068 — Looking is not choosing, and a deck is mostly not its theme

**Status:** accepted, amended
**Date:** 2026-09-05
**Amended:** 2026-09-05 — §11, two corrections to §3.6 and §6, made the same day
after seeing them on the screen
**Relates to:** [ADR-0067](0067-a-name-is-the-wrong-question-for-someone-who-has-not-chosen.md)
(the two routes this amends — its thresholds and its sample size are superseded
here, its `has` refusal is reused unchanged),
[ADR-0048](0048-membership-is-a-third-direction.md) (membership, excluded from
the carry-over for ADR-0067's reason, and its rule about deriving rather than
storing),
[ADR-0057](0057-a-want-says-which-event-a-qualifier-says-which-cards.md) (why a
focus may not outlive the card it was a claim about),
[ADR-0026](0026-a-focus-guarantees-its-top-three-in-every-category.md) (what a focus does,
which is why one may be pre-selected without hiding anything),
[ADR-0021](0021-card-art-from-scryfalls-cdn.md) (one image request for one card,
which is what makes a preview affordable on a list that draws no art), and
[ADR-0027](0027-the-back-face-rides-beside-the-front.md) (the MDFC flip the reused pane
brings with it).
**Changes:** `Preview` gains one optional prop and five of its existing props
become optional; `Start` gains a detail pane, a picks region, an expander and a
focus carry-over; `SEMANTIC_OFFER_THRESHOLDS` moves from 20/150 to 10/70 and
`SEMANTIC_OFFER_SAMPLE` from 8 to 3 — **and then back to 8, and the preview
trigger from an action button to the card's own name: see §11, an amendment made
the same day.** `CardRow` gains one optional prop and loses its `Preview`
action. **No wire shape changes and no new endpoint** — `GET /cards/{oracleId}`
and `GET /commanders/semantics` already serve everything four of these five
changes need.

---

## 1. The defect

Four complaints about one screen, in one sitting. They are recorded together
because they are the same screen and the same reader, and because three of them
turn out to be the same mistake.

**1a. You cannot look at a card before committing to it.** Every one of the three
doors — the name search, Route 1's carriers, Route 2's hand — draws a row with a
`Choose` on it and nothing else. "Krenko" is four different legends and "Kenrith"
is two. The only way to find out what a legend does was to build a deck around it
and read the commander panel afterwards.

**1b. Eight semantics is a wall, and the other forty were unreachable.** Route 1
opened with eight chips in front of somebody who has not chosen anything yet and
is being asked the vaguest question on the page. The redraw dealt eight more; the
remaining set could be reached only by pressing it repeatedly and hoping.

**1c. A redraw looked like it unselected your picks.** In the user's words: *"when
I select semantics, move them to a separate region so that showing eight others
don't unselect the ones I've chosen so far"*. The redraw replaced the sample
wholesale, so a chosen tag that was not in the new sample simply left the screen.
The state survived. Nothing on screen said so.

**1d. The focus prompt asked a question that had just been answered.** A reader
who came through Route 1 chose their semantics, chose a commander who carries
them, and was then shown "What is this deck about?" with nothing selected.

And underneath 1b and 1d, found while measuring them: **the thresholds were
measuring the wrong thing.** More in §5.

## 2. Decision

Five changes, one screen.

1. **A detail pane on the start screen**, and it is the workspace's `Preview`
   rather than a second one. A side column where there is room, the workspace's
   own bottom sheet where there is not, and it carries the `Choose`.
2. **Route 1 offers three**, not eight, with the redraw unchanged.
3. **An expander reveals all 66**, ranked by how many commanders carry each tag.
4. **Chosen semantics get a region of their own**, and a tag is drawn in exactly
   one place.
5. **The picks the commander agrees with become the deck's first focus**, carried
   on the create call.

## 3. Reusing the pane, and what it may not say here

### 3.1 One pane, not two

`Preview` already handles the art, the mana cost, the semantics chips, impact and
efficiency, the MDFC flip (ADR-0027), the card-name links in oracle text and the
bounded back trail. A second implementation of that would have drifted from it
inside a week — this codebase has the receipt for that failure mode in `Works`,
which exists precisely because two surfaces started disagreeing about one number.

It was reusable. Five props had to be **widened**, and every one of the five
turned out to be documenting a state the component already had a name for.

### 3.2 The placement, and why not an overlay

**A side column when there is room, the sheet when there is not.** The reason is
that the point of previewing on this screen is **comparing**: the eight search
results, the carriers of a semantic, the three dealt cards. A centred overlay
covers the very hand it is helping you choose from. The sheet already leaves the
list above it live and tappable — that is stated in `styles.css` as the reason it
has no scrim — so the narrow case needed no new argument.

The breakpoint is `useSingleColumn()`, the workspace's own hook and its own
`SINGLE_COLUMN` query. A second breakpoint was rejected on the grounds the
existing one gives: a viewport where only one of the two believes it is narrow is
worse than either answer.

### 3.3 What the pane does NOT offer here

Three absences, and each is a state the component already had rather than a
special case invented for this screen.

**No emphasise control.** There is no deck to focus — the focus picker on this
screen appears only *after* a commander is chosen. `Semantics` and `TagChip`
already treat an absent `onToggleEmphasis` as "no deck to focus" and render the
chip as a label. A no-op toggle was rejected outright: it draws a control that
does nothing.

**No deck-relative panel.** `Works` — "Works with your deck", "Combos with",
"Synergises with" — is omitted, and this is the one place where the plan going in
was wrong. The expectation was that empty `accepted` and `lockedIds` sets would
make the panel find nothing and fall silent. **They do not.** Read the loop: a
combo's other pieces are filtered to those *not* in `accepted`, and a combo with
exactly one missing piece is the "one card away" branch. A two-card combo has
exactly one other piece. An empty deck therefore makes *every* two-card combo one
card away, and a reader looking at a commander before starting anything would
have been shown

> **Works with your deck**
> No combo assembled yet — these need one more card, shown in rust:

before they had a deck at all. So the deck-relative props are absent rather than
empty, and absence is what omits the panel. An empty deck is not a quiet deck; it
is a deck everything is one card away from.

**No `cards` map.** The plan said to pass the on-screen candidates "so a card-name
link in oracle text resolves when it happens to be one of them". That is not what
`cards` does. Inside `Preview` it is read by exactly one thing — `Works` — and
oracle-text links resolve entirely through `detail.references`, which the server
sends. With `Works` gone, `cards` would have had no reader, so it is not passed.
The links work regardless, which is the property that mattered.

### 3.4 The pane carries the Choose

Previewing a commander and then having to close the pane and find the row again
is the flow this feature exists to remove. `onChoose` is a new optional prop; the
workspace does not pass it, because there the Add/Reject decision belongs to the
row in the feed that is still visible behind the panel.

**The pane does not decide whether the card may be taken.** It is handed a
callback or it is not, and the *screen* decides — because a card reached by
following "Search your library for a card named Sol Ring" is not a commander, and
offering to build a deck around it would earn a 422 from the server's own
`is:commander` rule. `Start` passes `onChoose` only when the shown card is one it
put in the pane from one of the three lists.

### 3.5 The list that still draws no art

ADR-0021's reasoning about the search results — eight art crops would be eight
image requests to distinguish candidates the reader has already distinguished by
name — **still holds and is not violated.** A row gained a button, not a picture.
Art is fetched when a card is actually opened, so the cost is one image for the
card someone asked about instead of eight for cards nobody has. The comment above
the results now says so, because the next reader would otherwise reasonably
assume the rule had been forgotten.

### 3.6 Accessibility

> **Superseded in part by §11.1.** The label below is unchanged; the thing
> carrying it is the card's name, not an action button.

- The trigger is `CardRow`'s own action button, and `CardRow` builds
  `${label} ${card.name}` — so labelling the action `Preview` produces
  `Preview Krenko, Mob Boss`, which is character-for-character the label the
  workspace already uses in four places. One test helper reaches both screens.
- Escape closes the pane (already in `Preview`, bound at every width) and focus
  returns to the trigger, guarded on `isConnected` because a redeal or a new
  search can unmount the row under an open pane.
- Opening, and swapping from one card to another, is announced through an
  always-mounted live region. A sighted reader watches the pane change; without
  this a screen-reader user is told nothing happened.
- `Choose` is first among the header controls: it is the only one of the three
  that is *why* the pane was opened, so a keyboard reader meets the decision
  before the two ways out of it.
- Choosing from the pane unmounts all three lists, so there is no opener left to
  return focus to. Focus goes to "Start building", which is where that reader is
  going next.

## 4. The pane's refs are not workspace-only

`backRef` and `closeRef` carried a docblock saying they were "owned by the
WORKSPACE and only attached here". The docblock's *reason* is right and its
*scope* was wrong: the panel unmounts while an in-panel navigation fetches a card
the host does not hold, so a ref living inside it would be torn down across the
gap that focus has to be restored over. That is a fact about the pane, not about
the workspace. The start screen's pane unmounts across the same gap for the same
reason, so it owns its own pair. Neither screen borrows the other's, and the
docblock now says HOST SCREEN.

## 5. The thresholds were measuring the wrong thing

ADR-0067 admitted a tag to Route 1 when at least **20** commanders carried it and
at least **150** cards supported it. That is now **10** and **70**, and the
qualifying set goes from 48 tags to **66**.

The old numbers were not carelessly chosen — ADR-0067 measured a plateau for them
and the arithmetic was sound. What was wrong was the question. In the user's
words: *"there are staples and lands that can fill out decks too"*.

A supporting-card floor asks **how many cards are ABOUT this theme**. What decides
whether a deck can be built is whether it can be **filled**, and most of a
Commander deck is ramp, removal, card draw and thirty-odd lands whatever it is
about. An Angel deck is fourteen Angels plus staples. The 150 floor excluded it
for having too few Angels.

### 5.1 The new plateau

Measured against the live corpus. It is a plateau and not a cliff, which is the
evidence the point is not fitted to a number somebody liked:

```
 8 / 60 → 69      10 / 70 → 66   ← chosen
10 / 60 → 68      10 / 75 → 65
10 / 65 → 67      10 / 80 → 62
                  12 / 70 → 64
                  15 / 70 → 56
```

The category split moves from 24 mechanics / 11 keyword / 13 type to **26
mechanics / 13 keyword / 27 type**. The offer becomes markedly more tribal, and
that is the point rather than a side effect.

### 5.2 The 18 tags this admits

Almost entirely tribal, which is the evidence the old floor was measuring the
wrong thing rather than merely being strict:

vampire (24 commanders / 125 supporting), ally (20/115), bird (19/98), wizard
(17/98), angel (14/76), dinosaur (14/84), knight (14/100), phyrexian (14/85),
merfolk (12/77), saproling (12/92), wolf (11/77), hero (35/72), plus
creature-cast (27/100), land-creature (19/192), protection (16/148), forest
(13/194), arcane (12/90) and reach (11/108).

### 5.3 What is superseded, and what is not

ADR-0067's 20/150 and its 49/48/47/42 plateau at 15/20/25/30 are **superseded,
not deleted**. The reasoning was sound given what it was asking, and a reader who
finds that ADR should be able to see both the old measurement and why it was
replaced. Its `has` refusal is untouched and is reused twice more here.

### 5.4 Two admissions worth a reader's scepticism

Noted rather than fixed, because a curated exclusion list is a different decision
from a threshold and is not one to make inside this change:

- `subtype:hero` (35/72) is almost certainly noise — Theros hero's-path cards,
  not a deck theme anyone builds.
- `subtype:forest` (13/194) and `subtype:arcane` (12/90) are real but odd answers
  to "what is this deck about".

## 6. Three offered, sixty-six reachable

> **Superseded by §11.2: the sample is 8.** Three was chosen against a 48-tag
> qualifying set and did not survive §5 growing that set to 66. Everything else
> in this section — the expander, the real count, the free redraw — still
> stands.

The sample drops from eight to three. Three is a prompt; eight is a wall of
vocabulary in front of somebody who has not chosen anything yet.

Narrowing the sample is only defensible because the rest became reachable, so it
did not ship alone. **"See all 66"** reveals the whole qualifying set, ranked by
how many commanders carry each tag, with the words on the chip breaking ties so
the order is one a reader can see the reason for.

It costs **no new query and no contract change**. `GET /commanders/semantics`
already serves the whole set in a stable order — that is what makes a redraw free
— and every entry already carries its `commanders` count. Ranking by commanders
rather than by supporting cards is the question this screen asks: *what could I
lead*.

**The label carries the real number.** The request was for "the top 60". There is
no 60: 66 tags clear the thresholds and reaching 60 exactly would mean fitting a
threshold to a round number. The count is read from the census the server sent,
so the button cannot promise a number that differs from what pressing it reveals.

## 7. A chosen semantic keeps a place of its own

Chosen semantics render in their own region, above the pool. A tag is drawn in
**exactly one** of the two places — filtered out of the pool while it is a pick —
because two controls for one tag, one pressed and one not, is a smaller version
of the confusion being fixed rather than a fix for it.

The codebase already had this lesson written down one screen over.
`EmphasisChoice` appends any selected tag that is not in the offered list, and
says why:

> Without this it would be chosen, pressed, and invisible — a focus with no
> control on screen, which is the trap the whole feature is built to avoid.

Route 1 had the identical trap and the redraw made it reachable in one click.

The region is **absent, not empty**, when nothing is chosen — the same rule
`SemanticOffer` and `OfferCategory` follow, that a heading over no chips is a
promise of something that is not there.

### 7.1 Focus must survive the move

Pressing a control that then renders somewhere else is the classic way to drop a
keyboard user onto `<body>`. The route keeps one ref per tag and puts focus back
on whichever element the tag is now drawn as, and the relocation is **announced**
— the state is already on `aria-pressed`, so what a screen-reader user is missing
is precisely the "it is still on screen, over here" that this change exists to
give.

### 7.2 Two live regions, not one

The route now has two. The chip-moved message is written at the click; the
carrier count arrives a round trip later. With one region the second overwrote
the first — always under test, and in a browser whenever the answer came back
quickly, which is exactly the case where the reassurance was most needed. They
are labelled so each is a distinct region rather than two anonymous ones.

## 8. The picks become the first focus

*"If you select semantics to start making a deck, automatically focus whichever
relevant ones are on the commander you've chosen."*

**Derived, not fetched.** A commander appears in Route 1's results *because* it
carries a picked tag, so the set to focus is
`picks ∩ (produces ∪ wants)` and both sides are already on the client. Widening
the endpoint to send per-card matched tags would be storing what can be derived,
which is ADR-0048's rule, and this is the easy case.

**`has` is excluded**, the same refusal ADR-0067 makes in `semanticMatchCount`
and for the same reason: Route 1 asks what a deck is ABOUT, and a commander
merely *being* an Elf is not a reason to make the deck about Elves. If the two
disagreed, the screen would contradict itself between the list a commander
appeared in and the focus it arrived with.

**Reversible by construction**, which `semantic-emphasis.ts` promises and a
pre-selected focus is exactly where that promise gets tested:

- The carried tags render selected in the existing picker with their normal
  toggles. Nothing is hidden, nothing is locked, and ADR-0026 is why that is
  safe: a focus reorders and guarantees places, and never filters.
- **One line says why they are on**, in the register of the copy around it. A
  chip that arrives pre-pressed with no explanation reads as a bug. The line is
  drawn from `carried ∩ emphasis`, so turning one off stops it being claimed
  rather than leaving a sentence naming a focus that is no longer on.
- An empty intersection draws **no line**. An absence needs no explaining.
- Choosing again — a different carrier, or going back and quickdrawing instead —
  **recomputes the set outright** rather than merging. A focus left over from a
  legend no longer being built is the claim about a card the reader is not
  looking at that ADR-0057 refuses.

It rides `createDeck`'s existing `semanticEmphasis` field, never a PATCH
afterwards. That field's own docblock gives the reason: a two-request create
leaves a window in which the deck exists with the wrong focus, and the first page
of suggestions is the one page a focus exists to shape.

## 9. What was rejected

**A second detail pane.** It would have drifted from `Preview` within a week, and
this codebase already has that failure written into `Works`.

**A centred overlay for the preview.** It covers the candidates it is helping you
compare, which is the whole purpose.

**Passing empty sets for the deck-relative props.** §3.3: it produces a false
claim rather than silence.

**A no-op `onToggleEmphasis`.** It draws a control that does nothing, which is
worse than no control.

**Restructuring the workspace's use of `Preview`.** Not needed — widening five
props and adding one covered every case, and the workspace's call site is
unchanged except that it now passes exactly what it always passed.

**Loosening the thresholds to reach a round 60.** The number would then be fitted
to the label rather than to the corpus.

**Ranking the expanded list by supporting cards.** The question is what you could
lead, not what you could fill.

**Curating `subtype:hero` out.** A real judgement, and a separate one. §5.4.

**Widening `/commanders/by-semantics` to return matched tags per card.** Derivable
from data in hand.

## 10. What this does not verify

Stated because the tests cannot say it and the ADR should not imply otherwise:
**jsdom performs no CSS layout**, so nothing here demonstrates that the side
column renders correctly at any particular width. What is tested is the half that
is not CSS — which of the two boxes the component is told it is, the dialog role
and focus move that follow from it, and every behaviour above. The column
placement itself has been reasoned about and written down; it has not been seen.

## 11. Amendment, the same day — two corrections

Two of the decisions above were wrong on the screen, and both were corrected in
the same sitting that made them. Recorded here rather than under a new number:
same screen, same sitting, and a reader who arrives at §3.6 or §6 has to be told
in the same document that they moved.

### 11.1 The preview trigger was a button, and should have been the name

**What was built.** Each of the three lists rendered `CardRow` with two actions
side by side — `Preview`, then `Choose` — and §3.6 reasoned about what the first
of them should be called.

**In the user's words:** "The preview pane should also be shown when I click the
entry option (not on the choose button), instead of showing a jenky preview
button."

**Why it was wrong, and this is the part worth keeping: the app had already
settled this, and the new screen did not use it.** The deck rail, the rejected
list and the name-match list all make the card's name the trigger — a
`.name.as-link` button, inside a `.name-cell` whose own click opens the same
pane, guarded with `closest('.hint')` so a click that landed on a nested control
cannot fire twice. Three call sites, one idiom, all of it older than this ADR.
§3.6 argued carefully about the label the new button should carry and never
asked whether the button should exist. The lesson is not "use the name": it is
that a new screen building rows out of an existing component owes itself one
look at what the existing rows do, because a second idiom for one interaction is
paid for by every reader after it.

**"Jenky" was also literal.** `kind: 'preview'` had no styling of its own. What
it had was a collision: the class it produced, `act preview`, matched the
`.preview` PANEL rules — a border, a background, a margin, and above 900px
`position: absolute; right: 100%; z-index: 25; width: 21rem`. So there was no
dead rule to delete when the action went. The collision left with it.

**What changed.**

- `CardRow` takes an optional `onPreview`. Given it, the name is a button inside
  a `.name-cell`; without it the row is the plain `.name` span it always was.
  All three call sites pass it, so nothing renders the old shape today — the
  prop is optional because a row with nothing to open is a legitimate row, not
  because a caller needed protecting.
- The `Preview` action is deleted from all three lists. `Choose` is the only
  button left on the row.
- The actions stay SIBLINGS of the name cell rather than becoming children of
  it. That is what keeps a press on `Choose` from also opening the pane.
  Rejected: `stopPropagation` on the action, which leaves the nesting wrong and
  hides it.
- The row is **not** a clickable `<div>`. The row-wide click is the precedent's
  two halves — the cell's handler, and an `::after` overlay stretched from the
  name button by the stylesheet — layered on top of a genuine button, which is
  what a keyboard and a screen reader actually meet.

§3.6's first bullet is superseded in one word only: the label is still
`Preview <name>`, character-for-character what the workspace says, so the test
helper still reaches both screens — but the thing carrying that label is the
card's name, not an action button.

### 11.2 Three offered was too few; the offer opens with eight

§6 dropped `SEMANTIC_OFFER_SAMPLE` from eight to three. **Three was right about
the set it was chosen against and did not survive that set changing.** 48 tags
qualified when three was asked for. §5, in the same sitting, moved the
thresholds to 10 commanders / 70 supporting cards and the qualifying set became
66 — and three of 66 is too narrow a window to see the vocabulary through: a
reader would have to work the redraw repeatedly to learn what this screen can
even be about. The sample is **8**.

Nothing else about Route 1 moves. The thresholds stay at 10/70, the set is still
66, and "See all 66", the redraw, the picks region and the focus carry-over are
untouched. Eight is what the screen OPENS with, not a limit on what it offers.

The lesson: a number chosen against a set is only as good as that set. Two
decisions in one sitting moved in opposite directions — one narrowed the window,
the other widened what stood behind it — and neither was re-read against the
other before it shipped.

### 11.3 What the amendment does not verify

§10's limit, and one more of the same kind. jsdom computes no boxes, so the
`::after` overlay that carries the row-wide click across the rest of the row is
**not testable here at all**. What is tested is the cell's own handler, that the
trigger is a focusable `<button>` carrying the card's name in all three lists,
that a click whose target is the row element reaches no handler, and that
`Choose` chooses without opening the pane. Whether a row with one button where
there were two LOOKS right has been reasoned about; it has not been seen.
