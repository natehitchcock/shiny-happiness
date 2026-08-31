import { describe, expect, it } from 'vitest'
import type { Card, CardType, Color } from './card.js'
import type { Deck, DeckEntry } from './deck.js'
import { deckId, oracleId, printingId, type OracleId } from './ids.js'
import {
  applyCommands,
  rebaseCommands,
  type CommandContext,
  type DeckCommand,
} from './deck-command.js'

const card = (name: string, opts: Partial<Card> = {}): Card => ({
  oracleId: oracleId(name),
  name,
  manaCost: '{1}',
  manaValue: 1,
  colorIdentity: opts.colorIdentity ?? ['R'],
  colors: opts.colors ?? ['R'],
  typeLine: opts.typeLine ?? 'Creature — Goblin',
  types: (opts.types ?? ['creature']) as readonly CardType[],
  oracleText: opts.oracleText ?? '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: opts.legalities ?? { commander: 'legal' },
  edhrecRank: null,
  defaultPrinting: printingId(`${name}-p`),
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  synergyProduces: [],
  synergyWants: [],
})

const entry = (name: string, over: Partial<DeckEntry> = {}): DeckEntry => ({
  oracleId: oracleId(name),
  zone: 'accepted',
  origin: 'manual',
  locked: false,
  roleOverride: null,
  tags: [],
  addedAt: '2026-01-01T00:00:00Z',
  ...over,
})

const deck = (entries: DeckEntry[] = [], colorIdentity: Color[] = ['R']): Deck => ({
  id: deckId('d1'),
  name: 'test',
  description: '',
  commanders: [oracleId('Cmdr')],
  targetBracket: 3,
  archetype: 'midrange',
  archetypeSecondary: null,
  colorIdentity,
  entries,
  budget: null,
  excludeUniversesBeyond: false,
  status: 'active',
  version: 4,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  lastOpenedAt: '2026-01-01T00:00:00Z',
})

const context = (cards: Card[]): CommandContext => ({
  cards: new Map(cards.map((c) => [c.oracleId, c])),
  now: '2026-06-01T00:00:00Z',
})

const ctxWithCommander = (cards: Card[]): CommandContext =>
  context([card('Cmdr', { typeLine: 'Legendary Creature — Goblin' }), ...cards])

describe('applyCommands — accept', () => {
  it('accepts an eligible card and reports it applied', () => {
    const command: DeckCommand = { type: 'accept', oracleId: oracleId('Sol'), origin: 'manual' }

    const outcome = applyCommands(deck(), [command], ctxWithCommander([card('Sol')]))

    expect(outcome.rejected).toEqual([])
    expect(outcome.applied).toEqual([command])
    expect(outcome.deck.entries).toHaveLength(1)
    expect(outcome.deck.entries[0]).toMatchObject({
      oracleId: oracleId('Sol'),
      zone: 'accepted',
      origin: 'manual',
      locked: false,
    })
  })
})

describe('applyCommands — accept rejections', () => {
  it('rejects a card the corpus does not know', () => {
    const command: DeckCommand = { type: 'accept', oracleId: oracleId('Ghost'), origin: 'manual' }

    const outcome = applyCommands(deck(), [command], ctxWithCommander([]))

    expect(outcome.applied).toEqual([])
    expect(outcome.deck.entries).toEqual([])
    expect(outcome.rejected).toEqual([
      { command, reason: { kind: 'unknown-card', oracleId: oracleId('Ghost') } },
    ])
  })

  it('rejects a card outside the deck colour identity, naming the offending colours', () => {
    const command: DeckCommand = { type: 'accept', oracleId: oracleId('Blue'), origin: 'manual' }
    const ctx = ctxWithCommander([card('Blue', { colorIdentity: ['U', 'R'] })])

    const outcome = applyCommands(deck([], ['R']), [command], ctx)

    expect(outcome.applied).toEqual([])
    expect(outcome.rejected[0]?.reason).toEqual({
      kind: 'color-identity',
      oracleId: oracleId('Blue'),
      offending: ['U'],
    })
  })

  it('rejects a banned card', () => {
    const command: DeckCommand = { type: 'accept', oracleId: oracleId('Ante'), origin: 'manual' }
    const ctx = ctxWithCommander([card('Ante', { legalities: { commander: 'banned' } })])

    const outcome = applyCommands(deck(), [command], ctx)

    expect(outcome.rejected[0]?.reason).toEqual({ kind: 'banned', oracleId: oracleId('Ante') })
  })

  it('rejects a second copy of a non-basic card', () => {
    const command: DeckCommand = { type: 'accept', oracleId: oracleId('Sol'), origin: 'manual' }

    const outcome = applyCommands(deck([entry('Sol')]), [command], ctxWithCommander([card('Sol')]))

    expect(outcome.applied).toEqual([])
    expect(outcome.rejected[0]?.reason).toEqual({
      kind: 'not-singleton',
      oracleId: oracleId('Sol'),
      copies: 2,
      allowed: 1,
    })
  })

  it('rejects the second copy within a single batch, not just against stored state', () => {
    const once: DeckCommand = { type: 'accept', oracleId: oracleId('Sol'), origin: 'manual' }

    const outcome = applyCommands(deck(), [once, once], ctxWithCommander([card('Sol')]))

    expect(outcome.applied).toHaveLength(1)
    expect(outcome.rejected).toHaveLength(1)
    expect(outcome.deck.entries).toHaveLength(1)
  })

  it('allows any number of basic lands', () => {
    const mountain = card('Mountain', { typeLine: 'Basic Land — Mountain' })
    const command: DeckCommand = {
      type: 'accept',
      oracleId: oracleId('Mountain'),
      origin: 'manual',
    }

    const outcome = applyCommands(
      deck([entry('Mountain'), entry('Mountain')]),
      [command],
      ctxWithCommander([mountain]),
    )

    expect(outcome.rejected).toEqual([])
    expect(outcome.deck.entries).toHaveLength(3)
  })
})

describe('applyCommands — exclude, restore, lock, setRole', () => {
  it('excluding an accepted card removes the copy and records the exclusion', () => {
    const command: DeckCommand = { type: 'exclude', oracleId: oracleId('Sol') }

    const outcome = applyCommands(deck([entry('Sol')]), [command], ctxWithCommander([card('Sol')]))

    expect(outcome.rejected).toEqual([])
    expect(outcome.deck.entries).toHaveLength(1)
    expect(outcome.deck.entries[0]).toMatchObject({ oracleId: oracleId('Sol'), zone: 'excluded' })
  })

  it('refuses to exclude a locked entry', () => {
    const command: DeckCommand = { type: 'exclude', oracleId: oracleId('Sol') }
    const start = deck([entry('Sol', { locked: true })])

    const outcome = applyCommands(start, [command], ctxWithCommander([card('Sol')]))

    expect(outcome.applied).toEqual([])
    expect(outcome.rejected[0]?.reason).toEqual({ kind: 'locked', oracleId: oracleId('Sol') })
    expect(outcome.deck.entries[0]?.zone).toBe('accepted')
  })

  it('restoring an excluded card makes it a candidate again', () => {
    const command: DeckCommand = { type: 'restore', oracleId: oracleId('Sol') }
    const start = deck([entry('Sol', { zone: 'excluded' })])

    const outcome = applyCommands(start, [command], ctxWithCommander([card('Sol')]))

    expect(outcome.rejected).toEqual([])
    expect(outcome.deck.entries).toEqual([])
  })

  it('rejects restoring a card that was never excluded', () => {
    const command: DeckCommand = { type: 'restore', oracleId: oracleId('Sol') }

    const outcome = applyCommands(deck([entry('Sol')]), [command], ctxWithCommander([card('Sol')]))

    expect(outcome.rejected[0]?.reason).toEqual({ kind: 'not-excluded', oracleId: oracleId('Sol') })
  })

  it('locks an accepted entry', () => {
    const command: DeckCommand = { type: 'lock', oracleId: oracleId('Sol'), locked: true }

    const outcome = applyCommands(deck([entry('Sol')]), [command], ctxWithCommander([card('Sol')]))

    expect(outcome.deck.entries[0]?.locked).toBe(true)
  })

  it('rejects locking a card that is not in the deck', () => {
    const command: DeckCommand = { type: 'lock', oracleId: oracleId('Sol'), locked: true }

    const outcome = applyCommands(deck(), [command], ctxWithCommander([card('Sol')]))

    expect(outcome.rejected[0]?.reason).toEqual({ kind: 'not-in-deck', oracleId: oracleId('Sol') })
  })

  it('records a role override, which wins over derived roles (doc 02 §2.4)', () => {
    const command: DeckCommand = { type: 'setRole', oracleId: oracleId('Sol'), roles: ['ramp'] }

    const outcome = applyCommands(deck([entry('Sol')]), [command], ctxWithCommander([card('Sol')]))

    expect(outcome.deck.entries[0]?.roleOverride).toEqual(['ramp'])
  })
})

describe('applyCommands — pillar P6, an excluded card is never re-suggested', () => {
  it('rejects a recommended accept of a card the user excluded', () => {
    const command: DeckCommand = {
      type: 'accept',
      oracleId: oracleId('Sol'),
      origin: 'recommended',
    }
    const start = deck([entry('Sol', { zone: 'excluded' })])

    const outcome = applyCommands(start, [command], ctxWithCommander([card('Sol')]))

    expect(outcome.applied).toEqual([])
    expect(outcome.rejected[0]?.reason).toEqual({
      kind: 'previously-excluded',
      oracleId: oracleId('Sol'),
    })
  })

  it('lets the user re-add a card they excluded themselves', () => {
    const command: DeckCommand = { type: 'accept', oracleId: oracleId('Sol'), origin: 'manual' }
    const start = deck([entry('Sol', { zone: 'excluded' })])

    const outcome = applyCommands(start, [command], ctxWithCommander([card('Sol')]))

    expect(outcome.rejected).toEqual([])
    expect(outcome.deck.entries).toHaveLength(1)
    expect(outcome.deck.entries[0]?.zone).toBe('accepted')
  })
})

describe('applyCommands — core packages are not implemented yet', () => {
  it('rejects applyCorePackage rather than silently doing nothing', () => {
    const command: DeckCommand = { type: 'applyCorePackage', bracket: 3 }

    const outcome = applyCommands(deck(), [command], ctxWithCommander([]))

    expect(outcome.applied).toEqual([])
    expect(outcome.rejected[0]?.reason).toMatchObject({ kind: 'unsupported' })
  })
})

describe('applyCommands — a card is in exactly one state (doc 02 §2.2)', () => {
  it('refuses to exclude a commander, which is accepted by definition', () => {
    const command: DeckCommand = { type: 'exclude', oracleId: oracleId('Cmdr') }

    const outcome = applyCommands(deck(), [command], ctxWithCommander([]))

    // Excluding it would leave the commander in acceptedSet (which seeds from
    // deck.commanders) AND excludedSet at once, and every consumer downstream
    // would disagree about whether the deck's most important card is in it.
    expect(outcome.applied).toEqual([])
    expect(outcome.rejected[0]?.reason).toEqual({
      kind: 'is-commander',
      oracleId: oracleId('Cmdr'),
    })
    expect(outcome.deck.entries).toEqual([])
  })

  it('refuses to lock or set a role on a commander', () => {
    const lock: DeckCommand = { type: 'lock', oracleId: oracleId('Cmdr'), locked: true }
    const role: DeckCommand = { type: 'setRole', oracleId: oracleId('Cmdr'), roles: ['ramp'] }

    const outcome = applyCommands(deck(), [lock, role], ctxWithCommander([]))

    expect(outcome.applied).toEqual([])
    expect(outcome.rejected).toHaveLength(2)
  })
})

describe('applyCommands — exclude removes every copy', () => {
  it('takes all 34 Mountains, not one of them', () => {
    const mountain = card('Mountain', { typeLine: 'Basic Land — Mountain' })
    const start = deck([entry('Mountain'), entry('Mountain'), entry('Mountain')])

    const outcome = applyCommands(
      start,
      [{ type: 'exclude', oracleId: oracleId('Mountain') }],
      ctxWithCommander([mountain]),
    )

    expect(outcome.deck.entries.filter((e) => e.zone === 'accepted')).toEqual([])
    expect(outcome.deck.entries.filter((e) => e.zone === 'excluded')).toHaveLength(1)
  })

  it('restoring after an exclude in the same batch does not resurrect the copies', () => {
    const mountain = card('Mountain', { typeLine: 'Basic Land — Mountain' })
    const start = deck([entry('Mountain'), entry('Mountain'), entry('Mountain')])

    const outcome = applyCommands(
      start,
      [
        { type: 'exclude', oracleId: oracleId('Mountain') },
        { type: 'restore', oracleId: oracleId('Mountain') },
      ],
      ctxWithCommander([mountain]),
    )

    // The pair is a real request the offline queue can coalesce from an
    // exclude-then-undo. Previously both applied and three cards vanished with
    // nothing in `rejected` to say so. Now the exclude stands on its own merits
    // and the restore is refused by name, which leaves the card in a state the
    // user can still recover from with a later `restore`.
    expect(outcome.applied).toHaveLength(1)
    expect(outcome.rejected).toHaveLength(1)
    expect(outcome.rejected[0]?.reason).toMatchObject({ kind: 'restore-of-batch-exclusion' })
    expect(outcome.deck.entries.filter((e) => e.zone === 'excluded')).toHaveLength(1)
  })
})

describe('applyCommands — restore does not need the corpus', () => {
  it('lifts an exclusion for a card the corpus has since forgotten', () => {
    const start = deck([entry('Gone', { zone: 'excluded' })])

    // No card data: an ingest snapshot swap dropped it (rebalance, un-card,
    // name change). The exclusion must still be liftable or P6 suppresses the
    // card forever if it ever comes back.
    const outcome = applyCommands(
      start,
      [{ type: 'restore', oracleId: oracleId('Gone') }],
      ctxWithCommander([]),
    )

    expect(outcome.rejected).toEqual([])
    expect(outcome.deck.entries).toEqual([])
  })
})

describe('applyCommands — remove is an amount, not a judgement (ADR-0012)', () => {
  const mountain = card('Mountain', { typeLine: 'Basic Land — Mountain' })

  it('takes exactly one copy and leaves the rest', () => {
    const start = deck([entry('Mountain'), entry('Mountain'), entry('Mountain')])

    const outcome = applyCommands(
      start,
      [{ type: 'remove', oracleId: oracleId('Mountain') }],
      ctxWithCommander([mountain]),
    )

    expect(outcome.rejected).toEqual([])
    expect(outcome.deck.entries.filter((e) => e.zone === 'accepted')).toHaveLength(2)
  })

  it('does NOT exclude the card, so it can still be suggested', () => {
    // The whole reason this is a separate verb from `exclude`.
    const start = deck([entry('Mountain')])

    const outcome = applyCommands(
      start,
      [{ type: 'remove', oracleId: oracleId('Mountain') }],
      ctxWithCommander([mountain]),
    )

    expect(outcome.deck.entries).toEqual([])
    expect(outcome.deck.entries.filter((e) => e.zone === 'excluded')).toEqual([])
  })

  it('rejects removing a card that is not in the deck', () => {
    const outcome = applyCommands(
      deck(),
      [{ type: 'remove', oracleId: oracleId('Mountain') }],
      ctxWithCommander([mountain]),
    )

    expect(outcome.rejected[0]?.reason).toEqual({
      kind: 'not-in-deck',
      oracleId: oracleId('Mountain'),
    })
  })

  it('refuses to remove a locked copy', () => {
    const start = deck([entry('Mountain', { locked: true })])

    const outcome = applyCommands(
      start,
      [{ type: 'remove', oracleId: oracleId('Mountain') }],
      ctxWithCommander([mountain]),
    )

    expect(outcome.rejected[0]?.reason).toMatchObject({ kind: 'locked' })
  })

  it('removes several copies when asked several times in one batch', () => {
    const start = deck([entry('Mountain'), entry('Mountain'), entry('Mountain')])
    const remove: DeckCommand = { type: 'remove', oracleId: oracleId('Mountain') }

    const outcome = applyCommands(start, [remove, remove], ctxWithCommander([mountain]))

    expect(outcome.applied).toHaveLength(2)
    expect(outcome.deck.entries).toHaveLength(1)
  })

  it('refuses to remove a commander', () => {
    const outcome = applyCommands(
      deck(),
      [{ type: 'remove', oracleId: oracleId('Cmdr') }],
      ctxWithCommander([]),
    )

    expect(outcome.rejected[0]?.reason).toMatchObject({ kind: 'is-commander' })
  })
})

/**
 * `rebaseCommands` — the client half of a 409 (API-06, doc 12 §12.7).
 *
 * Every case is stated as "two clients, one deck": what the OTHER client did
 * goes in `since`, what THIS client queued goes in the first argument.
 */
describe('rebaseCommands', () => {
  const id = (name: string): OracleId => oracleId(name)
  const accept = (name: string): DeckCommand => ({
    type: 'accept',
    oracleId: id(name),
    origin: 'manual',
  })
  const exclude = (name: string): DeckCommand => ({ type: 'exclude', oracleId: id(name) })
  const restore = (name: string): DeckCommand => ({ type: 'restore', oracleId: id(name) })
  const remove = (name: string): DeckCommand => ({ type: 'remove', oracleId: id(name) })
  const lock = (name: string, locked: boolean): DeckCommand => ({
    type: 'lock',
    oracleId: id(name),
    locked,
  })

  it('replays everything when nothing we touched changed', () => {
    const queued = [accept('Sol Ring'), exclude('Counterspell')]

    const out = rebaseCommands(queued, [accept('Lightning Bolt')])

    expect(out.replay).toEqual(queued)
    expect(out.superseded).toEqual([])
    expect(out.overrides).toEqual([])
  })

  it('replays everything when `since` is empty', () => {
    const queued = [accept('Sol Ring')]

    expect(rebaseCommands(queued, []).replay).toEqual(queued)
  })

  it('drops an exclude the other client already made', () => {
    const out = rebaseCommands([exclude('Sol Ring')], [exclude('Sol Ring')])

    expect(out.replay).toEqual([])
    expect(out.superseded).toHaveLength(1)
    expect(out.superseded[0]?.reason).toBe('already-excluded')
    expect(out.superseded[0]?.by).toEqual(exclude('Sol Ring'))
  })

  it('drops a restore for a card the other client already restored', () => {
    const out = rebaseCommands([restore('Sol Ring')], [restore('Sol Ring')])

    expect(out.replay).toEqual([])
    expect(out.superseded[0]?.reason).toBe('not-excluded')
  })

  it('drops a remove when the other client excluded the card — every copy is gone', () => {
    const out = rebaseCommands([remove('Sol Ring')], [exclude('Sol Ring')])

    expect(out.replay).toEqual([])
    expect(out.superseded[0]?.reason).toBe('no-copies-left')
  })

  it('drops a lock already set to the same value', () => {
    const out = rebaseCommands([lock('Sol Ring', true)], [lock('Sol Ring', true)])

    expect(out.replay).toEqual([])
    expect(out.superseded[0]?.reason).toBe('already-set')
  })

  it('replays a lock set to the OTHER value, and reports it as an override', () => {
    const out = rebaseCommands([lock('Sol Ring', false)], [lock('Sol Ring', true)])

    expect(out.replay).toEqual([lock('Sol Ring', false)])
    expect(out.overrides).toHaveLength(1)
  })

  it('drops a setRole asking for the roles already set', () => {
    const roles: DeckCommand = { type: 'setRole', oracleId: id('Sol Ring'), roles: ['ramp'] }

    const out = rebaseCommands([roles], [roles])

    expect(out.replay).toEqual([])
    expect(out.superseded[0]?.reason).toBe('already-set')
  })

  it('replays a setRole asking for different roles', () => {
    const ours: DeckCommand = { type: 'setRole', oracleId: id('Sol Ring'), roles: ['ramp'] }
    const theirs: DeckCommand = { type: 'setRole', oracleId: id('Sol Ring'), roles: ['draw'] }

    const out = rebaseCommands([ours], [theirs])

    expect(out.replay).toEqual([ours])
    expect(out.overrides).toHaveLength(1)
  })

  it('distinguishes role lists by order, not only by membership', () => {
    const ours: DeckCommand = { type: 'setRole', oracleId: id('X'), roles: ['ramp', 'draw'] }
    const theirs: DeckCommand = { type: 'setRole', oracleId: id('X'), roles: ['draw', 'ramp'] }

    expect(rebaseCommands([ours], [theirs]).replay).toEqual([ours])
  })

  /*
   * Doc 12 §12.7's own example: the same card accepted here and excluded there.
   * The accept still goes — pillar P6 binds the recommender, not the user — but
   * it is reported, so a caller can say that a foreign edit was overridden.
   */
  it('replays an accept over the other client’s exclusion and reports the override', () => {
    const out = rebaseCommands([accept('Sol Ring')], [exclude('Sol Ring')])

    expect(out.replay).toEqual([accept('Sol Ring')])
    expect(out.superseded).toEqual([])
    expect(out.overrides).toHaveLength(1)
    expect(out.overrides[0]?.by).toEqual(exclude('Sol Ring'))
  })

  it('reports excluding what the other client just accepted as an override', () => {
    const out = rebaseCommands([exclude('Sol Ring')], [accept('Sol Ring')])

    expect(out.replay).toEqual([exclude('Sol Ring')])
    expect(out.overrides).toHaveLength(1)
  })

  it('replays a restore of what the other client just excluded', () => {
    const out = rebaseCommands([restore('Sol Ring')], [exclude('Sol Ring')])

    expect(out.replay).toEqual([restore('Sol Ring')])
    expect(out.overrides).toHaveLength(1)
  })

  /*
   * The rejected rule, asserted so it cannot be quietly "fixed" back in: a deck
   * holds 34 Mountains and this function has no card data with which to tell a
   * basic land from a singleton, so dropping the accept would lose a real copy.
   */
  it('never drops an accept just because the other client accepted the same card', () => {
    const out = rebaseCommands([accept('Mountain')], [accept('Mountain')])

    expect(out.replay).toEqual([accept('Mountain')])
    expect(out.superseded).toEqual([])
    expect(out.overrides).toEqual([])
  })

  it('reads the LAST foreign command for a card, not the first', () => {
    // Excluded and then restored elsewhere: the card is not excluded any more,
    // so our own restore has nothing left to do.
    const out = rebaseCommands([restore('Sol Ring')], [exclude('Sol Ring'), restore('Sol Ring')])

    expect(out.replay).toEqual([])
    expect(out.superseded[0]?.reason).toBe('not-excluded')
  })

  it('keeps the queued order of whatever survives', () => {
    const queued = [accept('A'), exclude('B'), accept('C')]

    const out = rebaseCommands(queued, [exclude('B')])

    expect(out.replay).toEqual([accept('A'), accept('C')])
  })

  it('passes a core-package command through — it names a bracket, not a card', () => {
    const pkg: DeckCommand = { type: 'applyCorePackage', bracket: 3 }

    const out = rebaseCommands([pkg], [exclude('Sol Ring')])

    expect(out.replay).toEqual([pkg])
  })

  it('returns empty everything for an empty queue', () => {
    expect(rebaseCommands([], [exclude('Sol Ring')])).toEqual({
      replay: [],
      superseded: [],
      overrides: [],
    })
  })
})
