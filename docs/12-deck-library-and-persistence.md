# 12. Deck library, switching, and persistence

A person does not build one deck. They build a Krenko deck, get stuck, and go
poke at their Atraxa deck for twenty minutes. Switching has to be as cheap as
scrolling, and nothing may ever be lost in the process.

## 12.1 Principles

- **There is no save button.** Every mutation persists immediately. A save button
  is a promise that work can be lost.
- **Switching is always safe.** Because there is no unsaved state, switching decks
  never prompts, never warns, never blocks. Any dialog asking "save changes before
  switching?" is a bug in this design.
- **Local-first.** Mutations apply to local state and render immediately; sync
  happens behind them. The app is fully usable on a bad network (doc 08 §8.5).
- **Return where you left.** A deck reopens at the zoom level, scroll position,
  group collapse state and sheet detent it was left at.

## 12.2 Deck states

```ts
interface Deck {
  // ...as doc 02 §2.2
  version: number            // monotonic; incremented server-side per accepted command batch
  status: 'active' | 'archived'
  archetype: ArchetypeKey        // doc 14
  lastOpenedAt: string
  workspace: WorkspaceState  // per-deck UI state, see §12.6
}

interface DeckSummary {       // the list projection; never loads entries
  id: DeckId
  name: string
  commanders: OracleId[]
  commanderArt: string        // resolved printing art crop
  colorIdentity: Color[]
  targetBracket: Bracket
  archetype: ArchetypeKey
  cardCount: number           // accepted, incl. commander
  deckCombos: number
  status: 'active' | 'archived'
  updatedAt: string
  lastOpenedAt: string
}
```

`archived` is not `deleted`: archived decks leave the switcher and the default
library view but are fully recoverable. Deletion is separate, confirmed, and
30-day soft-deleted before it is real.

## 12.3 The deck switcher

The fastest path, available from every screen. The commander chip in the command
bar **is** the switcher control.

```
┌─────────────────────────────────────────┐
│ [art] Krenko, Mob Boss  ▾   ← tap here  │
└─────────────────────────────────────────┘
        │
        ▼
┌─────────────────────────────────────────┐
│  Switch deck                    [+ New] │
│ ┌─────────────────────────────────────┐ │
│ │ ● [art] Krenko, Mob Boss            │ │  ● = current
│ │        B3 · 64/100 · 14 combos      │ │
│ │ ○ [art] Atraxa, Grand Unifier       │ │
│ │        B4 · 100/100 · 6 combos      │ │
│ │ ○ [art] Sidar + Tymna               │ │
│ │        B5 · 98/100 · 22 combos      │ │
│ └─────────────────────────────────────┘ │
│  All decks (12) →                       │
└─────────────────────────────────────────┘
```

- Lists the 5 most recently opened active decks, current one marked and first.
- Each row: commander art, name, bracket, completion, combo count — enough to
  identify a deck without opening it.
- `All decks` opens the library (§12.4). `+ New` starts the creation flow (§12.5).
- Keyboard: `Ctrl/⌘ + K` opens it with a filter field; type to fuzzy-match, `Enter`
  to switch. `Ctrl/⌘ + 1…9` jumps straight to the nth recent deck.
- Mobile: the same control opens as a bottom sheet rather than a popover, with
  rows at full touch-target height.

**Switch performance budget: < 300 ms to interactive.** Prefetch the summary list
on load and the full deck for the top two recents on idle. A switcher that stalls
gets used once.

## 12.4 The library

Full management view. Grid of deck cards on wide viewports, single-column list on
narrow.

Each card: commander art as the background, name, bracket chip, completion ring
(`64/100`), colour identity pips, combo count, relative last-edited time.

- **Sort**: last opened (default), last edited, name, completion.
- **Filter**: colour identity, bracket, status (active / archived / all),
  completion (complete / in progress).
- **Search** by deck name or commander name.
- **Per-deck actions**: Open, Duplicate, Rename, Change bracket, Archive, Export,
  Delete.
- **Bulk select** for archive, export and delete.

`Delete` offers the deck's export first — *"copy it out, then get rid of it"* is
one workflow, not two errands (doc 15 §15.5). `Import` and `Export` sit in the
same per-deck menu; bulk-select exports many at once.

`Duplicate` is a first-class action, not a nicety: it is how a person tries a
variant without risking the original, and it is the honest alternative to a
branching model we are not going to build. A duplicate copies entries, origins,
exclusions and locks — everything, so the copy behaves identically — and names
itself `<name> (copy)`.

Empty state is a real screen, not a shrug: it explains what the app does and
drops the user straight into the commander picker.

## 12.5 Creating a deck

Four steps, no wizard chrome, abandonable at any point.

1. **Pick a commander**, or **paste a decklist**. Search by name, filtered to
   cards legal as a commander; results show art, colour identity and popularity.
   Partner/Background pairings are offered inline when the chosen card supports
   one (doc 03 §3.1) — never as a separate step, because most decks do not need
   it. The *"or paste a decklist"* path detects the commander from the list and
   rejoins at step 2 (doc 15 §15.1).
2. **Pick an archetype.** The nine archetypes (doc 14), with the statistically
   likely one for this commander preselected and its reason shown — *"Tokens —
   54% of Krenko decks build this way"*. This is what sets the composition
   targets, so it is asked before the bracket.
3. **Pick a target bracket.** The five brackets with one-line descriptions
   (doc 03 §3.2). Defaults to 2. Changeable at any time afterwards, and the UI
   says so, so this choice carries no weight.
4. **Offer the core package.** "Add the 24 Bracket 2 core cards for these colours?"
   — with a preview and a per-card opt-out. Declining is one tap and gives an
   empty deck.

Then straight into the workspace. Deck name defaults to the commander's name and
is inline-editable in the command bar.

## 12.6 Workspace state

Per-deck UI state, persisted with the deck so §12.1's "return where you left"
holds across devices:

```ts
interface WorkspaceState {
  zoomLevel: 0 | 1 | 2 | 3
  dividerPosition: number            // desktop, 0..1
  sheetDetent: 'peek' | 'half' | 'full'   // mobile
  acceptedGroupBy: 'role' | 'manaValue' | 'color' | 'type' | 'origin'
  collapsedGroups: string[]
  candidateQuery: string             // raw query text; see doc 13
  savedQueries: Array<{ name: string, query: string }>
  scoringWeights: Partial<ScoringWeights>
}
```

Debounce workspace-state writes (~2 s); it changes constantly and does not warrant
a request per scroll. It is also the one thing that may be lost on a crash without
harm, so it never blocks a deck mutation.

## 12.7 Sync and conflict

Deck state is authoritative on the server; the client holds a replica plus a queue
of unsynced commands (doc 10 §10.3).

**Normal path.** Command applies locally → renders → enqueues → POSTs with the
client's `version` → server applies, increments `version`, returns the new deck →
client reconciles.

**Conflict** (`version` mismatch — the same deck was edited on another device):
the server rejects with `409` and returns its current deck plus the commands it
has accepted since the client's version. The client **replays its queued commands
against the new state** and re-sends. Deck commands are almost all commutative
(accepting Sol Ring and accepting Lightning Bolt do not interact), so replay
resolves silently in the overwhelming majority of cases.

The history comes from `deck_command_log`, keyed by the version each batch took
the deck to (ADR-0018). Two things follow that the client must honour:

- **`sinceComplete: false` means refetch, not replay.** The log may not reach
  back to the client's version — a deck edited before the log existed, or a gap
  longer than the server will ship in one response. An empty `since` and an
  unanswerable one are indistinguishable without this flag, and rebasing against
  a partial history drops work the user did.
- **Rebasing drops only what is already true.** `rebaseCommands` in
  `packages/domain` removes a queued command whose intent the log shows already
  achieved — excluding an already-excluded card, restoring one that is no longer
  excluded — and replays everything else. That is not discarding a user action;
  the state they asked for exists, and re-sending would earn a rejection that
  reads as "your click failed" for a click that succeeded elsewhere. An `accept`
  is never dropped: a deck legitimately holds 34 Mountains and the rebase has no
  card data with which to tell a basic from a singleton.

Genuinely conflicting commands — the same card accepted on one device and excluded
on another — resolve to the **more recent user intent by wall-clock timestamp**,
and the losing command is surfaced in the undo history as *"Not applied: excluded
Sol Ring (changed on another device)"*. Never silently discard a user action;
never pop a modal about it either.

`sinceBatches[].appliedAt` is the foreign half of that comparison; `since` alone
is a bare command list and carries no clock. **A live client never needs it** —
every batch it is told about is already committed when its own request goes out,
so its own intent is always the newer one. An offline queue does: a command
typed at 09:00 and drained at 17:00 is *not* more recent than a foreign one from
12:00. `rebaseCommands` therefore reports conflicts as `overrides` and replays
them, rather than deciding them; the timestamp comparison and the undo-history
entry above are `WEB-15`'s, which is where the queue and its clock live.

**Offline.** The queue persists in IndexedDB and drains on reconnect. The deck is
fully editable offline; only new recommendations need the network, and their
absence is stated inline (doc 08 §8.5). A queued-command count appears in the
command bar when non-zero.

## 12.8 Snapshots

Named, restorable points in a deck's history. Cheap to implement on top of the
command log — which now exists, as `deck_command_log` (ADR-0018) — and worth
having:

- **Automatic** before any bulk operation — applying or removing a core package,
  changing bracket, importing into an existing deck. Labelled with the operation.
- **Manual**, named, from the library or the deck menu.
- Restoring creates a *new* snapshot of the current state first, so restore is
  itself undoable.
- Retain the last 20 automatic and all manual snapshots.

This is what makes bracket experimentation safe, and it is the durable version of
pillar P6: a person can try Bracket 4, dislike it, and get their Bracket 2 deck
back exactly.

## 12.9 Storage

| Where | What | Why |
| --- | --- | --- |
| Postgres | Decks, entries, snapshots, workspace state, the command log | Source of truth |
| IndexedDB | Active deck replica, command queue, recent summaries, card data for the deck's colour identity | Offline and instant switching |
| Redis | Recommendation results keyed by `(deckId, version, snapshotId, filters)` | The expensive computation, invalidated by `version` |

Recommendation cache keys include the deck `version`, so a deck mutation
invalidates them for free and no stale candidate list can ever be served.
