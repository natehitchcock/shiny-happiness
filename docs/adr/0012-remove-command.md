# ADR-0012: A `remove` command, distinct from `exclude`

- **Status:** Accepted
- **Date:** 2026-08-30

## Context

Doc 10 §10.3's command language has no way to say "I want fewer of these."

`exclude` removes every accepted copy AND records the card as excluded, which
pillar P6 then treats as permanent: the recommender may never suggest it again.
That is right for rejecting a suggestion. It is wrong for adjusting a count.

The case that exposed it is basic lands. A deck runs 34 Mountains; taking it to
33 is an ordinary edit. Expressed with `exclude` it would delete all 34 and ban
Mountain from the deck forever. There is no combination of existing commands that
does the right thing — `exclude` then `restore` then 33 × `accept` both destroys
the entries' `addedAt` and origins and passes through a state where the deck is
briefly wrong.

The persistence layer has had the right primitive since `DB-01`:
`removeEntry` deletes exactly one accepted copy, with a comment explaining that an
unqualified delete would take all 34. Only the command language could not reach it.

## Decision

Add a seventh command:

```ts
| { readonly type: 'remove'; readonly oracleId: OracleId }
```

**Removes ONE accepted copy. Records nothing.** The card stays a candidate and may
be suggested again — that is the entire difference from `exclude`, and it is why
this is a separate verb rather than a flag on the existing one. Rejected with
`not-in-deck` when no accepted copy exists.

The three verbs now cover the three distinct intents, which is what the language
was missing:

| Verb | Copies | Suggestible again? |
| --- | --- | --- |
| `remove` | one | yes — this is an amount, not a judgement |
| `exclude` | all | no (pillar P6) |
| `restore` | — | lifts an exclusion |

## Consequences

- **Contract change (AGENTS.md R2).** A new variant on `DeckCommand`. Exhaustive
  switches over it become compile errors until updated, which is the point.
- The UI gains a distinction it has to honour: a count control decrements with
  `remove`, while the deck rail's "Remove" button keeps using `exclude`, because
  there the user is rejecting a card rather than adjusting an amount. Two
  different intents that happened to share a word.
- `applyCommands` stays the only place that decides; the API still replaces the
  computed entry list, so no persistence change is needed.
- Doc 10 §10.3's command list is updated in the same change, since a command the
  contract does not mention is a contract that lies.
