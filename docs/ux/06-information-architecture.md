# 6. Information architecture

## 6.1 The workspace

One screen. No wizard, no multi-page flow. Deck building is one continuous
activity and paginating it destroys the comparison that makes it work.

```
┌──────────────────────────────────────────────────────────────────────┐
│  COMMAND BAR                                                    (A)  │
│  [art] Krenko, Mob Boss        Bracket 3 ▾   64/100   zoom ▁▃▅█     │
│  lands 34/36 · ramp 8/11 · draw 6/9 · interaction 5/8 · GC 2/3  ⚠   │
├───────────────────────────────────┬──────────────────────────────────┤
│  ACCEPTED                    (B)  │  CANDIDATES                 (C)  │
│  ┌─────────────────────────────┐  │  ┌────────────────────────────┐  │
│  │ ▾ Core · Bracket 3     24   │  │  │ ▾ Completes 3+ combos   6  │  │
│  │   [card][card][card]...     │  │  │   [card][card][card]...    │  │
│  │ ▾ Lands                34   │  │  │ ▾ Completes 2 combos   14  │  │
│  │ ▾ Ramp                  8   │  │  │ ▾ One card away         9  │  │
│  │ ▾ Interaction           5   │  │  │ ▾ Fills gap: Ramp −3   22  │  │
│  │ ▾ Draw                  6   │  │  │ ▸ Top sorceries        10  │  │
│  │ ▾ Win conditions        4   │  │  │ ▸ High synergy         50  │  │
│  │ ▸ Removed from core     3   │  │  │ ▸ Staples             120  │  │
│  └─────────────────────────────┘  │  └────────────────────────────┘  │
└───────────────────────────────────┴──────────────────────────────────┘
                                    ▲
                            draggable divider
```

**(A) Command bar** — persistent, never scrolls away. Commander identity, target
bracket, card count, the composition meters, and the zoom control. The meters are
buttons: tapping `ramp 8/11` scrolls the Candidate region to the `Fills gap: Ramp`
group. This is the primary discovery path for the composition feature.

**(B) Accepted** — the deck. Grouped by role, with `Core` always first and
`Removed from core` always last and collapsed.

**(C) Candidates** — generated suggestions, grouped per doc 05 §5.3.

**Divider** — draggable, snapping to 30/50/70. Position persists per user. On
narrow viewports it is replaced by the mobile layout (doc 08), not by a squeezed
version of this one.

## 6.2 Groups

Every group in both regions is a **collapsible section with a count**, and both
regions are one shared scroll model with sticky group headers.

Group headers carry:
- Name and count
- For candidate groups, a one-line rationale ("These complete a combo with two
  cards already in your deck")
- A group-level action where one makes sense: `Accept top 3`, `Hide group`

Accepted-region grouping is **by role** by default, switchable to: mana value,
colour, type, or acquisition (core / manual / recommended). The grouping selector
is in the region header, not buried in settings — regrouping is a thinking tool
and people will use it constantly.

Candidate-region grouping is **fixed** to the doc 05 order. It is the product's
opinion. Users can collapse and hide groups, not reorder them.

## 6.3 Card states and their affordances

| State | Where it lives | Primary action | Secondary |
| --- | --- | --- | --- |
| Candidate | Region C | Accept | Exclude, Inspect, Lock-on-accept |
| Accepted (recommended/manual/imported) | Region B | Remove → excluded | Lock, Inspect, Swap |
| Accepted (core) | Region B, `Core` group | Remove → excluded | Lock, Inspect |
| Excluded | Collapsed drawer in region B | Restore → candidate | Inspect |

**Every one of these is available by tap, by drag, and by keyboard.** Drag is the
accelerator; it is never the only route (P1). The drag targets are the region
backgrounds and the group headers — dropping a candidate onto a specific accepted
group both accepts it and applies that role override, which is a genuinely useful
shortcut and worth the extra drop target.

## 6.4 The re-grouping moment

When a card is accepted, other candidates' combo degrees change (doc 02 §2.3).
This is the app's most important feedback and it must be *seen*:

1. Card animates from its candidate slot into the accepted region (FLIP transition,
   ~250 ms).
2. Candidates whose degree changed animate to their new group, with a brief count
   delta on the affected group headers (`14 → 17`).
3. If any candidate is promoted into `combo-3plus`, that group header pulses once.

Motion here is information, not decoration. It is the difference between "the list
changed" and "*because you took Dockside, three more cards now finish combos.*"

Respect `prefers-reduced-motion`: replace transitions with an instant reflow plus
a persistent one-line summary ("3 cards moved into Completes 3+ combos"), so the
information survives even when the animation does not.

## 6.5 Inspect (L3)

Opening a card gives: full image, oracle text, every completed and near combo with
its pieces and steps, EDHREC statistics, price, bracket flags, role assignment with
a correction control, and the generated `reasons` list.

Desktop: a right-side panel that does not cover either region. Mobile: a full
sheet. In both cases the accept/exclude actions stay reachable without closing it —
inspect-then-decide is the loop.

## 6.6 Persistence and undo

- Every mutation is a discrete, named, undoable command (`AcceptCard`,
  `ExcludeCard`, `ApplyCorePackage`, `ChangeBracket`). Undo stack of at least 50.
  `ChangeBracket` is a single undoable unit, not 24 separate additions.
- Autosave on every mutation; no save button.
- Deck state survives reload and is per-device-independent (server-persisted).
- Export at any time: plain decklist text, and a JSON format carrying our extra
  state (origins, exclusions, locks) so a deck round-trips through us losslessly.
