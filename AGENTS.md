# Rules for implementing agents

Read this before writing any code. It is the operating contract for everyone
working on this repository, human or agent.

This file is also symlinked/mirrored as `CLAUDE.md` so Claude Code picks it up
automatically.

---

## 1. Before you start

1. Read [docs/01-vision-and-pillars.md](docs/01-vision-and-pillars.md). The six
   pillars are binding.
2. Read the doc your task references, and [docs/02-domain-model.md](docs/02-domain-model.md)
   regardless of task.
3. Find your task in [docs/11-work-breakdown.md](docs/11-work-breakdown.md). Work
   **only** that task's scope. Do not opportunistically refactor files another
   task owns — you will collide with an agent you cannot see.
4. If your task's dependencies are not merged yet, stop and say so. Do not stub
   another task's work to unblock yourself; stubs get forgotten and shipped.

## 2. The four rules that keep parallel work from breaking

### R1 — `packages/domain` is pure

No `fetch`, no database, no filesystem, no `Date.now()`, no `Math.random()`, no
environment access. Types and deterministic functions only. Non-determinism is
injected by the caller (pass a clock, pass a seed).

Why: `web` and `api` both run this code and must agree exactly (doc 09 §9.4), and
purity is what lets domain tasks proceed with no infrastructure.

### R2 — Contract changes need an ADR

Changing an exported type in `packages/domain`, or any shape in
[docs/10-api-contract.md](docs/10-api-contract.md), blocks other agents. Write an
ADR in `docs/adr/`, get it merged, then change the code. Adding a new optional
field is not a contract change; changing or removing an existing one is.

### R3 — All third-party network access goes through `packages/clients`

No exceptions. One shared rate limiter, one cache, one place to fix things when a
source changes its terms. See [docs/04-data-sources.md](docs/04-data-sources.md) §4.0.

### R4 — Every drag has a tap and a keyboard equivalent

Pillar P1. A PR that adds a drag interaction without both equivalents is
incomplete, not "accessible later". See [docs/ux/08-mobile.md](docs/ux/08-mobile.md) §8.2.

## 3. Definition of done

A task is done when **all** of these hold. Not most.

- [ ] The task's specific DoD in doc 11 is met.
- [ ] `pnpm lint && pnpm typecheck && pnpm test` pass locally.
- [ ] New logic has unit tests. Domain logic has tests for degenerate and
      boundary inputs, not just the happy path.
- [ ] No `any`, no `@ts-expect-error` without an adjacent comment explaining why.
- [ ] No network access in tests. Third-party responses come from recorded
      fixtures in `packages/clients/fixtures/`.
- [ ] UI work: keyboard-operable, screen-reader-labelled, tested at 360 px width,
      works in light and dark, honours `prefers-reduced-motion`.
- [ ] Performance budgets in doc 07 §7.3 / doc 08 §8.5 not regressed.
- [ ] Docs updated if behaviour diverged from the spec — **the spec is not
      sacred, but silent divergence is forbidden.** If the spec is wrong, change
      the spec in the same PR and say why.

## 4. Testing

| Layer | Approach |
| --- | --- |
| `packages/domain` | Pure unit tests. Property-based tests for `comboDegree` and incremental patching (`DOM-03`) |
| `packages/clients` | Contract tests against recorded fixtures. Never live |
| `apps/api` | Integration tests against a real Postgres in a container |
| `apps/web` | Component tests (Vitest + Testing Library); interactions via user-facing queries, not test ids where a role/label exists |
| E2E | Playwright, desktop **and** mobile viewport, per `E2E-01` |

**Fixtures over mocks** for anything shaped like real data. A hand-written mock
card teaches you nothing about the seventeen ways real Scryfall data is weird
(split cards, MDFCs, adventures, meld, reversible cards, un-cards, tokens,
Alchemy rebalances). Use recorded fixtures and include the weird ones deliberately.

**Never write a test that asserts current-but-wrong behaviour to get green.** If
something is broken and out of your scope, leave it failing and say so in the PR.

## 5. Data handling

- **Never commit bulk card data, combo dumps, or card images.** They are large,
  they are not ours to redistribute, and they go stale. Fixtures are small,
  hand-picked subsets and are the only card data in git.
- Respect every rate limit in doc 04. The shared limiter is not optional and must
  not be bypassed "just for a script".
- Do not add a new third-party data source without an ADR covering its terms.
- Moxfield is out of scope (doc 04 §4.4). If you think you need it, the answer is
  the decklist text importer.

## 6. Git and PRs

- Branch per task: `<task-id>-short-description`, e.g. `DOM-02-combo-degree`.
- Conventional commits: `feat(domain): compute combo degree`.
- One task per PR. A PR touching three tasks' scopes cannot be reviewed or
  reverted cleanly.
- PR description states: task id, what changed, how it was verified, and any spec
  divergence.
- Do not merge with red CI. Do not skip, disable or quarantine a test to get green.

## 7. Code conventions

- TypeScript strict. Branded types for ids (doc 02 §2.1) — a bare `string` id is
  a bug waiting to be a wrong lookup.
- Discriminated unions over boolean flags. Exhaustive `switch` with a `never`
  default so adding a variant is a compile error everywhere it matters.
- Errors: typed results at package boundaries (`Result<T, E>`), thrown exceptions
  only for programmer error.
- Name things as the domain names them: `oracleId` not `cardId`, `manaValue` not
  `cmc` in our own code (map at the Scryfall boundary), `commander` not `general`.
- Comments explain *why*. The code says what.

## 8. Things that will get a PR rejected

- Drag-only interactions (R4).
- IO in `packages/domain` (R1).
- Direct `fetch` to a third party outside `packages/clients` (R3).
- Hardcoded bracket allowances or Game Changer card names — read them from
  `brackets/rules.data.json` (doc 03 §3.2).
- Bulk card data or images committed to git.
- A recommendation path that can emit a card with empty `reasons` (pillar P4).
- Silently dropping data on ingest — unmapped combo cards must fail loudly
  (doc 04 §4.2).
- Filtering candidates by bracket instead of flagging them (doc 03 §3.2). The user
  is allowed to cross their own line knowingly.
- Re-suggesting an excluded card (pillar P6).

## 9. When the spec is wrong

It will be. It was written before the code.

Say so, propose the change, and change the doc in the same PR as the code. What is
forbidden is building something different from the spec and leaving the spec
standing — the next agent will read it and build against a fiction.

For anything with lasting consequences, write an ADR. Cheap to write, and the
reason behind a decision is the thing that always gets lost.
