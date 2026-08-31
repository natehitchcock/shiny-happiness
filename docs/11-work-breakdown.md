# 11. Work breakdown

Tasks sized for one agent to complete in one focused pass. Each has an owner
scope (files it may touch), explicit dependencies, and a definition of done.

**Read [AGENTS.md](../AGENTS.md) before picking up any task.**

## 11.0 Current state — read this first

Last updated: 2026-08-31, end of the fourth build session.

**It runs.** `pnpm --filter @roundtable/web dev` with the API up gives a working
deck workspace against 34,492 real cards, 110,577 printings and 108,046 real
combos: pick a commander, take suggestions with their reasons, accept or exclude,
watch the pool re-sort. That is the state to protect.

**Mana costs render as symbols**, not as Scryfall's `{2}{R}` shorthand, in every
place a cost appears. They are DRAWN from the project's own palette rather than
fetched: ADR-0009 Q4 puts mana symbols under the same Wizards copyright as card
images and leaves re-serving Scryfall's image files an open question gated on
`ING-04`, so the option needing no third-party asset was taken instead. See
[ADR-0015](adr/0015-drawn-mana-symbols.md). This does **not** unblock `ING-04` or
answer its question.

**Cards have pictures now.** The art was ingested four sessions ago and never
left the server: `/cards/batch` returns domain `Card`s, and a `Card` carries no
image URL because an image belongs to a printing (doc 02 §2.1). Both card routes
now send an `images` map beside `items` and `prices` —
[ADR-0021](adr/0021-card-art-from-scryfalls-cdn.md) — and the URLs are
Scryfall's own CDN, referenced directly at the two sizes Scryfall publishes.
Nothing is proxied, cached, resized or re-encoded.

That **knowingly diverges from doc 04 §4.1's "no client request ever hits a
third-party image host"**, which was a performance and privacy preference rather
than a licensing constraint; §4.1 is struck through and points at the ADR. It
does **not** unblock `ING-04`, which remains the separate, gated project it has
always been: the question of whether this project may re-serve and resize
Scryfall's image files from its own object store is untouched, and ADR-0009 Q4
still says it must not ship without asking Scryfall first.

Art appears in the preview panel and on the chosen commander at the start
screen. It is deliberately **absent** from the deck rail, the suggestion feed and
the commander search results — those are dense text lists read by name, and a
thumbnail per row triples the scroll length to answer a question nobody asks of
them. The reasoning is in the ADR, and `apps/web/src/art.test.tsx` pins both
halves so the absences read as decisions rather than omissions.

**The client stops re-downloading cards it already has.** The workspace used to
replace its whole card map on every recompute, so every accept, reject, filter
change and auto-query tick re-hydrated the entire page — names, type lines,
oracle text, mana costs, synergy tags, art URLs and prices for a 99-card deck
plus its suggestions, measured at 186–190 ids per click. `apps/web/src/cardcache.ts`
holds them keyed on `Recommendations.datasetSnapshotId`, which is the same
invalidation the API's own `snapshot-cache.ts` uses one layer down and for the
same reason: card data at oracle identity is immutable for a corpus, and the
snapshot id changes exactly when the ingest writes. Measured in a browser on the
same 110-card deck, three accepts went from **561 ids over 3 requests to 16**, a
recompute with nothing new on the page makes **no request at all**, and opening a
suggestion's preview went from two `/cards/:oracleId` requests to one — one click
fires `open` twice, so the cache holds the in-flight promise rather than the
resolved value. Prices are held on the same key on purpose, and the reasoning
(including the rejected short-TTL alternative) is at the top of that file.

The **501 art-less cards are gone** and several `apps/web` comments still said
otherwise; they now read as the past tense doc 17 §17.2 established. The no-art
code path stays — an unresolved printing is still a state the wire can express.

**The colour panel is two charts now, and colourless is on both.**
[ADR-0024](adr/0024-two-colour-charts-identity-and-generation.md). A user
reported that colourless cards were missing from the mana colour pie, and behind
that were three defects in one twelve-line block: neither count had a `C` bucket
and the pip regex was `[WUBRG]`; the "sources" figure read `colorIdentity`, so
Command Tower — empty identity, taps for all five — contributed to no colour at
all and was indistinguishable from a fetchland; and both were counted over
`acceptedSet`, a `Set` of oracle ids, so twelve Mountains were one.

`colorBalance` now carries **`identity`** (one bucket per accepted copy, keyed
`W U B R G M C`, so the slices sum to the deck) and **`generation`** (a count per
kind of mana each copy produces, from `producedMana`, lands and rocks and dorks
alike). Both are counted over `acceptedCopies(deck)` by one pure function in
`packages/domain/src/color-balance.ts`. A gold card goes in `M` rather than in
each of its colours, because a pie whose slices total more than the deck is a bar
chart wearing one — and each figure states what its own slices sum to on screen.
`pips` and `sources` are **off the wire**, which is the contract change the ADR
exists for. The client's **"N lands" hedge is gone with them**: it was worded
that way to work around the Set, and a label written around a bug should not
outlive the bug.

The app is called **Lotus Wizard** in the interface. The name is tentative and
**not cleared** — `LEGAL-01` owns that, and there is a real question to answer
first: see doc 04 §4.6. Package scopes stay `@roundtable/*` until it is settled.

**Done (22 tasks).** `FOUND-01`, `DOM-01`–`DOM-09`, `DB-01`, `API-01`, `API-02`,
`DATA-01`, `DATA-02`, `DATA-05`, `ING-01`, `ING-02`, `FOUND-02`, `UI-01`, and a vertical slice of `WEB-01`.
`DATA-03` is closed by decision and `ING-03` cut ([ADR-0008](adr/0008-drop-edhrec.md)).

**The bracket check does something now, and says what it still cannot do.**
`DATA-05` is closed by [ADR-0018](adr/0018-bracket-rules-and-game-changers.md).
Wizards publishes a per-bracket number for exactly one barometer — Game Changers,
0/0/3/unlimited/unlimited — so that one is fetched, quoted and enforced, and the
other four stay `null` because the tutor restriction was withdrawn in October 2025
and the rest were replaced by prose turn counts. `bracket.assessed` is still
`null`: one barometer of five is not a verdict. The Game Changers **list** is not
in the repository at all — Scryfall's `game_changer` boolean carries it, and it
matched the Wizards page card-for-card (53) on 2026-08-30.

**And the builder can see it.** The masthead chip reads `BRACKET 3 · 4/3 GAME
CHANGERS` and opens a **Bracket check** panel that names which Game Changers the
deck holds, lists the four barometers it cannot check against "no published
rule", and links the source URL and the date it was read. The chip shows the
count in every state, because one that appeared only on a violation would make
its own absence read as a pass. Nothing renders a tick or an assessed bracket.
`bracket.rules` now also carries the target bracket's published entry, so a deck
INSIDE its allowance can still be told what the allowance is — `violations` names
it only when the deck breaks it, and a table of allowances in the client is a
rejected PR (AGENTS.md §8). New optional field, so no ADR (R2). See doc 03 §3.2.

> **A card re-ingest is required** before bracket checks answer. Migration `0011`
> defaults every existing row to `game_changer = false`, and a corpus with no Game
> Changers is refused by `loadBracketRules` rather than passing every deck
> vacuously.

**Run it locally:**

```bash
pnpm install
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16-alpine
export DATABASE_URL=postgresql://postgres:postgres@localhost:5432/postgres
node packages/db/dist/cli.js up          # migrations
node apps/ingest/dist/main.js            # ~35k cards, ~108k combos, under a minute
node apps/api/dist/main.js &             # API on :3000
pnpm --filter @roundtable/web dev        # workspace on :5173
```

No Docker? Any PostgreSQL 16 works. The third session used the EDB portable
binaries (`initdb` into a user directory, `pg_ctl -o "-p 5433"`) — no
administrator rights, no service.

**The archetype presets can be argued with.** [Doc 16](16-archetype-customiser.md)
is built: a builder tunes the role counts, the eight curve buckets and one
"how strict" setting per deck, from "Adjust targets" on the Composition panel.
The override is **sparse** — only what was typed is stored, so a deck that pins
`ramp` still inherits every later revision of `draw` — and it is stored as
**counts**, because builders think in "36 lands". Migration `0013` adds
`decks.target_overrides jsonb NOT NULL DEFAULT '{}'`; a deck that overrides
nothing is byte-identical to before. No ADR: every contract change is a new
optional field (AGENTS.md R2). A recommendation filling a gap the builder
invented now says so — "fills the ramp target you set", not "fills ramp gap" —
because pillar P4 asks the reason to name the thing they can change.

**A deck can say what it is ABOUT, not only what it does.** `Deck` gains
`semanticEmphasis` — a set of the mechanical synergy tags the builder picked,
offered from the chosen commander's own tags at the start screen and toggled by
clicking a chip afterwards. Migration `0014` adds
`decks.semantic_emphasis jsonb NOT NULL DEFAULT '[]'`; a deck that emphasises
nothing is byte-identical to before, and no ADR is needed because every contract
change is a new optional field (AGENTS.md R2). Scoring gains its own additive
term (doc 05 §5.6) rather than a multiplier on `synergyScore`, because
`synergyScore` also decides the `high-synergy` GROUP and a user preference must
not relabel a card (P5). It never filters: `POST .../recommendations` returns
`emphasis: [{ tag, supporting }]` so a tag nothing in the deck's colours
supports is *named*, not mimed by an unchanged list. Reversibility is the design
— the emphasis is replaced wholesale, so de-emphasising is saving the list one
shorter and `null` clears it.

Measured on the real corpus, mono-black, Tergrid leading: emphasising
`opponent-discard` reorders eight of the ten candidate groups and every group's
membership and size is unchanged, exactly as P5 requires. `Rankle, Master of
Pranks` goes 4th → 1st in `fills-draw`, `Syphon Mind`, `Waste Not` and `Dark
Deal` enter its top ten, and `high-synergy` swaps nine of its ten for
opponent-discard cards led by `Tinybones, Bauble Burglar` and `Torment of
Hailfire`. Each of them explains itself as *emphasised* rather than as ordinary
synergy.

**The UI half is built too.** Choosing a commander on the start screen now asks
"What is this deck about?" and offers that commander's own semantics, both
directions — a PROMPT and not a gate, so "Start building" stays enabled with
nothing picked and an unanswered prompt sends no `semanticEmphasis` at all. The
picks ride along with the create, because a deck created and then PATCHed would
score its first page of suggestions against no focus. A **Focus** block sits
directly above the Commander section of the deck rail, naming each tag with its
`supporting` count, carrying a Remove button per tag, and holding the "Add a
focus" disclosure that is the way back in for someone who skipped the prompt or
who changes direction at forty cards. Every tag chip in a card's Semantics panel
carries its own ✧/✦ toggle beside it — a separate control, because the chip's
click already belongs to its hint, which is the only way a touch device can read
that explanation.

Writes are **awaited, never optimistic**: the chip carries a count only the
server can compute and the visible consequence is the suggestion ORDER, so
`deck` is only ever written from a response and a failed PATCH cannot leave a
chip showing a focus the server does not have — it says
"Could not save the focus — … Nothing changed." instead. `supporting: 0` reads
"Nothing in your colours supports this yet — your suggestions are unchanged", in
the ordinary note style: not an error, because nothing is broken.

**Every card now says how big it is and what it costs you.**
[Doc 18](18-card-impact-and-efficiency.md) is built: two CARD-INTRINSIC metrics,
`impact` (breadth × persistence × stakes, discounted for symmetry) and
`efficiency` (surplus stat points per mana), on every recommendation item and on
card detail. Deck-relative impact was offered and declined — the deck already
has three deck-relative numbers per row — and the known cost is stated rather
than patched: Sol Ring scores 0.68 and Rhystic Study 0.81, which was accepted
before the model was built.

The fair rate is **measured, not asserted**. 339 commander-legal vanilla
creatures say a four-drop's body is 6.78 power-plus-toughness where the folk
"2/2 for 2" rule predicts 8, and the gap between that row and all creatures is
the format's own price of text — one impact point buys 0.4484 stat points.
`packages/domain/src/efficiency/baseline.data.json` is **generated** from the
corpus by `pnpm --filter @roundtable/ingest baseline` (read-only, not part of
the scheduled worker), so power creep updates it instead of quietly invalidating
a frozen constant.

The scoped formula `(P+T + r × impact) / MV` was built, measured and REJECTED:
it rates Grizzly Bears 2.00 against Wrath of God 0.69, because it adds an
absolute body to a marginal text price. Both terms are surpluses as shipped —
doc 18 §18.6 and §18.10.

**Columns are deck state.** "The filters are basically part of the deck."
`Deck.columns` is a list of `{ kind: 'query', query } | { kind: 'metric',
metric }`, and the two metrics ship as ordinary removable columns present by
default. Migration `0015` adds `decks.columns jsonb` — **nullable, deliberately
unlike 0013 and 0014**, because NULL ("never set: draw the defaults") and `[]`
("I removed them all") are different decks here, and a builder whose cleared
columns come back has not cleared anything. No ADR: every contract change is a
new optional field. The recommendations request is unchanged — a metric column
needs no server evaluation, since its number is already on the row.

**The COLUMN half is not built.** Nothing renders a metric column or persists
the column list to the deck yet; the storage, the metrics, the endpoints and the
`queryColumns` seam are.

**The DETAIL half is.** Both metrics are drawn on the card detail pane — in the
workspace preview panel and in the L3 `Detail` primitive, through one shared
`CardMetrics` component so the two surfaces cannot disagree. What it draws is
not a bare float, because the user has never seen either number:

- **Impact against its scale.** `impact.ts` now exports `IMPACT_MAX`, derived
  from the three tier tables rather than written down (18.48 = 6.0 × 2.2 × 1.4),
  and the pane prints `6.12 of 18.48` over a meter filled to that fraction. The
  docblock's old "roughly 0–13" is corrected, closing the item ADR-0025 listed.
  Rejected: a corpus percentile — more useful, and it would need a server-side
  distribution to keep in step with the model. The ceiling is a fact about the
  model and cannot drift.
- **The tiers, as the reasons.** `breadth`, `persistence`, `stakes` and
  `symmetry` are already on the wire (§18.8) and are rendered in plain English —
  "Reach: everything at once / Repeats: once, then it is done / Falls on: an
  opponent's side, your board included". A score with its reasons can be
  disbelieved usefully; a score alone can only be taken on trust. `scales` and
  `fragile` get the marker §18.5 asks for, and the model's own documented blind
  spot ("effects only: a card whose job is mana or a tax reads low") is printed
  unconditionally, because otherwise Sol Ring's 0.68 reads as a verdict.
- **Efficiency as a rate, with its working.** `0.549 per mana`, then
  `No surplus body, plus 2.744 for its text, over 5 — its mana plus the card
  itself`, then the caveat that it divides by cost so a small cheap card can
  out-rate a bomb. **No meter**: impact has an exact ceiling and efficiency has
  none, so a bar would need a maximum invented in the renderer — the unstated
  range the rest of this is built to remove.

**Nothing rounds for display.** ADR-0025 §2 binds it: the filter compares the
raw score, so the pane draws the stored number, ragged decimals and all
(`6.12`, `0.549`, `13.464`). `toFixed(2)` would make `impact>=6.13` drop a row
whose own cell said 6.13.

Read-only figures, so no controls and nothing for R4 to govern.

**Both metrics are now filterable** ([ADR-0025](adr/0025-impact-and-efficiency-are-query-fields.md)).
`impact` and `efficiency` are numeric fields of the candidate query language —
aliases `imp` and `eff` — so `impact>=6 -t:land` and `eff>=1.5 mv<=3` work in
the filter box, as a column, and on `/cards/search`, which answers them because
they are card-intrinsic. `AnnotatedCandidate` gains two required numbers, which
is the contract change the ADR exists for; there are **three** construction
sites, the third being an inline literal in `routes/recommendations.ts` that a
grep for the type name does not find. The filter compares the raw score, so a
matched row always agrees with the number a column would draw. The filter box
also gains a `?` listing every field with an example — the metrics were
otherwise undiscoverable, being numbers this app invented.

**The deck is a picture now, at `#web`.** [Doc 17](17-deck-web.md) is built: a
second mode, entered from the masthead, that replaces everything below it with
one node per card — the art crop — and one line per relationship. It makes **no
requests**: every edge is computed in the browser from `synergyProduces` /
`synergyWants` and `analysis.deckCombos`, which the workspace has already
hydrated, so the `POST /decks/:id/web` endpoint doc 17 considered was not built
and is not needed. The layout is a seeded force simulation that settles and
stops; `prefers-reduced-motion` paints the converged positions directly.

Its blocker was [ADR-0021](adr/0021-card-art-from-scryfalls-cdn.md), which
closed it as a side effect of shipping art for the preview panel.

**Two of doc 17's four edge kinds were cut, on measurement.** Theme edges make a
pile of the 99 most-played black cards look nearly five times more connected
(1,061 edges) than a real themed 99 (226) — the inverse of the mess-versus-dust
contrast the whole design rests on — and the deficit they claim to show is false
under the interaction table `synergy.ts` already uses. Near-combo edges would
introduce cards the deck does not contain into a view that is deliberately not
editable. Doc 17 §17.10 has the numbers and §17.12 the rest of the divergences,
including that the scoped "merge parallel edges" rule reduces 712 edges to 690
rather than the order of magnitude claimed.

**Is a deployment current?** `GET /api/v1/health` says so without credentials —
the applied migration head, anything unapplied, and whether a corpus snapshot is
live ([ADR-0019](adr/0019-health-endpoint-reports-the-applied-schema.md)). It
exists because production ran four migrations behind for weeks and never
returned an error; see DEPLOYING.md.

**Verify:**

```bash
pnpm check          # lint + typecheck + 1258 tests
```

The integration tests need a real Postgres and SKIP (loudly) without one. The
API-02 performance test seeds a 20,000-card corpus and takes ~40 s.

**Next, in order of value:**

| Pick up | Why now |
| --- | --- |
| `LEGAL-01` (name clearance only) | The name **Lotus Wizard** needs checking before it goes anywhere public — see doc 04 §4.6. Cheap to resolve, awkward to undo after it is on a domain. |
| `FOUND-02` | ✅ **Done.** Design tokens as asserted data + `packages/ui` scaffold; the app imports them rather than keeping a copy | root | ✅ 13 contrast pairs asserted, each naming what it is for. Caught a live defect on the first run: rust was 2.80:1 on `ink-2`, the surface cut hints are drawn on. `tokens.css` is generated from the data and a test holds the two in step |
| `WEB-01` proper | The slice is one deck in localStorage with no offline queue, no optimistic mutation and no reconcile. Everything in WEB-02..24 assumes those exist. |
| `LEGAL-01` (name clearance) | **Lotus Wizard** needs checking before it goes on a domain. Now urgent rather than cheap-and-later: the Vercel config is written. |
| `API-06` (remainder) | The `409` half is done — `since` is real (migration `0012`, [ADR-0020](adr/0020-deck-command-log-makes-409-replayable.md)) and the client rebases onto it instead of re-sending blindly. What is left in the task's scope is the **workspace-state endpoint** of doc 12 §12.6: `PUT /decks/:id/workspace` does not exist and nothing persists `WorkspaceState`, so "return where you left" does not hold across devices. |
| Test flake (residual) | The database suites now run in their own Vitest project one at a time, which removed most of the contention and the leaked databases it caused. Roughly one run in eight still ends `51 passed (52)` — a whole file SILENTLY SKIPPED, not failed, with the count varying by file between runs. The only skip path is `databaseUrl() === null`, i.e. `DATABASE_URL` not visible to that worker, and I could not reproduce it under a five-run loop. A suite that quietly does not run protects nothing, so this is worth root-causing before it hides a real regression. |
| Bracket UI | The API answers `bracket.violations`, `bracket.gameChangers` and `bracket.rules`, and nothing renders them. Doc 03 §3.2 describes the warning chip and the "Bracket check" panel; the masthead still prints a bare `BRACKET 3`. |

**No third-party question is left open except Scryfall Q4** (image serving, which
gates `ING-04` — and which [ADR-0021](adr/0021-card-art-from-scryfalls-cdn.md)
routes around rather than answers: referencing Scryfall's CDN needs no
permission that ADR-0009 has not already established, while re-serving from ours
still does). `DATA-01` and `DATA-02` are
answered ([ADR-0009](adr/0009-scryfall-terms.md), [ADR-0010](adr/0010-spellbook-terms.md)):
Scryfall grants use explicitly, Spellbook publishes no prohibition. `DATA-03` is
closed — EDHREC's terms forbid automated queries, and Archidekt carries the
identical clause, so the project queries neither ([ADR-0008](adr/0008-drop-edhrec.md)).

**Nothing else is blocked.** Every remaining task needs a browser toolchain
(installed) or just time.

## 11.1 Dependency graph

```
 FOUND-01 ─┬─→ DOM-01 ─┬─→ DOM-02 ─→ DOM-03 ─→ DOM-05 ─┐
   (done)  │  (done)   │  (done)   ├─→ DOM-09 ─→ DOM-06 ┤
           │           ├─→ DOM-04 ─┘                    │
           │           ├─→ DOM-07  └─→ DOM-08           │
           │           │                                ├─→ API-02 ─┬─→ API-05..09
           ├─→ DATA-01 ─→ ING-01 ─┐                     │           │
           ├─→ DATA-02 ─→ ING-02 ─┼─→ DB-01 ─→ API-01 ──┘           │
           │                        └─→ ING-05                        │
           ├─→ DATA-05 ─→ DOM-06                                    │
           │                                                        │
           └─→ UI-01 ─┬─→ WEB-01 ─┬─→ WEB-02 ─┬─→ WEB-03 ─→ WEB-04 ─┤
                      │           │           ├─→ WEB-05            │
                      │           │           ├─→ WEB-07 ─→ WEB-08  │
                      │           │           ├─→ WEB-10            │
                      │           │           └─→ WEB-17 ─┬─→ WEB-19│
                      │           │                       └─→ WEB-18│
                      │           ├─→ WEB-09  WEB-11  WEB-15  WEB-16│
                      │           └─→ WEB-12 ─→ WEB-13 ─┬─→ WEB-14 ─→ WEB-20 ─→ WEB-21
                      │                                 ├─→ WEB-22 ─→ WEB-24 │
                      │                                 └─→ WEB-23           │
                      └─→ WEB-06 ──────────────────────────────────────────┴─→ E2E-01
                                                                               PERF-01
                                                                               A11Y-01
                                                                               LEGAL-01
```

**`packages/domain` is complete.** Every pure task — `DOM-01` through `DOM-09` —
is merged, along with `FOUND-01`. That is the shared contract doc 09 §9.2
describes: entity types, combo degree and its incremental patch, role derivation,
archetype targets, legality, composition analysis, the candidate query language,
the grouping and scoring engine, and decklist import/export. 254 tests, no IO,
buildable and testable with zero infrastructure.

What remains needs something the domain layer deliberately does not: a database,
a browser, or an answer from a third party.

Everything under `DOM-*` and `UI-*` can start immediately and runs fully parallel
with the data work. That is the point of the pure-domain rule: no domain task
waits on a database, an API key, or an answer from a third party.

The `DATA-*` tasks are **blocking for deployment, not for development** — see
[ADR-0006](adr/0006-data-source-terms-verification.md). Adapters can be written
against their interfaces; nothing depending on an unanswered question ships.

## 11.2 Foundation

| ID         | Task                                                                                                                                                                                                 | Scope                       | DoD                                                                                                           |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `FOUND-01` | ✅ **Done.** Monorepo skeleton: pnpm workspaces, Turborepo, TS strict, ESLint/Prettier, Vitest, CI. Lint rules enforce R1 (domain purity) and R3 (no third-party `fetch` outside `packages/clients`) | root, all package manifests | ✅ `pnpm install && pnpm check` green from a clean clone; purity rules verified to actually reject violations |
| `FOUND-02` | ✅ **Done.** Design tokens as asserted data + `packages/ui` scaffold; the app imports them rather than keeping a copy | root | ✅ 13 contrast pairs asserted, each naming what it is for. Caught a live defect on the first run: rust was 2.80:1 on `ink-2`, the surface cut hints are drawn on. `tokens.css` is generated from the data and a test holds the two in step |

## 11.3 Domain — pure, no IO, parallelisable

| ID       | Task                                                                                                                                 | Depends                 | DoD                                                                                                                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------ | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DOM-01` | ✅ **Done.** Entity types per doc 02, branded ids, exhaustive discriminated unions, `assertNever`, role precedence | FOUND-01 | ✅ Types exported; no `any`; typecheck green |
| `DOM-02` | ✅ **Done.** Combo index, `comboDegree`, `nearCombos`, `annotateCombos`, `deckCombos`, `candidatesAffectedBy` — exactly per doc 02 §2.3 | DOM-01 | ✅ 29 tests covering the shared-pieces case, the two-separate-combos case, and degenerate inputs (empty combo, empty pool, empty accepted set, duplicate ids, duplicate pieces, already-accepted candidate). Mutation-tested: four deliberate breaks to the definition are each caught |
| `DOM-03` | ✅ **Done.** Incremental degree patching (doc 05 §5.8) | DOM-02                  | Property test: incremental result ≡ full recompute, over randomised accept/exclude sequences                                                                                                                                              |
| `DOM-04` | ✅ **Done.** Role derivation: override → curated table → oracle-text heuristics | DOM-01                  | ≥ 95% agreement with a 300-card hand-labelled fixture set                                                                                                                                                                                 |
| `DOM-05` | ✅ **Done.** Grouping + scoring engine (doc 05 §5.3, §5.6) | DOM-02, DOM-04          | Deterministic; golden-file tests over 5 fixture decks; every output carries non-empty `reasons`                                                                                                                                           |
| `DOM-06` | ✅ **Done.** Commander legality, composition analysis, bracket-rules loader | DOM-01, DATA-05, DOM-09 | Legality tests incl. colour identity, partners, singleton exceptions                                                                                                                                                                      |
| `DOM-09` | ✅ **Done.** Archetype vectors, 70/30 blending, assessArchetype | DOM-01, DOM-04          | Blend rounds to whole cards; assessment deterministic and reports its drivers; every archetype row covered by a fixture deck                                                                                                              |
| `DOM-08` | ✅ **Done.** Candidate query: lexer, parser, evaluator, formatQuery, describeQuery, toChips | DOM-01, DOM-04          | Property test: `formatQuery(parse(s))` idempotent; partial parses usable; unknown field errors with position and suggestion; **no regex support**                                                                                         |
| `DOM-07` | ✅ **Done.** Decklist parse + format, all supported formats, confidence-floored name resolution | DOM-01                  | Fixtures from every supported source plus split cards, MDFCs, adventures, accented names, CRLF, trailing sideboard, no commander marker; unresolved lines reported, never thrown; below the confidence floor it asks rather than guessing |

## 11.4 Data and ingestion

| ID        | Task                                                                                                                                                       | Depends                | DoD                                                                                                                                                              |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DATA-01` | ✅ **Done.** All seven Scryfall questions answered with quoted wording and retrieval dates ([ADR-0009](adr/0009-scryfall-terms.md)) | — | ✅ Rate limits are **per endpoint** (search is 2/s, not 10/s — doc 04 §4.1 was wrong); bulk data is mandatory, not optional; prices are estimates and must be labelled so. Q4 narrowed: `ING-04` still needs the image-serving question confirmed |
| `DATA-02` | ✅ **Done.** Spellbook questions answered ([ADR-0010](adr/0010-spellbook-terms.md)) | — | ✅ `robots.txt` quoted with date; no terms page exists, so no prohibition — a weaker position than Scryfall's explicit grant, recorded as such. Q5 resolved: `uses[].card.oracleId` is Scryfall's oracle id, so no name matching |
| `DATA-03` | ✅ **Closed by decision, not completed.** EDHREC's terms were read on 2026-08-29 and prohibit automated queries; the project does not query EDHREC ([ADR-0008](adr/0008-drop-edhrec.md)) | — | ✅ Terms and `robots.txt` quoted with retrieval dates in ADR-0008. No permission request sent — permission was not the blocker. `ING-03` cut |
| `DATA-05` | ✅ **Done.** Bracket allowances fetched into `brackets/rules.data.json`; Game Changers list mapped from Scryfall's `game_changer` into the corpus ([ADR-0018](adr/0018-bracket-rules-and-game-changers.md)) | — | ✅ Source URL, retrieval date and quoted wording checked in. Only the Game Changers allowance is published per bracket, so the other four barometers are null and `bracket.assessed` stays null. List never recalled — 53 cards, matching the Wizards page exactly. **Needs a card re-ingest** (migration `0011`) |
| `ING-01` | ✅ **Done.** Scryfall bulk ingest: download, stream-parse, map to `Card`, snapshot-and-swap | DATA-01, DB-01 | ✅ 34,492 cards + printings from 38,627 records in <5 s against the real bulk file; re-run is idempotent. 4,135 non-playable records (art series, tokens, stickers, conspiracies) rejected — `CardType` is the definition of a deck card |
| `ING-02` | ✅ **Done.** Spellbook combo ingest + oracle-id mapping, **failing loudly on unmapped cards** | DATA-02, DB-01 | ✅ 108,046 combos in 12.8 s with **zero unmapped**; pieces map on `oracleId` with no name matching. Only `OK` variants ingested; a combo naming an unknown card is reported, never stored |
| ~~`ING-03`~~ | ❌ **Cut.** EDHREC stats fetcher. No aggregated-decklist source has usable terms — Archidekt carries the identical prohibition, Moxfield is out of scope, Deckstats is unreachable ([ADR-0008](adr/0008-drop-edhrec.md)). Inclusion and synergy statistics come from the project's own imported-deck corpus or not at all | — | — |
| `ING-04`  | Image caching pipeline to object store, three sizes (doc 07 §7.3). **Still gated** on the ADR-0009 Q4 conversation with Scryfall, and still the whole of that question. Two changes have now reached this gate and gone around it rather than through it: [ADR-0015](adr/0015-drawn-mana-symbols.md) draws mana symbols instead of serving them, and [ADR-0021](adr/0021-card-art-from-scryfalls-cdn.md) references Scryfall's CDN instead of re-serving from ours. **Neither answers the question, and the app showing card art is not evidence that this task is done or unblocked.** What this task adds over ADR-0021 is our own object store, our own cache headers, and derived sizes — which is exactly the "proxy" and "distort" wording ADR-0009 Q4 says must be confirmed first | ING-01                 | ~~No client request ever hits a third-party image host~~ — superseded by ADR-0021; the DoD to restate when this is picked up is a cache that does not re-encode and keeps the artist and copyright line legible at every size that shows them |
| `ING-05` | Core package generation (doc 05 §5.5), per bracket and — where the corpus supports it — per archetype. Corpus is **MTGJSON** (MIT licensed, 192 official Commander decklists) plus curation, never a scraped aggregate ([ADR-0008](adr/0008-drop-edhrec.md)) | DOM-04, DOM-09 | Reproducible from a fixed corpus; output diff is human-reviewable; falls back to the bracket's general package rather than emitting one built from too few decks |

## 11.5 Backend

| ID       | Task                                                                                                                | Depends                | DoD                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `DB-01`  | ✅ **Done.** Postgres schema + migrations + repositories; GIN index on the combo index; migration CLI | DOM-01 | ✅ Migrations up/down clean and idempotent; 40 integration tests against a **real** PostgreSQL 16; `EXPLAIN` asserts the planner actually uses `combos_pieces_idx` |
| `API-01` | ✅ **Done.** Cards + decks endpoints, incl. the batched command endpoint with idempotency and partial-success reporting | DB-01, DOM-01 | ✅ 48 contract tests against doc 10 on a real Postgres; `rejected` carries a typed reason per failed command. Command decisions live in `packages/domain` (`applyCommands`), so `web` and `api` cannot disagree — 22 unit tests, mutation-checked. See the divergences below |
| `API-02` | ✅ **Done.** Recommendations + analysis endpoints, incl. `unavailable` degradation, plus `GET /decks/:id/combo-index` | API-01, DOM-05, DOM-06 | ✅ Measured, not assumed: **p95 46.6 ms** against a 20,000-card corpus, 2,000 combos and a 100-card deck — budget is 200 ms. Degradation reported per missing source rather than as absent groups; a query that half-parses is never partially applied. 14 contract tests, mutation-checked. Divergences in doc 10 §10.9 |
| `API-03` | Auth, per-user rate limiting, deck ownership                                                                        | API-01                 | No deck readable cross-user; 429 with `Retry-After`                                                                                                                                     |
| `API-04` | Import preview/commit and export endpoints (doc 10 §10.7)                                                           | DOM-07                 | Preview applies nothing; `illegal` and `previouslyExcluded` populated; round-trip export JSON → import → identical deck incl. origins, exclusions, locks, tags, archetype and snapshots |
| `API-05` | Deck library: list/filter/sort, `recent`, duplicate, archive, soft delete (doc 12 §12.2–12.4)                       | API-01                 | `DeckSummary` projection never loads entries; duplicate copies exclusions and locks                                                                                                     |
| `API-06` | ⬛ **Mostly done.** `409` now carries a real `since` from `deck_command_log` (migration `0012`), plus `sinceBatches` and `sinceComplete`; `rebaseCommands` in `packages/domain` is the client half and `apps/web` uses it. **The workspace-state endpoint (§12.6) is still not built** — nothing writes `WorkspaceState` and `PUT /decks/:id/workspace` does not exist | API-01 | ✅ Two- and three-client convergence tests against a real Postgres, plus the case that used to lose information: a client can now tell "someone already did this" from "this was refused". See [ADR-0020](adr/0020-deck-command-log-makes-409-replayable.md) |
| `API-10` | `GET /api/v1/health`: applied migration head, pending migrations, corpus liveness | API-01 | ✅ **Done.** Three queries, no corpus read, never echoes a connection string; `503` only when the database is unreachable, `200`+`degraded` when the schema is behind. [ADR-0019](adr/0019-health-endpoint-reports-the-applied-schema.md) |
| `API-07` | Snapshots: auto before bulk ops, manual, restore (doc 12 §12.8)                                                     | API-01                 | Restore is itself undoable; retention enforced                                                                                                                                          |
| `API-08` | Query validate/suggest endpoints, corpus histograms for autocomplete counts (doc 10 §10.4)                          | API-02, DOM-08         | Suggest p95 < 40 ms; counts served from precomputed histograms                                                                                                                          |
| `API-09` | Archetype endpoints incl. per-commander suggestion with `source`, and archetype on deck create/patch (doc 10 §10.6) | API-01, DOM-09 | `source: 'default'` returned honestly when no statistics exist — which is **every** case until the project's own corpus is large enough ([ADR-0008](adr/0008-drop-edhrec.md)) |

## 11.6 Frontend

| ID       | Task                                                                                                                                             | Depends                | DoD                                                                                                                                |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `UI-01`  | ✅ **Done.** Card primitives at all four zoom representations (pip/tile/card/detail), plus the drawn mana symbols ([ADR-0015](adr/0015-drawn-mana-symbols.md))                                                              | FOUND-02               | ✅ A gallery at `#gallery` rather than Storybook — see §11.10. Sizes and a11y asserted in `packages/ui/src/card/*.test.*`; the cost parser is pure and covers hybrid, monocolour hybrid, Phyrexian, snow and an unreadable fragment             |
| `WEB-01` | App shell, routing, deck state store, optimistic mutation + reconcile                                                                            | UI-01, API-01          | Offline mutation queues and replays                                                                                                |
| `WEB-02` | Two-region workspace + draggable divider + grouping (doc 06)                                                                                     | WEB-01                 | Divider snaps and persists; group collapse persists                                                                                |
| `WEB-03` | Zoom system: 4 levels, shared across regions, anchoring, persistence (doc 07)                                                                    | WEB-02                 | All four control paths work; anchor preserved across a full L2→L0→L2 cycle                                                         |
| `WEB-04` | L0 canvas renderer + its parallel accessibility path                                                                                             | WEB-03                 | 5,000 pips < 300 ms; screen-reader summary present and tested                                                                      |
| `WEB-05` | Virtualised L1/L2 grids with per-level image sizing                                                                                              | WEB-03                 | 60 fps scroll on throttled mobile                                                                                                  |
| `WEB-06` | dnd-kit setup: pointer/touch/keyboard sensors, activation constraints, live-region announcements                                                 | UI-01                  | **Every drag has a working tap and keyboard equivalent** (doc 08 §8.2)                                                             |
| `WEB-07` | Mobile layout: bottom sheet with three detents, swipe accept/reject, gesture disambiguation (doc 08)                                             | WEB-06                 | Verified at 360 px; axis-lock prevents accidental accepts while scrolling                                                          |
| `WEB-08` | Re-grouping animation + reduced-motion equivalent (doc 06 §6.4)                                                                                  | WEB-05, DOM-03         | Accept → settled < 400 ms; reduced-motion path conveys the same information                                                        |
| `WEB-09` | Inspect panel / detail sheet with combo lines and reasons (doc 06 §6.5)                                                                          | WEB-01                 | Every recommendation renders its reasons; accept/exclude reachable without closing                                                 |
| `WEB-10` | Composition meters wired to deficit groups (doc 05 §5.4)                                                                                         | WEB-02, API-02         | Tapping a meter scrolls to the matching `fills-<role>` group                                                                       |
| `WEB-11` | Bracket selector, core package apply/remove with the change summary (doc 03 §3.3)                                                                | WEB-01, API-01         | Locked and manual entries provably survive a bracket change; single undo reverts the whole operation                               |
| `WEB-12` | Deck switcher: command-bar popover, `⌘K` fuzzy filter, `⌘1–9`, mobile sheet (doc 12 §12.3)                                                       | WEB-01, API-05         | Switch to interactive < 300 ms; opens without waiting on a request                                                                 |
| `WEB-13` | Deck library: grid/list, sort, filter, search, per-deck and bulk actions, empty state (doc 12 §12.4)                                             | WEB-01, API-05         | Works at 360 px; every action reachable by keyboard                                                                                |
| `WEB-14` | Deck creation flow: commander search, partner pairing, bracket pick, core-package offer (doc 12 §12.5)                                           | WEB-11, API-05         | Abandonable at every step; commander search filtered to legal commanders                                                           |
| `WEB-15` | Local-first persistence: IndexedDB replica, command queue, offline drain, `409` replay (doc 12 §12.7)                                            | WEB-01, API-06         | Deck fully editable offline; queue survives reload; conflict resolves without a modal                                              |
| `WEB-16` | Snapshot UI: automatic labels, manual creation, restore with preview (doc 12 §12.8)                                                              | WEB-01, API-07         | Bracket experiment can be fully reverted                                                                                           |
| `WEB-17` | Desktop query bar: chips ⇄ text, autocomplete with counts, raw-mode fallback for nested queries (doc 13 §13.4)                                   | WEB-02, DOM-08, API-08 | Chip edits and text edits round-trip; nested query drops to raw mode with a stated reason                                          |
| `WEB-18` | Mobile faceted filter sheet, live match count, active-filter chip row (doc 13 §13.5)                                                             | WEB-07, DOM-08         | Every field in doc 13 §13.2 reachable without typing syntax; count updates before Apply                                            |
| `WEB-19` | Withheld-by-filter footers and Accepted-region dim-not-hide highlight (doc 13 §13.1)                                                             | WEB-17                 | A filtered-out `combo-3plus` card is always reported, never silently absent                                                        |
| `WEB-20` | Archetype step in the creation flow: nine cards, suggested one preselected with its statistic, target-vector disclosure (doc 14 §14.6)           | WEB-14, API-09         | Suggestion reason always shown; `default` source stated as such                                                                    |
| `WEB-21` | Archetype switching with the non-destructive change summary, plus the assessed-archetype note (doc 14 §14.4–14.5)                                | WEB-20, API-02         | Switching provably adds and removes zero cards; assessment surfaces as a note, never auto-switches                                 |
| `WEB-22` | Import dialog: paste/upload, preview, in-place fixing of unresolved lines, illegal-card flagging, new-vs-merge (doc 15 §15.3)                    | WEB-13, API-04         | Nothing applies before the user confirms; a typo costs one line, never the paste; merge never resurrects an excluded card silently |
| `WEB-23` | Export panel: format picker, live preview, copy-first, always-visible lossiness notice; and the export-before-delete confirm (doc 15 §15.4–15.5) | WEB-13, API-04         | Copy is the primary action; text formats always state what they drop; delete states the 30-day window where the decision is made   |
| `WEB-24` | Import entry from the new-deck flow — paste a list, detect the commander, rejoin at the archetype step (doc 15 §15.1)                            | WEB-14, WEB-22         | Ambiguous commander asks rather than guessing                                                                                      |

## 11.7 Cross-cutting gates

| ID         | Task                                                                                                                                                                                                                                                                                                                                                                                                                                                        | DoD                                                            |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| `E2E-01`   | Playwright suite, desktop + mobile viewports, covering: build a deck from empty to 100, apply and partially dismantle a core package, exclude and confirm no re-suggestion, switch decks mid-edit and confirm nothing is lost, edit offline and reconcile, filter candidates by query on desktop and by facets on mobile, import a decklist with a deliberate typo and fix it in the preview, export and re-import as JSON and assert the deck is identical | Green in CI on both viewports                                  |
| `PERF-01`  | Budgets from doc 07 §7.3 and doc 08 §8.5 enforced in CI                                                                                                                                                                                                                                                                                                                                                                                                     | Regressions fail the build, not a dashboard                    |
| `A11Y-01`  | Automated axe pass + a manual screen-reader script for both drag and tap paths                                                                                                                                                                                                                                                                                                                                                                              | Zero critical violations; manual script documented and passing |
| `LEGAL-01` | Fan Content Policy compliance, attribution surfaces, name clearance (doc 04 §4.6)                                                                                                                                                                                                                                                                                                                                                                           | Reviewed and signed off **before any public deployment**       |

## 11.8 What to pick up next

The domain layer is done, so everything below is now unblocked in its own right.

**Needs a browser, not a compiler — and blocks deployment of all ingestion:**

1. ~~`DATA-01`, `DATA-02`, `DATA-05`~~ — the terms questions in
   [ADR-0006](adr/0006-data-source-terms-verification.md) are answered.
   `DATA-05` is closed by [ADR-0018](adr/0018-bracket-rules-and-game-changers.md):
   the Game Changers allowance is fetched and enforced, the four barometers
   Wizards no longer publishes stay null, and the list itself comes from the
   corpus. `DATA-03` is **closed** and `ING-03` **cut** — the project does not
   query EDHREC ([ADR-0008](adr/0008-drop-edhrec.md)). Scryfall Q4 (image
   **serving**) is the one question still open, and it gates `ING-04` alone —
   card art itself is on screen without it
   ([ADR-0021](adr/0021-card-art-from-scryfalls-cdn.md)), which changes what is
   urgent about the question but not what the question is.

**Needs infrastructure:**

2. ~~`DB-01`~~ and ~~`API-01`~~ are done. `API-02` is the next one that matters:
   recommendations and analysis, on the transport `API-01` established.
3. `ING-01`, `ING-02` — Scryfall and Spellbook ingest, once `DATA-01`/`02` land.
4. `ING-05` — core packages from MTGJSON's official decklists plus curation.

**Needs a frontend toolchain:**

5. `FOUND-02` → `UI-01` — design tokens and the four card representations.
   `WEB-01` also converts `apps/web` from `tsc` to Vite.
6. `WEB-02` onward — the workspace, per docs 06–08.

**Worth doing regardless:**

7. Grow `DOM-04`'s curated role-override table and build the 300-card labelled
   fixture set its DoD asks for. That needs real Scryfall data, so it follows
   `ING-01` — the engine and its pattern tests are already in place.

## 11.9 Scoped, not built

| Doc | What it is |
| --- | --- |
| [17 — The deck web](17-deck-web.md) | A second view of one deck at `#web`: every card as its art, every relationship as a coloured line. **Built.** Density is the whole problem — a real themed 99 has 712 benefits edges and 689 combos one card away — and the scoped reduction rules turned out to reduce almost nothing, so edges are ranked by tag scarcity and cut at 400. Two edge kinds ship, not four: theme and near-combo were cut when the three open questions were answered, with numbers, in §17.10. §17.12 records where the build diverged. |

[Doc 16, the archetype customiser](16-archetype-customiser.md), was in this table
and is now **built** — roles, curve and tolerance, all three of its open
questions answered in §16.9 and its four divergences from the design recorded in
§16.10.

## 11.10 UI-01: a gallery instead of Storybook

The DoD said "Storybook entries". It shipped as a page at `#gallery` and a test
file per primitive, which is that DoD split into the two things it was asking
for and each given to the tool that does it properly.

Storybook asserts nothing. The half of the DoD that matters — "each meets its
size and a11y requirements" — is a set of claims, and claims belong in tests:
the L0 pip is held to doc 07's 6–10 px, the mobile widths are *recomputed* from
doc 08's column counts rather than restated, every tile keeps a 44 px hit area
however small a caller draws it, and both Enter and Space activate every
interactive surface. Storybook would have watched all of that rot.

What Storybook would still have given is somewhere a human can look at a
primitive without building a deck first. That is a page, and it costs one file
instead of forty packages. It renders the fixtures that break things rather
than pretty ones: a card with no art, one with no price, a name too long for the
strip, and a recommendation with an empty `reasons` list — which draws the P4
violation in rust, on screen, where it cannot be ignored.

Looking at that page immediately paid for itself. The combo badge was
`position: absolute` unconditionally; at L2, where it sits in a flow row rather
than over an image, it flew to the corner of the document — missing from the row
and adding a page-wide horizontal scroll. A second pass found two classes with
no CSS rule at all. Both now have tests, and one of them (`card.css.test.ts`)
checks the whole class of defect: every `rt-` class the components render must
have a rule, and no colour may be written as a literal hex instead of a token.

## 11.11 API-03 is no longer on the critical path

ADR-0014 replaced deck ownership with a device id: the browser generates a uuid
into `localStorage` and sends it as `X-Device-Id`, and there is nothing to sign
in to. `API-03` becomes optional work — "sign in to sync across devices" —
layered on top rather than underneath, and the task it was blocking (deployment)
is unblocked. See `DEPLOYING.md`.
