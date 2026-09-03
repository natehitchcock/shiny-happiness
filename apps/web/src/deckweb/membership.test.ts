import { describe, expect, it } from 'vitest'
import { buildDeckWeb } from './model'
import type { BuildInput, WebCard } from './model'

/**
 * Membership in the deck web (ADR-0053).
 *
 * The web declared `synergyProduces` and `synergyWants` on its card type when
 * the model had three directions, so on a finished Elf deck every one of the
 * fifty edges mentioning Elves was "causes Elves" — the token makers — and the
 * fifty-three cards that simply ARE Elves drew no tribal edge at all. The
 * graph of an Elf deck showed everything except the tribe.
 *
 * Three decisions are pinned here, and each was measured on a real 60-card Elf
 * deck out of the corpus before it was written down:
 *
 *  1. `has → wants` IS an edge. It is the pairing `synergyMatches` already
 *     scores, and the graph disagreeing with the scorer was the bug.
 *  2. `has ↔ has` is NOT an edge. On that deck it is exactly K60 — 1,770 edges
 *     on sixty nodes, all saying one word — and it says nothing the drawn
 *     graph does not, because every Elf reaches every other through a lord.
 *  3. An edge whose tag both its endpoints already carry is not drawn. Without
 *     that rule the deck went from 173 connections to 820, of which 735 were
 *     `subtype:elf`, and the 400 ceiling then chose an arbitrary 315 of them
 *     by `localeCompare`.
 */

const card = (id: string, over: Partial<Omit<WebCard, 'oracleId' | 'name'>> = {}): WebCard => ({
  oracleId: id,
  name: `Card ${id}`,
  synergyProduces: over.synergyProduces ?? [],
  synergyWants: over.synergyWants ?? [],
  ...(over.synergyHas === undefined ? {} : { synergyHas: over.synergyHas }),
})

const build = (over: Partial<BuildInput> & { cards: readonly WebCard[] }) => {
  const cards = new Map(over.cards.map((c) => [c.oracleId, c]))
  return buildDeckWeb({
    order: over.order ?? over.cards.map((c) => c.oracleId),
    accepted: over.accepted ?? over.cards.map((c) => c.oracleId),
    commanders: over.commanders ?? [],
    cards,
    combos: over.combos ?? [],
    ...(over.ceiling === undefined ? {} : { ceiling: over.ceiling }),
  })
}

describe('membership supplies a tag', () => {
  it('draws an edge from a card that IS the thing to a card that wants it', () => {
    // Elvish Mystic causes nothing and wants nothing; it is an Elf. Elvish
    // Archdruid — "Other Elf creatures you control get +1/+1" — wants Elves.
    const web = build({
      cards: [
        card('mystic', { synergyHas: ['subtype:elf'] }),
        card('archdruid', { synergyWants: ['subtype:elf'], synergyHas: ['subtype:elf'] }),
      ],
    })
    expect(web.edges).toHaveLength(1)
    expect(web.edges[0]?.from).toBe('mystic')
    expect(web.edges[0]?.to).toBe('archdruid')
    expect(web.edges[0]?.tags).toEqual(['subtype:elf'])
  })

  it('says the card IS one rather than that it causes them', () => {
    const web = build({
      cards: [
        card('mystic', { synergyHas: ['subtype:elf'] }),
        card('archdruid', { synergyWants: ['subtype:elf'] }),
      ],
    })
    // "Card mystic causes Elves" would be false, and the distinction between
    // being an Elf and making one is the entire reason `has` exists.
    expect(web.edges[0]?.why).toBe(
      'Card mystic is one of your Elves; Card archdruid benefits from it.',
    )
  })

  it('says "has" for a keyword and "is one of your" for a subtype', () => {
    const web = build({
      cards: [
        card('crow', { synergyHas: ['ability:flying'] }),
        card('winds', { synergyWants: ['ability:flying'] }),
      ],
    })
    // "Is an Elf" and "has flying" are not the same sentence (ADR-0048), and
    // the split is the tag's own prefix so nothing is stored to support it.
    expect(web.edges[0]?.why).toBe('Card crow has flying; Card winds benefits from it.')
  })

  it('prefers the more specific claim when a card both is and makes one', () => {
    // Imperious Perfect is an Elf AND creates Elf tokens. "Causes" is the
    // narrower claim, so it wins; saying both would be one clause too many.
    const web = build({
      cards: [
        card('perfect', { synergyProduces: ['subtype:elf'], synergyHas: ['subtype:elf'] }),
        card('lord', { synergyWants: ['subtype:elf'] }),
      ],
    })
    expect(web.edges[0]?.why).toBe('Card perfect causes Elves; Card lord benefits from it.')
  })

  it('joins the two clauses when one edge carries both kinds of supply', () => {
    const web = build({
      cards: [
        card('ranger', { synergyProduces: ['untap'], synergyHas: ['subtype:elf'] }),
        card('lord', { synergyWants: ['subtype:elf', 'untap'] }),
      ],
    })
    expect(web.edges[0]?.why).toBe(
      'Card ranger is one of your Elves and causes untapping; Card lord benefits from it.',
    )
  })
})

describe('two Elves are not an edge', () => {
  it('draws nothing between cards that only share what they are', () => {
    /*
     * ADR-0048 refuses `has ↔ has` in the SCORER because two Elves are
     * redundancy. ADR-0053 refuses it in the GRAPH for a reason the scorer
     * never had to weigh: it is the complete graph. Sixty Elves is K60, 1,770
     * edges on sixty nodes, 4.4 times the ceiling, every one of them the same
     * word — and it adds no reachability, because both Elves already reach
     * each other through any card that wants the tribe.
     */
    const web = build({
      cards: [
        card('mystic', { synergyHas: ['subtype:elf'] }),
        card('llanowar', { synergyHas: ['subtype:elf'] }),
        card('fyndhorn', { synergyHas: ['subtype:elf'] }),
      ],
    })
    expect(web.edges).toEqual([])
    expect(web.totalEdges).toBe(0)
    expect(web.isolated).toEqual(['mystic', 'llanowar', 'fyndhorn'])
  })

  it('draws nothing between a card that is one and a card that makes one', () => {
    // `has ↔ produces` is refused on the ADR's own ground: an Elf beside an
    // Elf-token maker is two copies of one effect, not a synergy.
    const web = build({
      cards: [
        card('mystic', { synergyHas: ['subtype:elf'] }),
        card('maker', { synergyProduces: ['subtype:elf'] }),
      ],
    })
    expect(web.edges).toEqual([])
  })
})

describe('an edge has to tell a card something new', () => {
  it('does not draw a pair whose tag both ends already carry', () => {
    /*
     * The measured shape of a tribal deck: many suppliers, several wanters,
     * and a near-complete bipartite blob between them. One lord and three
     * Elves is 3 edges; adding a second lord would be 6, a third 9, and the
     * real deck reached 735. The reader learns that a card takes part in the
     * relation, which one edge says; the rest is a count, and the count is
     * stated above the graph rather than drawn.
     */
    const web = build({
      cards: [
        card('elf1', { synergyHas: ['subtype:elf'] }),
        card('elf2', { synergyHas: ['subtype:elf'] }),
        card('elf3', { synergyHas: ['subtype:elf'] }),
        card('lordA', { synergyWants: ['subtype:elf'] }),
        card('lordB', { synergyWants: ['subtype:elf'] }),
      ],
    })
    // Six pairs exist and four are drawn: three carry an Elf into the relation
    // for the first time, and the fourth is the one that first reaches lordB.
    // The other two say only that a card already in the relation is in it.
    expect(web.totalEdges).toBe(6)
    expect(web.edges).toHaveLength(4)
    // Nothing is left sitting in the deck untouched, which is the readout the
    // whole view exists to answer (doc 17 §17.1).
    expect(web.isolated).toEqual([])
  })

  it('never drops a combo edge to the coverage rule', () => {
    /*
     * A THREE-piece combo, which is the shape that reaches the exemption at
     * all. Its three pairwise edges all carry the same `produces`, so by the
     * third one both endpoints already hold the tag and the coverage rule
     * would drop it — leaving a combo drawn as a broken triangle. There are
     * three combos in a real deck and they are the answer to the question the
     * view exists to ask, so they are exempt one step earlier than rule 5's
     * existing exemption for them.
     */
    const web = build({
      cards: [card('a'), card('b'), card('c')],
      combos: [{ comboId: 'c1', pieces: ['a', 'b', 'c'], produces: ['infinite mana'] }],
    })
    expect(web.edges).toHaveLength(3)
    expect(web.edges.every((e) => e.kind === 'combo')).toBe(true)
  })

  it('does not let a combo edge stop a benefits edge from being news', () => {
    // The exemption is one-way: a combo edge is always drawn, and it does not
    // claim its tags on behalf of the cards it touches either.
    const web = build({
      cards: [
        card('a', { synergyHas: ['subtype:elf'] }),
        card('b', { synergyWants: ['subtype:elf'] }),
      ],
      combos: [{ comboId: 'c1', pieces: ['a', 'b'], produces: ['a win'] }],
    })
    // Rule 2 still applies: one kind per pair, and combo is the stronger claim.
    expect(web.edges).toHaveLength(1)
    expect(web.edges[0]?.kind).toBe('combo')
  })

  it('cuts the same edges however the cards arrived', () => {
    // Every tribal edge ties on score, so the coverage walk decides content
    // and not just order. It has to be stable for the same reason §17.5 makes
    // the ceiling stable: a graph that redraws differently on a reload is the
    // failure the rule exists to prevent.
    const many = [
      ...Array.from({ length: 8 }, (_, i) =>
        card(`e${String(i)}`, { synergyHas: ['subtype:elf'] }),
      ),
      ...Array.from({ length: 3 }, (_, i) =>
        card(`l${String(i)}`, { synergyWants: ['subtype:elf'] }),
      ),
    ]
    const forwards = build({ cards: many })
    const backwards = build({ cards: [...many].reverse(), order: many.map((c) => c.oracleId) })
    expect(backwards.edges.map((e) => `${e.from}->${e.to}`)).toEqual(
      forwards.edges.map((e) => `${e.from}->${e.to}`),
    )
  })
})

describe('scarcity counts every supplier', () => {
  it('ranks a tag by how many cards supply it, not how many produce it', () => {
    /*
     * The bug this pins: in the measured Elf deck four cards PRODUCE
     * `subtype:elf` and sixty supply it, so a denominator that counted only
     * producers scored every tribal edge at 1/4 and put it fifteen times above
     * a genuinely rare engine. Here the tribe is supplied by five cards and
     * `landfall` by one, so the landfall edge must sort first — and it does not
     * if the denominator ignores `has`.
     *
     * The Elves are named to sort BEFORE `rare` on purpose. Counting producers
     * only gives `subtype:elf` zero of them, which falls to the `?? 1` floor
     * and TIES with `landfall`; the id tie-break then decides the order alone,
     * so a fixture whose ids happened to favour `rare` would pass either way
     * and pin nothing. Verified by mutation: it did exactly that.
     */
    const cards = [
      ...Array.from({ length: 5 }, (_, i) =>
        card(`a${String(i)}`, { synergyHas: ['subtype:elf'] }),
      ),
      card('rare', { synergyProduces: ['landfall'] }),
      card('wanter', { synergyWants: ['subtype:elf', 'landfall'] }),
    ]
    const web = build({ cards })
    expect(web.edges[0]?.from).toBe('rare')
    expect(web.edges[0]?.tags).toEqual(['landfall'])
  })
})
