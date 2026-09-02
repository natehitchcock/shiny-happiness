import { describe, expect, it } from 'vitest'
import {
  oracleReferenceCandidates,
  resolveOracleReferences,
  splitOracleText,
} from './oracle-refs.js'

/**
 * The corpus these tests are calibrated against.
 *
 * Every string below is real oracle text, copied from the 34,494-card table,
 * because the whole risk in this file is text that LOOKS like a card name and
 * is not. A hand-invented fixture would have agreed with whatever the matcher
 * happened to do.
 */
const KNOWN = new Set([
  'Ral, Caller of Storms',
  'Sol Ring',
  'Lightning Bolt',
  'Command Tower',
  'Sword of Kaldra',
  'Shield of Kaldra',
  'Helm of Kaldra',
  'Amy Pond',
  'Urza, Planeswalker',
  'The Mightstone and Weakstone',
  'Plaguebearer',
  'Wasteland',
  'Storm Crow',
  'Island',
  'Fear',
  'Counterspell',
  'Ashnod’s Altar',
])

describe('oracleReferenceCandidates', () => {
  it('offers the spans after "named", longest first', () => {
    const text = 'Search your library for a card named Sol Ring, reveal it.'
    const found = oracleReferenceCandidates(text)
    // The first site sits exactly where the name starts.
    expect(text.slice(found[0]!.start)).toMatch(/^Sol Ring/)
    expect(found[0]?.candidates).toContain('Sol Ring')
    // Longest first, so a resolver that stops at its first hit takes the full name.
    const lengths = found[0]!.candidates.map((c) => c.length)
    expect(lengths).toEqual([...lengths].sort((a, b) => b - a))
  })

  it('offers spans after "Partner with"', () => {
    const found = oracleReferenceCandidates('Partner with Amy Pond\nFirst strike, lifelink')
    expect(found[0]?.candidates).toContain('Amy Pond')
  })

  it('offers spans after "meld them into"', () => {
    const found = oracleReferenceCandidates('exile them, then meld them into Urza, Planeswalker.')
    expect(found[0]?.candidates).toContain('Urza, Planeswalker')
  })

  it('finds nothing in text that names no card', () => {
    expect(
      oracleReferenceCandidates('Flying, vigilance. When this creature dies, draw a card.'),
    ).toEqual([])
  })

  it('never runs a candidate past a line break', () => {
    const found = oracleReferenceCandidates('Partner with Amy Pond\nFirst strike')
    for (const c of found[0]?.candidates ?? []) expect(c).not.toContain('\n')
  })
})

describe('resolveOracleReferences', () => {
  const refs = (text: string, self = 'Some Card'): readonly { name: string }[] =>
    resolveOracleReferences(text, KNOWN, self).map((r) => ({ name: r.name }))

  it('links the card named after "named"', () => {
    expect(refs('Search your library for a card named Sol Ring, reveal it.')).toEqual([
      { name: 'Sol Ring' },
    ])
  })

  it('takes the LONGEST name, so a title is not cut at the comma', () => {
    expect(refs('Search for a card named Ral, Caller of Storms, reveal it.')).toEqual([
      { name: 'Ral, Caller of Storms' },
    ])
  })

  it('links every card in a comma-and list', () => {
    expect(
      refs(
        'As long as you control Equipment named Sword of Kaldra, Shield of Kaldra, and Helm of Kaldra, you win.',
      ),
    ).toEqual([
      { name: 'Sword of Kaldra' },
      { name: 'Shield of Kaldra' },
      { name: 'Helm of Kaldra' },
    ])
  })

  it('links both sides of an "or" list', () => {
    expect(refs('Search your library for a card named Sol Ring or Command Tower.')).toEqual([
      { name: 'Sol Ring' },
      { name: 'Command Tower' },
    ])
  })

  /*
   * The false-positive class that a full-corpus audit turned up: a TOKEN whose
   * name begins with a real card's name. Linking "Wasteland" out of the middle
   * of "Wasteland Survival Guide" sends the reader to a card the text never
   * mentioned. The guard is that a name must END where the text ends it.
   */
  it('does not link a card name that a longer token name merely starts with', () => {
    expect(
      refs(
        'create a Book Equipment artifact token named Wasteland Survival Guide with "{T}: Draw."',
      ),
    ).toEqual([])
  })

  it('does not link across a lowercase name-connector into a token name', () => {
    expect(refs('create a 1/3 black Demon creature token named Plaguebearer of Nurgle.')).toEqual(
      [],
    )
  })

  /*
   * `Partner with X` is the one anchor that habitually ends an ability, so the
   * name is followed by a line break and then the next ability's first word,
   * capitalised. Without treating end-of-line as the end of a name, the guard
   * reads "First" as a continuation and drops a reference that is real — which
   * is how every partner pair in the corpus behaves.
   */
  it('links a partner named at the end of an ability line', () => {
    expect(refs('Partner with Amy Pond\nFirst strike, lifelink')).toEqual([{ name: 'Amy Pond' }])
  })

  it('links a token whose name IS a real card', () => {
    expect(refs('create a 1/2 blue Bird creature token with flying named Storm Crow.')).toEqual([
      { name: 'Storm Crow' },
    ])
  })

  /*
   * `known` is what the caller considers LINKABLE, not the whole card table.
   *
   * A client resolving against only the references a server already picked has
   * a hole in its set exactly where the card names itself or names a basic land
   * — neither is ever sent, because neither is ever linked. The walk still has
   * to step over them to reach the items after them, and these two cases are
   * how it shipped green and rendered nothing in a browser.
   */
  it('steps over its own name to reach the rest of a list', () => {
    const known = new Set(['Sword of Kaldra', 'Shield of Kaldra'])
    const text =
      'If you control Equipment named Helm of Kaldra, Sword of Kaldra, and Shield of Kaldra, you win.'

    expect(resolveOracleReferences(text, known, 'Helm of Kaldra').map((r) => r.name)).toEqual([
      'Sword of Kaldra',
      'Shield of Kaldra',
    ])
  })

  it('steps over a basic land to reach the rest of a list', () => {
    const known = new Set(['Sword of Kaldra'])

    expect(
      resolveOracleReferences(
        'Search for a card named Island, Sword of Kaldra.',
        known,
        'Other',
      ).map((r) => r.name),
    ).toEqual(['Sword of Kaldra'])
  })

  /*
   * A limit worth stating rather than discovering: after a name, " and " is
   * ambiguous. It separates list items ("Crown of Empires and Throne of
   * Empires") and it also sits INSIDE names ("The Mightstone and Weakstone"),
   * and nothing in the text distinguishes the two. It is read as part of the
   * name, because reading it as a separator would cut a real name in half — a
   * wrong link is worse than a missing one. The cost is the item after an "and"
   * when the item before it was not linkable.
   */
  it('does not split on "and" after a name it could not link', () => {
    const known = new Set(['Sword of Kaldra'])

    expect(
      resolveOracleReferences(
        'Search for a card named Island and Sword of Kaldra.',
        known,
        'Other',
      ),
    ).toEqual([])
  })

  /* Self-reference: reopening the card you are already reading is noise. */
  it('does not link the card to itself', () => {
    expect(refs('Sacrifice a creature named Sol Ring: draw a card.', 'Sol Ring')).toEqual([])
  })

  it('does not link a face of the card to itself', () => {
    expect(refs('conjure a card named Sol Ring.', 'Sol Ring // Sol Loop')).toEqual([])
  })

  it('does not link the Alchemy rebalance of itself', () => {
    expect(refs('When Sol Ring enters, conjure a card named Sol Ring.', 'A-Sol Ring')).toEqual([])
  })

  it('does not link a legend by the short name it calls itself', () => {
    expect(refs('a card named Ral, Caller of Storms', 'Ral, Caller of Storms')).toEqual([])
  })

  /*
   * Basic lands. "named Island" is a genuine reference, but a basic land's
   * detail pane says nothing the reader did not already know, and basics are
   * the single most common capitalised word in the corpus.
   */
  it('does not link a basic land', () => {
    expect(refs('Search your library for a card named Island.')).toEqual([])
  })

  /*
   * The reason this matcher is anchored at all. Free-text matching over the
   * corpus turns these ordinary words into links, because each is also a real
   * card: measured over 34,145 cards it produced 24,877 cross-card links, of
   * which effectively all were wrong.
   */
  it('does not link ordinary words that happen to be card names', () => {
    expect(refs('Target creature gains fear until end of turn. Counterspell costs less.')).toEqual(
      [],
    )
    expect(refs('Sacrifice Ashnod’s Altar: add two colorless mana.')).toEqual([])
    expect(refs('Return target Island to its owner’s hand.')).toEqual([])
  })

  it('finds nothing when the named thing is not a card we know', () => {
    expect(refs('create a Food token named Banana with "{T}: Add {R}."')).toEqual([])
  })

  it('reports the offsets the name occupies, so a renderer can split the text', () => {
    const text = 'a card named Sol Ring, reveal it'
    const [ref] = resolveOracleReferences(text, KNOWN, 'Other')
    expect(ref).toBeDefined()
    expect(text.slice(ref!.start, ref!.end)).toBe('Sol Ring')
  })
})

describe('splitOracleText', () => {
  it('splits text into prose and name segments in order', () => {
    expect(splitOracleText('a card named Sol Ring, reveal it', KNOWN, 'Other')).toEqual([
      { kind: 'text', text: 'a card named ' },
      { kind: 'name', text: 'Sol Ring' },
      { kind: 'text', text: ', reveal it' },
    ])
  })

  it('returns one prose segment when nothing is named', () => {
    expect(splitOracleText('Flying, vigilance.', KNOWN, 'Other')).toEqual([
      { kind: 'text', text: 'Flying, vigilance.' },
    ])
  })

  it('emits no empty prose segment when a name ends the text', () => {
    expect(splitOracleText('a card named Sol Ring', KNOWN, 'Other')).toEqual([
      { kind: 'text', text: 'a card named ' },
      { kind: 'name', text: 'Sol Ring' },
    ])
  })

  it('rebuilds the original text exactly', () => {
    const text =
      'Equipment named Sword of Kaldra, Shield of Kaldra, and Helm of Kaldra have indestructible.'
    const rebuilt = splitOracleText(text, KNOWN, 'Other')
      .map((s) => s.text)
      .join('')
    expect(rebuilt).toBe(text)
  })

  it('rebuilds text that names nothing', () => {
    const text = 'Whenever this creature attacks, draw a card.\nFlying'
    expect(
      splitOracleText(text, KNOWN, 'Other')
        .map((s) => s.text)
        .join(''),
    ).toBe(text)
  })
})
