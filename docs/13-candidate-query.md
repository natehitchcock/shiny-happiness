# 13. The candidate query language

A filter for the Candidate region, in a syntax Scryfall users already know. It
narrows *what is eligible to be suggested* so the groups contain only cards you
would actually consider — "only instants under 3 mana", "only things that make
treasure", "only cards that complete two or more combos".

## 13.1 Where it sits in the pipeline

The query is an **additional eligibility filter** (doc 05 §5.2), applied before
grouping:

```
eligible cards ─→ [ QUERY FILTER ] ─→ annotate ─→ group ─→ score within group
```

Consequences that follow from that placement, and must be implemented:

- **Groups still form normally.** Filtering does not flatten the candidate region
  into a list. You get the same combo-degree groups, over a smaller pool.
- **Counts are honest.** Group headers show the filtered count; the pane header
  shows `34 of 248 match`.
- **A filter never silently hides your best card.** If a query excludes cards that
  would otherwise appear in a group, the group shows a muted footer:
  `+3 more complete 3+ combos but don't match your filter · show`. Tapping it
  reveals them in place, dimmed. This is the same principle as doc 03 §3.2 and
  doc 05 §5.3 — surface what was withheld, never drop it quietly.
- **`combo` and `role` are queryable.** The query reaches our own annotations, not
  just card data, so `combo>=2 role:ramp` is a legal and useful query. This is the
  main thing the language does that Scryfall's cannot.

The same query also applies to the **Accepted** region as a *highlight*, not a
filter: matching cards keep full contrast, non-matching cards dim to ~40%. Never
hide a card the user already owns — "where is my interaction" is a real question,
and answering it by making 60 cards vanish is the wrong answer.

## 13.2 Grammar

```
query    := or_expr
or_expr  := and_expr ( "or" and_expr )*
and_expr := unary+                       -- juxtaposition is AND
unary    := "-"? atom                    -- "-" negates
atom     := "(" or_expr ")" | term | bareword
term     := field op value
op       := ":" | "=" | "!=" | "<" | "<=" | ">" | ">="
value    := '"' ... '"' | word
```

A **bareword** with no field matches the card name, substring, case-insensitive.
`or` is case-insensitive; everything else is too.

### Fields

| Field | Aliases | Ops | Matches |
| --- | --- | --- | --- |
| `t` | `type` | `:` | Type line contains — `t:creature`, `t:goblin`, `t:"legendary artifact"` |
| `o` | `oracle` | `:` | Oracle text contains. `~` stands for the card's own name |
| `kw` | `keyword` | `:` | Keyword ability — `kw:haste` |
| `c` | `color` | `: = != < <= > >=` | The card's colors — `c:r`, `c>=ur`, `c:colorless` |
| `id` | `identity` | same | Colour identity |
| `mv` | `cmc` | numeric | Mana value — `mv<=3`, `mv=0` |
| `pow` `tou` | `power` `toughness` | numeric | Power / toughness |
| `r` | `rarity` | `: = < >` | `r:rare`, `r>=uncommon` |
| `set` | `e` | `:` | Set code |
| `is` | | `:` | Predicates — see below |
| `price` | `usd` | numeric | Cheapest printing, USD — `price<=5` |
| `role` | | `:` | Our derived role (doc 02 §2.4) — `role:ramp` |
| `combo` | | numeric | **Combo degree against your current deck** — `combo>=2` |
| `near` | | numeric | Near-combos at distance 1 (doc 02 §2.3) |
| `flag` | | `:` | Bracket flag — `flag:game-changer` |
| `group` | | `:` | Candidate group key — `group:fills-ramp` |

`is:` predicates: `permanent`, `spell`, `creature`, `land`, `vanilla`, `modal`,
`dfc`, `split`, `adventure`, `reserved`, `gamechanger`, `reprint`, `firstprint`.

### Worked examples

```
t:instant mv<=2                      cheap interaction
o:"create a treasure token"          treasure makers
combo>=2 -flag:game-changer          combo pieces that stay inside Bracket 3
t:goblin (kw:haste or o:"can't be blocked")
role:ramp mv<=2 price<=5             budget early ramp
o:~ t:enchantment                    enchantments that reference themselves
near>=2 -t:land                      pairs worth adding together
```

### Deliberately not supported in v1

- **Regular expressions** (`o:/^Add \{/`). Scryfall has them; we will not, because
  this is user input evaluated server-side against ~30k cards and an unbounded
  regex is a denial-of-service surface. Revisit only behind a timeout-bounded
  engine, in an ADR.
- Scryfall's game/format/language/artist/watermark/border filters. Out of scope
  for a Commander deck builder.

**Unknown fields are an error, never ignored.** `typ:creature` returns a parse
error naming the position and suggesting `t:` — it does not silently match
everything. Silently dropping a filter term gives the user a wrong answer that
looks right, which is the worst failure mode this app has.

## 13.3 The parser

Lives in `packages/domain/src/query/` — pure, no IO (R1).

```ts
parseQuery(input: string): Result<QueryAst, QueryParseError[]>
matchesQuery(ast: QueryAst, card: AnnotatedCandidate): boolean
formatQuery(ast: QueryAst): string          // canonical text, for round-tripping
describeQuery(ast: QueryAst): string        // "instants, 2 mana or less"
```

- Errors carry `{ position, length, message, suggestion }` so the UI can underline
  the exact token.
- **Partial parses are usable.** A trailing incomplete term (`t:cre`) parses the
  complete prefix and reports the tail as incomplete rather than failing whole —
  otherwise results flicker to empty on every keystroke.
- `formatQuery(parseQuery(s))` must be idempotent. Property-tested.
- Evaluation is a pure predicate over an already-annotated candidate, so
  `combo>=2` needs no special casing — the annotation is already there.

## 13.4 The desktop control

The candidate pane header gains a query bar. **Two views of one query**, and this
is the central design decision:

```
┌───────────────────────────────────────────────────────────────────────┐
│ CANDIDATES                                              34 of 248  ✕  │
│ ┌───────────────────────────────────────────────────────────────────┐ │
│ │ [t: creature ✕] [mv ≤ 3 ✕] [combo ≥ 2 ✕]  o:"treas▌       ] </> │ │
│ └───────────────────────────────────────────────────────────────────┘ │
│   ┌─────────────────────────────────────────────┐                     │
│   │ o:  oracle text contains                    │  ← autocomplete     │
│   │ ─────────────────────────────────────────── │                     │
│   │ o:"create a treasure token"          1,204  │                     │
│   │ o:"treasure"                         1,891  │                     │
│   └─────────────────────────────────────────────┘                     │
└───────────────────────────────────────────────────────────────────────┘
```

- **Chips** — each top-level AND term is a removable chip. Click a chip to edit
  that term in place; click its `✕` to drop it.
- **Text entry** — you type at the end of the chip row in the real syntax; a
  completed term becomes a chip.
- **`</>` toggles raw mode**, editing the whole query as text.
- **Autocomplete** on field names (with a one-line description) and on values,
  from the corpus: type lines, creature types, keywords, set names, roles. Each
  suggestion carries a **match count**, so you can see a term is useless before
  you commit to it.

**Round-tripping and its limit.** Chips represent a flat conjunction. A query
with nested parentheses or a top-level `or` cannot be shown as chips honestly, so
the bar switches to raw text mode and says why (`nested query — editing as text`).
Faking a chip for `(a or b)` and quietly losing the structure on edit is worse
than admitting the limit.

Queries are per-deck and persist in `WorkspaceState.candidateQuery` (doc 12 §12.6).
Recently used queries are offered in a dropdown, and a query can be saved with a
name.

## 13.5 The mobile control

Typing `o:"create a treasure token" t:artifact` on a phone is miserable, so on
mobile the **faceted builder is the primary path** and text is the accelerator —
the same relationship as tap and drag (doc 08 §8.2). P1 is not satisfied by
"there's a text field".

A full-screen filter sheet, sectioned, each section collapsible:

| Section | Control |
| --- | --- |
| Name / text | Search field, matches name and oracle text |
| Card type | Chip multi-select, corpus-ordered by frequency |
| Mana value | Dual-handle range slider, 0–12+ |
| Colours | Five mana pips as toggles, plus an exact/subset switch |
| Combo degree | Stepper — "completes at least ⟨2⟩ combos" |
| Role | Chip multi-select |
| Keywords | Searchable chip list |
| Price | Range slider with a "no limit" end |
| Flags | Toggles — hide Game Changers, hide two-card infinites |
| Advanced | The raw query text field |

- A **live count** sits in the footer button: `Show 34 cards`. Never make someone
  apply a filter to discover it matched nothing.
- Every facet writes the same AST. Setting facets updates the Advanced text;
  editing the text updates the facets, or — for a query facets cannot represent —
  the facet sections go read-only with a note, same rule as desktop.
- Active filters appear as a horizontally scrolling chip row under the command
  bar when the sheet is closed, so a filter is never invisibly on. A filter you
  forgot you set is indistinguishable from a broken recommendation engine.

## 13.6 Performance

- Parse on every keystroke (it is microseconds); **evaluate debounced ~150 ms**.
- Evaluate client-side against the already-loaded candidate pool for instant
  feedback; the server re-evaluates authoritatively on the next recommendation
  request. Same domain code both sides (doc 09 §9.4), so results agree.
- Autocomplete counts come from precomputed corpus histograms, not live queries.
- Budget: filter applied to a 5,000-card pool, re-grouped and re-rendered, under
  100 ms — it must feel like the list is filtering as you type.
