# 15. Import and export

The decks people already own live somewhere else. Getting a list in and getting a
list back out are the two moments where this app either fits into someone's
existing habits or doesn't.

Both directions are **user-initiated copy/paste or file transfer**. Nothing here
contacts a third-party deck site (doc 04 §4.4) — you copy from Moxfield, you paste
here; you copy from here, you paste into Moxfield. That is not a workaround, it is
the better design: it works for Archidekt, TappedOut, MTGO and a text file in your
notes app, all with one code path and no dependency on anyone's API staying up.

## 15.1 Entry points

**Import** is reachable from three places, because there are three different
moments a person wants it:

| From | Result |
| --- | --- |
| New-deck flow, step 1 — *"or paste a decklist"* | Detects the commander from the list and skips to the archetype step |
| Library → Import | Creates a new deck |
| Deck menu → Import | **Merges** into the open deck |

**Export** from two:

| From | Scope |
| --- | --- |
| Deck menu → Export | The open deck |
| Library → per-deck ··· → Export, or bulk-select → Export | One deck, or many as a zip |

## 15.2 Import formats

One parser, format-sniffed, no "choose your source" dropdown. Asking someone which
site their clipboard came from is asking them to do the computer's job.

```
1 Sol Ring                             plain
1x Sol Ring                            quantity suffix
1 Sol Ring (C21) 263                   set + collector number
1 Sol Ring *CMDR*                      commander marker
SORCERY (12)                           category header — informational, not a role
// Maybeboard                          section marker
Commander                              section header
1 Fire // Ice                          split card
1 Delina, Wild Mage                    accented / punctuated names
```

Accepted inputs: pasted text, an uploaded `.txt` / `.csv` / `.dec` / `.json`, and
our own JSON. MTGO `.dek` XML and MTGA export are handled by the same parser
behind format sniffing.

**Section markers are read, not trusted.** A `SORCERY (12)` header tells us
nothing our own type data doesn't already know, and a user's custom Moxfield
categories ("Ramp", "Wincons") are *their* taxonomy, not our `Role` union. Import
them as **user tags** preserved on the entry, never as role assignments — doc 02
§2.4's role pipeline stays in charge, and the user's categories survive a
round-trip.

## 15.3 The import preview — never apply blind

An import always previews before it commits. This is the whole design:

```
┌────────────────────────────────────────────────────────────────┐
│  Import decklist                                          ✕    │
├────────────────────────────────────────────────────────────────┤
│  ┌──────────────────────────┐  ┌────────────────────────────┐  │
│  │ 1 Krenko, Mob Boss *CMDR*│  │ Commander                  │  │
│  │ 1 Sol Ring               │  │  [art] Krenko, Mob Boss     │  │
│  │ 1 Skullclamp             │  │        detected from *CMDR* │  │
│  │ 1 Goblin Bombadier       │  │                            │  │
│  │ 34 Mountain              │  │  ✓ 96 cards resolved       │  │
│  │ ...                      │  │  ⚠ 2 lines need attention  │  │
│  │                          │  │  ⚠ 1 outside colour identity│ │
│  └──────────────────────────┘  │                            │  │
│                                 │  → Create a new deck       │  │
│  ⚠ Line 4  "Goblin Bombadier"  │    Merge into Krenko (64)   │  │
│     Did you mean Goblin Bombardment? · Goblin Bombardier? ·   │  │
│     [search…]                                    [skip line]  │  │
│  ⚠ Line 51 "Birds of Paradise" — green, not in Krenko's       │  │
│     identity.  [import and flag] [skip]                       │  │
├────────────────────────────────────────────────────────────────┤
│                                    [Cancel]  [Import 96 cards] │
└────────────────────────────────────────────────────────────────┘
```

Rules, each of which exists because the alternative loses data:

- **Unresolved lines never block the import.** Import what parsed, list what
  didn't, and fix it in place with a fuzzy-match picker. A single typo must not
  cost someone their whole paste.
- **Colour-identity violations are imported and flagged, not dropped.** They land
  in an *"Illegal for this commander (1)"* group in the Accepted region, one tap
  from removal. Silently dropping them (doc 04 §4.2, AGENTS.md §8) would give the
  user a 99-card deck and no idea why.
- **The commander is detected**, from a `*CMDR*` marker, a `Commander` section, or
  — failing both — by finding the one legal commander in the list and asking for
  confirmation. If several candidates exist, ask; never guess silently.
- **The button says what it will do**: `Import 96 cards`, not `OK`.

### Merging into an existing deck

Only offered when the imported list's commander matches the open deck's. Merging a
Krenko list into an Atraxa deck is not a meaningful operation, so the option is
replaced with *"Create as a new deck"* rather than being offered and then failing.

On merge: cards arrive as `origin: 'imported'`; singleton duplicates are skipped
and reported; **cards you previously excluded are not silently resurrected** —
they are listed as *"3 cards you'd removed are in this list — restore them?"*
(pillar P6). The whole merge is one undoable command batch (doc 10 §10.3).

## 15.4 Export formats

```
┌────────────────────────────────────┐
│  Export · Goblins, all the way down│
│  ○ Plain text            universal │
│  ● Moxfield / Archidekt  + commander marker, categories
│  ○ MTGO .dek                       │
│  ○ CSV                             │
│  ○ Roundtable JSON       lossless  │
│  ┌──────────────────────────────┐  │
│  │ 1 Krenko, Mob Boss *CMDR*    │  │
│  │ 1 Sol Ring                   │  │  ← live preview
│  │ 1 Arcane Signet              │  │
│  └──────────────────────────────┘  │
│  ⓘ Text keeps your 100 cards. It   │
│    does not keep exclusions, locks, │
│    archetype or snapshots — use    │
│    JSON for that.                   │
│         [Download]  [Copy to clipboard] │
└────────────────────────────────────┘
```

- **Copy is the primary action**, download secondary. The workflow is paste-into-
  another-site; making someone find a downloaded file first is friction for no gain.
- **Live preview** of the actual output, scrollable. You see what you are copying.
- **The lossiness notice is always visible for text formats**, not hidden behind a
  tooltip. Someone exporting before deleting a deck needs to know what the export
  does *not* carry.
- **Only `Roundtable JSON` round-trips losslessly**: entries, origins, exclusions,
  locks, user tags, archetype, bracket, budget, workspace state and snapshots.
  `exportJson → importJson` must produce an identical deck; this is a test
  (`API-04`), not an aspiration.

## 15.5 Export before delete

Deleting a deck offers its export first, because "copy it out, then get rid of it"
is a real workflow and the two halves should not be two separate errands.

```
┌──────────────────────────────────────────┐
│  Delete "Elfball (shelved)"?             │
│  91 cards · Bracket 3 · edited 2 months ago │
│                                          │
│  [Copy decklist first]                   │
│                                          │
│  Recoverable for 30 days, then permanent.│
│              [Cancel]  [Delete deck]     │
└──────────────────────────────────────────┘
```

`Copy decklist first` copies the plain-text list and marks itself done; it does not
close the dialog or cancel the delete. Delete remains a 30-day soft delete
(doc 12 §12.2) with the recovery window stated where the decision is made, not
buried in a settings page.

## 15.6 Implementation notes

- Parsing and formatting are **pure**, in `packages/domain/src/decklist/`
  (`DOM-07`) — `parseDecklist`, `formatDecklist(deck, format)`. No IO, so every
  format is unit-testable against fixtures.
- Fixtures include a real export from each supported source, plus the awkward
  cases: split cards, MDFCs, adventures, accented names, `//` comments, Windows
  line endings, a trailing sideboard, and a list with no commander marker at all.
- Name resolution is exact-match first, then normalised (case, punctuation,
  accents, `//` halves), then fuzzy above a confidence threshold — and below that
  threshold it asks rather than guessing. A confidently wrong card is worse than
  an unresolved line.
- Large pastes (a 1,000-line collection dump) parse in a worker so the UI does not
  jank, with a stated cap and a clear message past it.
