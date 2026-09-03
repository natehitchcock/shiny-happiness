# 53. The graph draws what a card IS, but not that two cards are alike

Date: 2026-09-02

## Status

Accepted. Answers a question [ADR-0048](0048-membership-is-a-third-direction.md)
deliberately left open, and adjusts doc 17 §17.4 rule 5.

> **Number 0053 is taken by this ADR.** The next agent should take 0054.

## Context

ADR-0048 added a third direction and ruled on how it SCORES:

> `has ↔ has` is **not** scored, for the same reason `produces ↔ produces` is
> not: two Elves are redundancy, not synergy.

`apps/web/src/deckweb/model.ts` never learned any of it. Its `WebCard` declared
`synergyProduces` and `synergyWants`, and its benefits edge is
`from.synergyProduces ∩ to.synergyWants`, so the deck web saw two of the three
arrays.

Measured on a 60-card Elf deck built out of the corpus, every card an Elf:

| | |
| --- | --- |
| connections drawn | 173 |
| cards connected to nothing | 11 |
| edges whose tag is `subtype:elf` | 40, **every one of them "causes Elves"** |

The forty are the token makers. **The sixty cards that simply ARE Elves drew no
tribal edge**, so the graph of an Elf deck showed everything except the tribe —
Elvish Archdruid, whose entire text is "Other Elf creatures you control get
+1/+1", sat in it as an isolate.

Whether the graph should also draw `has ↔ has` is a **different question from
the one ADR-0048 answered**. The scorer is deciding what to recommend; the graph
is answering doc 17 §17.1's "what is just sitting in it". A card can be dead
weight for recommendation purposes and still be the reason the deck exists.

## Decision

### 1. `has → wants` is an edge

Not a new judgement — it is the pairing `synergyMatches` already scores, and doc
17 §17.4 already calls a benefits edge "the card that supplies the event → the
card that gains". `has` is a third way of supplying, so it joins `produces` on
the supply side of both halves. The graph disagreeing with the scorer about what
pairs with what was the bug, not a design.

### 2. `has ↔ has` is NOT an edge, and the reason is arithmetic

ADR-0048's redundancy argument is accepted and is not repeated here. What the
graph adds is a measurement the scorer never had to make:

**On the Elf deck, `has ↔ has` is the complete graph.** Every one of the sixty
cards is an Elf, so every pair shares a tag: **C(60,2) = 1,770 edges on sixty
nodes**, 4.4× the drawing ceiling, every one of them the same word. A 99-card
tribal deck with 53 Elves is 1,378 before anything else is drawn.

And it would say nothing the graph does not already say. Every Elf reaches every
other Elf **in two hops** through any card that wants the tribe, so the tribe is
one visible cluster whether or not its interior is drawn. K60 buys no
reachability; it buys ink.

### 3. An edge has to tell one of its two cards something new

This is the part that needed inventing, and it is what stops the hairball.

`has → wants` on its own is unusable. Measured on the same deck:

| | edges | `subtype:elf` share |
| --- | --- | --- |
| before | 173 | 40 (23%) |
| `has → wants`, unbounded | **820** | **735 (90%)** |

Sixty Elves against fourteen cards that want the tribe is a near-complete
bipartite blob, and it draws like one — it was rendered at a raised ceiling and
is a solid ball of lines.

Worse than dense, **the existing ceiling's answer to it is arbitrary**. All 735
tribal edges score exactly `1/60`, so which 315 survive to fill the 400 is
settled by `localeCompare` on an oracle id. A reader shown 315 of 735 is being
told that some Elves are connected and others are not, which is false. Content
chosen by a tie-break is the failure §17.5 already refuses for layout.

So: **an edge is drawn only if at least one of its endpoints does not already
have an edge carrying that tag.** Walked in scarcity order, so the scarcest
claim about a card is the one that gets drawn.

What it means, said plainly: *the graph shows that a card takes part in a
relation; it does not draw every pair in that relation.* The rest is a count,
and the count is stated above the graph rather than drawn.

It self-tunes, which is why it needs no new constant beside the ceiling:

| relation | pairs | drawn |
| --- | --- | --- |
| 3 cards, one supplier | 2 | 2 |
| `untap` on the Elf deck | 73 directed | 25 |
| `subtype:elf` on the Elf deck | 735 | 64 |
| K40 of one tag (`DeckWeb.test.tsx`) | 780 | 39 |

(The two Elf-deck rows are counted off the rendered table view, where an edge
naming more than one tag is counted under each of them.)

Combo edges are exempt, one step earlier than rule 5's existing exemption for
them: there are three in a real deck and they are the answer to the question the
view exists to ask.

### 4. Scarcity's denominator counts suppliers, not producers

Independent of the above and a bug on its own terms. `scarcity` weighted a tag
by `1 / (cards producing it)`. On the Elf deck **four cards produce
`subtype:elf` and sixty supply it**, so every tribal edge scored `1/4` and
outranked a genuinely rare engine fifteen times over. The denominator has to
count the same set the numerator draws from, or the ranking measures one
relation and orders another.

### 5. Membership gets its own clause in the sentence

"Elvish Mystic causes Elves" is false, and the distinction between being an Elf
and making one is the entire reason the third direction exists. The `why` string
— which the table view of §17.7 prints verbatim — splits on the tag's own prefix,
exactly as the card panel's rows do:

> Quirion Ranger **is one of your Elves** and **causes untapping**; Elvish
> Harbinger benefits from it.

A tag a card both produces and has counts as produced, because that is the more
specific claim. The mutual sentence changed from "each **cause** something the
other benefits from" to "each **supply**", because one half of a mutual pair may
now be supplying by being rather than by doing.

## Consequences

The same deck, before and after:

| | before | after |
| --- | --- | --- |
| connections drawn | 173 | **95** |
| connections found | 173 | **820** |
| cards connected to nothing | **11** | **0** |
| edges naming the tribe | 40, all "causes" | 47, mostly "is one of your" |

Fewer lines and more truth: every card in the deck is now attached to the thing
that makes it a deck, and the eleven that were "just sitting in it" were an
artefact of reading two arrays out of three.

- **`totalEdges` keeps counting everything found**, not what survived the
  coverage rule. "Showing 95 of 820" is the honest readout, and shrinking the
  denominator to make the fraction look better would hide exactly the fact a
  tribal deck's reader most wants — that the tribe is 735 connections wide.
- **One existing expectation changed rather than broke.** `DeckWeb.test.tsx`
  asserted "Showing 400 of 780" for forty cards that all produce and want
  `token`. The claim under test — the count line tells the truth about what was
  dropped — is unchanged; the number is 39 now, and the 400 it used to print was
  400 arbitrary members of one tie.
- **No migration and no re-ingest.** `synergyHas` is derived in `toCard`
  (ADR-0048), so it is already on every hydrated card the workspace holds; the
  deck web's card type simply had to declare it. Doc 17 §17.2's argument against
  a `/decks/:id/web` endpoint still holds.
- **Rejected: raising the ceiling.** Tried and rendered. 820 edges on 60 nodes
  is a ball, and the ceiling was never the thing that was wrong.
- **Rejected: an all-or-nothing per-tag drop.** It is deterministic and it never
  draws an arbitrary subset, which is the same two virtues, but on this deck it
  drops `subtype:elf` entirely and puts the graph back where it started —
  showing everything except the tribe, with a footnote.
