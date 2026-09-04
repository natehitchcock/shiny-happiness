import { describe, expect, it } from 'vitest'
import { buildDeckWeb, edgesAt, otherEnd, strokeWidth } from './model'
import type { BuildInput, WebCard } from './model'

/**
 * The edge model (doc 17 §17.3, §17.4).
 *
 * Every claim the picture makes is made here first, so these are the tests that
 * decide whether the graph is telling the truth. The rendering tests check that
 * a line appeared; these check that it should have.
 */

const card = (id: string, produces: string[] = [], wants: string[] = []): WebCard => ({
  oracleId: id,
  name: `Card ${id}`,
  synergyProduces: produces,
  synergyWants: wants,
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

describe('nodes', () => {
  it('draws one node per distinct card, with the count on it', () => {
    // Doc 17 §17.2 says one node per accepted entry. Taken literally that is
    // thirty pictures of the same Swamp, none of which can ever touch an edge.
    const web = build({
      cards: [card('swamp'), card('sol')],
      accepted: [...Array<string>(30).fill('swamp'), 'sol'],
    })
    expect(web.nodes).toHaveLength(2)
    expect(web.nodes.find((n) => n.oracleId === 'swamp')?.copies).toBe(30)
    expect(web.nodes.find((n) => n.oracleId === 'sol')?.copies).toBe(1)
  })

  it('puts commanders first and everything else in the order the rail lists it', () => {
    const web = build({
      cards: [card('a'), card('b'), card('boss')],
      order: ['a', 'b', 'boss'],
      accepted: ['a', 'b'],
      commanders: ['boss'],
    })
    expect(web.nodes.map((n) => n.oracleId)).toEqual(['boss', 'a', 'b'])
    expect(web.nodes[0]?.commander).toBe(true)
  })

  it('draws a commander that is not also an accepted entry', () => {
    const web = build({ cards: [card('boss')], accepted: [], commanders: ['boss'] })
    expect(web.nodes.map((n) => n.oracleId)).toEqual(['boss'])
  })

  it('appends cards the order forgot, by name, rather than dropping them', () => {
    const web = build({ cards: [card('z'), card('a')], order: ['z'] })
    expect(web.nodes.map((n) => n.oracleId)).toEqual(['z', 'a'])
  })

  it('does not draw a card that is not hydrated yet', () => {
    // Art and names arrive with hydration; a node with neither is a grey box
    // claiming to be a card nobody can identify.
    const web = build({ cards: [card('a')], accepted: ['a', 'not-hydrated'] })
    expect(web.nodes.map((n) => n.oracleId)).toEqual(['a'])
  })

  it('survives an empty deck', () => {
    const web = build({ cards: [] })
    expect(web).toMatchObject({ nodes: [], edges: [], totalEdges: 0, isolated: [] })
  })
})

/*
 * THE QUALIFIER, ON THE SURFACE THAT STATES THE CLAIM MOST EXPLICITLY.
 *
 * ADR-0057 §11 said "both production callers pass it" and there were four. This
 * one intersected the tag arrays by hand, so the table printed, verbatim:
 *
 *   "Pongify causes casting spells; Y'shtola, Night's Blessed benefits from it."
 *
 * Pongify is mana value 1 and Y'shtola needs a noncreature spell costing three
 * or more. 8 false edges into her on the real deck, and 21 into Brinelin, out
 * of 26 in-deck suppliers.
 *
 * Real oracle text on both sides, because the qualifier is READ from it: a
 * hand-written tag array cannot exercise this and that is exactly how it got
 * shipped.
 */
describe('benefits edges honour a want qualifier', () => {
  const YSHTOLA: WebCard = {
    oracleId: 'yshtola',
    name: "Y'shtola, Night's Blessed",
    synergyProduces: [],
    synergyWants: ['spell-cast'],
    manaValue: 3,
    types: ['creature'],
    colors: ['W', 'B'],
    oracleText:
      'Vigilance\nWhenever you cast a noncreature spell with mana value 3 or greater, ' +
      "Y'shtola deals 2 damage to each opponent and you gain 2 life.",
  }
  const spell = (id: string, name: string, manaValue: number): WebCard => ({
    oracleId: id,
    name,
    synergyProduces: ['spell-cast'],
    synergyWants: [],
    manaValue,
    types: ['instant'],
    colors: ['U'],
    oracleText: 'Destroy target creature. Its controller creates a 3/3 green Ape creature token.',
  })

  it('draws no edge from a spell the wanter cannot be turned on by', () => {
    const web = build({ cards: [spell('pongify', 'Pongify', 1), YSHTOLA] })
    expect(web.edges).toEqual([])
    expect(web.isolated).toContain('yshtola')
  })

  it('still draws the edge from a spell that does satisfy the qualifier', () => {
    const web = build({ cards: [spell('storm', 'Comet Storm', 4), YSHTOLA] })
    expect(web.edges).toHaveLength(1)
    expect(web.edges[0]).toMatchObject({ kind: 'benefits', from: 'storm', to: 'yshtola' })
  })

  /*
   * The fallback ADR-0057 states and this caller must keep: a card built
   * without the facts is answered unqualified, which is over-inclusive and
   * never wrongly silent. Every other test in this file builds cards that way.
   */
  it('answers unqualified when the supplier carries no facts', () => {
    const web = build({ cards: [card('bare', ['spell-cast']), YSHTOLA] })
    expect(web.edges).toHaveLength(1)
  })

  /*
   * ALL THREE OR NONE, which is the degenerate input the fallback is for.
   * A supplier carrying `manaValue` and `types` but no `colors` must be
   * answered unqualified: reading the missing array as `[]` claims the card is
   * colourless, and a colourless card fails every colour qualifier there is.
   * The edge into Quirion Dryad would vanish rather than be over-drawn, which
   * is the one direction ADR-0057 says this may never fail in.
   */
  it('does not read a missing colors array as colourless', () => {
    const dryad: WebCard = {
      oracleId: 'dryad',
      name: 'Quirion Dryad',
      synergyProduces: [],
      synergyWants: ['spell-cast'],
      manaValue: 2,
      types: ['creature'],
      colors: ['G'],
      oracleText:
        "Whenever you cast a spell that's white, blue, black, or red, " +
        'put a +1/+1 counter on this creature.',
    }
    const halfKnown: WebCard = {
      oracleId: 'half',
      name: 'Half-known Spell',
      synergyProduces: ['spell-cast'],
      synergyWants: [],
      manaValue: 2,
      types: ['instant'],
    }
    expect(build({ cards: [halfKnown, dryad] }).edges).toHaveLength(1)
    // And the control: known to be green, so it genuinely cannot fire her.
    expect(build({ cards: [{ ...halfKnown, colors: ['G'] }, dryad] }).edges).toEqual([])
  })
})

describe('benefits edges', () => {
  it('points from the card that causes the event to the card that gains', () => {
    const web = build({
      cards: [card('outlet', ['creature-death']), card('drain', [], ['creature-death'])],
    })
    expect(web.edges).toHaveLength(1)
    expect(web.edges[0]).toMatchObject({ kind: 'benefits', from: 'outlet', to: 'drain' })
    expect(web.edges[0]?.mutual).toBe(false)
  })

  it('says so in words, naming both cards and the event', () => {
    const web = build({
      cards: [card('outlet', ['creature-death']), card('drain', [], ['creature-death'])],
    })
    // Pillar P4's habit applied to a picture: the claim is legible without the
    // picture, which is also what the table view of §17.7 shows.
    expect(web.edges[0]?.why).toBe(
      'Card outlet causes a creature dying; Card drain benefits from it.',
    )
  })

  it('uses the same words for an event as the workspace does', () => {
    /*
     * `creature-etb` and two others were missing from the shared table and fell
     * through to a fallback that just strips the hyphens, so the workspace's
     * own tag hint read "creature etb" — the wire spelling, in a sentence
     * written for a person. The deck web names the same events, which is what
     * made it visible.
     */
    const web = build({
      cards: [card('blink', ['creature-etb']), card('payoff', [], ['creature-etb'])],
    })
    expect(web.edges[0]?.why).toContain('causes creatures entering')
    expect(web.edges[0]?.why).not.toContain('creature etb')
  })

  it('merges two shared tags into one edge, not two lines', () => {
    const web = build({
      cards: [card('a', ['token', 'creature-death']), card('b', [], ['token', 'creature-death'])],
    })
    expect(web.edges).toHaveLength(1)
    expect(web.edges[0]?.tags).toEqual(['creature-death', 'token'])
  })

  it('merges the two directions of a mutual pair into one edge', () => {
    const web = build({
      cards: [card('a', ['token'], ['lifegain']), card('b', ['lifegain'], ['token'])],
    })
    expect(web.edges).toHaveLength(1)
    expect(web.edges[0]?.mutual).toBe(true)
    // "supply", not "cause" (ADR-0053): membership joined `produces` on the
    // supply side, so one half of a mutual pair may now be supplying by BEING
    // rather than by doing — an Elf and an Elf lord that also makes tokens.
    expect(web.edges[0]?.why).toContain('each supply something the other benefits from')
  })

  it('does not connect a card to itself', () => {
    const web = build({ cards: [card('a', ['token'], ['token'])] })
    expect(web.edges).toHaveLength(0)
  })
})

describe('combo edges beat benefits edges over the same pair', () => {
  const cards = [card('a', ['token']), card('b', [], ['token'])]

  it('draws only the combo, because it is the more specific claim', () => {
    const web = build({
      cards,
      combos: [{ comboId: 'c1', pieces: ['a', 'b'], produces: ['infinite tokens'] }],
    })
    expect(web.edges).toHaveLength(1)
    expect(web.edges[0]?.kind).toBe('combo')
    expect(web.edges[0]?.why).toContain('infinite tokens')
  })

  it('still draws the benefits edge when there is no combo', () => {
    expect(build({ cards }).edges[0]?.kind).toBe('benefits')
  })

  it('ignores a combo whose other pieces are not in the deck', () => {
    const web = build({
      cards: [card('a')],
      combos: [{ comboId: 'c1', pieces: ['a', 'elsewhere'], produces: [] }],
    })
    expect(web.edges).toHaveLength(0)
  })
})

describe('scarcity ranks the edges', () => {
  /*
   * The measured reason this is not "number of shared tags": on a real
   * aristocrats 99 out of the corpus, 668 of 690 merged benefits edges share
   * exactly one tag. A count cannot order them and cannot drive a stroke width.
   */
  const deck = [
    // Ten cards make tokens; one makes land drops.
    ...Array.from({ length: 10 }, (_, i) => card(`maker${String(i)}`, ['token'])),
    card('rare', ['landfall']),
    card('payoff', [], ['token', 'landfall']),
  ]

  it('scores an edge into the deck’s only source above one into its tenth', () => {
    const web = build({ cards: deck })
    const rare = web.edges.find((e) => e.from === 'rare')
    const common = web.edges.find((e) => e.from === 'maker0')
    expect(rare?.score).toBeGreaterThan(common?.score ?? Infinity)
    expect(rare?.score).toBeCloseTo(1)
    expect(common?.score).toBeCloseTo(0.1)
  })

  it('turns that into a stroke width inside the 1–3 px band', () => {
    const web = build({ cards: deck })
    expect(strokeWidth(web.edges.find((e) => e.from === 'rare')!)).toBe(3)
    expect(strokeWidth(web.edges.find((e) => e.from === 'maker0')!)).toBe(1)
  })
})

describe('the drawing ceiling', () => {
  const many = [
    ...Array.from({ length: 6 }, (_, i) => card(`p${String(i)}`, ['token'])),
    card('rare', ['landfall']),
    ...Array.from({ length: 6 }, (_, i) => card(`w${String(i)}`, [], ['token', 'landfall'])),
  ]

  it('states the truth about what it dropped rather than quietly drawing fewer', () => {
    const web = build({ cards: many, ceiling: 5 })
    expect(web.edges).toHaveLength(5)
    expect(web.totalEdges).toBe(42)
  })

  it('drops the least scarce first', () => {
    const web = build({ cards: many, ceiling: 6 })
    // All six `landfall` edges come from the deck's only landfall source.
    expect(web.edges.every((e) => e.from === 'rare')).toBe(true)
  })

  it('never drops a combo edge', () => {
    const web = build({
      cards: many,
      combos: [{ comboId: 'c1', pieces: ['p0', 'p1'], produces: ['a win'] }],
      ceiling: 1,
    })
    expect(web.edges).toHaveLength(1)
    expect(web.edges[0]?.kind).toBe('combo')
  })

  it('cuts the same edges however the cards arrived', () => {
    /*
     * Not a nicety. Measured, 668 of the real deck's 690 edges tie on score, so
     * without the explicit tie-break the ceiling would cut by iteration order —
     * which follows hydration order, which follows whatever the network did.
     * A graph that redraws differently on a reload is the thing §17.5 exists
     * to prevent.
     */
    const forwards = build({ cards: many, ceiling: 20 })
    const backwards = build({ cards: [...many].reverse(), ceiling: 20 })
    expect(backwards.edges.map((e) => `${e.from}->${e.to}`)).toEqual(
      forwards.edges.map((e) => `${e.from}->${e.to}`),
    )
  })
})

describe('isolated cards', () => {
  it('names the cards nothing connects to — doc 17 §17.1’s "just sitting in it"', () => {
    const web = build({
      cards: [card('a', ['token']), card('b', [], ['token']), card('swamp')],
    })
    expect(web.isolated).toEqual(['swamp'])
  })

  it('counts a card as isolated when the ceiling dropped its only edge', () => {
    // It is isolated ON THE SCREEN, and the readout describes the screen.
    const web = build({
      cards: [card('a', ['token']), card('b', [], ['token'])],
      ceiling: 0,
    })
    expect(web.isolated).toEqual(['a', 'b'])
  })
})

describe('walking the graph', () => {
  const web = build({
    cards: [card('a', ['token']), card('b', [], ['token']), card('c', [], ['token'])],
  })

  it('lists every edge touching a node, from either end', () => {
    expect(edgesAt(web.edges, 'a')).toHaveLength(2)
    expect(edgesAt(web.edges, 'b')).toHaveLength(1)
  })

  it('crosses to the far end from either end', () => {
    const edge = edgesAt(web.edges, 'b')[0]!
    expect(otherEnd(edge, 'b')).toBe('a')
    expect(otherEnd(edge, 'a')).toBe('b')
  })
})

describe('doc 17 §17.8’s budget', () => {
  it('computes a 100-node web in well under 16 ms', () => {
    // The tags are spread so the deck is genuinely dense rather than a line.
    const tags = ['token', 'creature-death', 'lifegain', 'lifeloss', 'treasure']
    /*
     * WITH ORACLE TEXT AND FACTS, because production has them and the
     * qualifier is read from them (ADR-0057).
     *
     * A fixture of bare tag arrays measured the wrong function: `oracleText`
     * absent skips the derivation entirely and absent facts skip
     * `satisfiesQualifiers`, so the budget covered neither. Every twentieth
     * card states a real qualified trigger and every fifth supplies
     * `spell-cast`, which is what makes the inner loop evaluate a qualifier
     * rather than step over one.
     */
    const cards = Array.from({ length: 100 }, (_, i): WebCard => {
      const wants = [tags[(i + 1) % 5]!, tags[(i + 2) % 5]!]
      const produces = [tags[i % 5]!]
      return {
        oracleId: `c${String(i)}`,
        name: `Card c${String(i)}`,
        synergyProduces: i % 5 === 0 ? [...produces, 'spell-cast'] : produces,
        synergyWants: i % 20 === 0 ? [...wants, 'spell-cast'] : wants,
        manaValue: i % 7,
        types: [(['creature', 'instant', 'sorcery', 'artifact'] as const)[i % 4]!],
        colors: [(['W', 'U', 'B', 'R', 'G'] as const)[i % 5]!],
        oracleText:
          'Vigilance, trample\n' +
          'At the beginning of each end step, if a player lost 4 or more life this turn, draw a card.\n' +
          'Whenever you cast a noncreature spell with mana value 3 or greater, ' +
          'this creature deals 2 damage to each opponent and you gain 2 life.',
      }
    })
    /*
     * The BEST of several runs, not a single one.
     *
     * A single timing here measured 18.33 ms during a full `pnpm test` and
     * passed three times out of three when the file was run alone: 80 test
     * files were competing for the same cores, and this assertion was reading
     * the scheduler rather than the algorithm. A wall-clock budget that fails
     * at random is worse than no budget, because the run it reddens is almost
     * never the run that broke something — and pushing now happens on green.
     *
     * The minimum over a handful of runs approximates the uncontended cost,
     * which is what doc 17 §17.8's 16 ms is a statement about. Contention can
     * only ever make a sample slower, so the floor is the honest one, and a
     * real regression raises every sample including the fastest.
     *
     * Rejected: raising the budget until it stopped flaking, which buys quiet
     * by giving up the thing the test is for; and moving this to the serial
     * project the database suites use, which would pay that project's wall
     * time for a single assertion.
     */
    const RUNS = 5
    let best = Number.POSITIVE_INFINITY
    let web = build({ cards })
    for (let run = 0; run < RUNS; run += 1) {
      const started = performance.now()
      web = build({ cards })
      best = Math.min(best, performance.now() - started)
    }
    expect(web.nodes).toHaveLength(100)
    expect(web.totalEdges).toBeGreaterThan(400)
    expect(best).toBeLessThan(16)
  })
})
