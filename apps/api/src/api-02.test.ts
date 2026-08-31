import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { createTestDatabase, databaseUrl, type TestDatabase } from '@roundtable/db/testing'
import { createDeck, insertCombos, upsertCards } from '@roundtable/db'
import type { Card, CardType, Combo, OracleId } from '@roundtable/domain'
import { comboId, deckId, oracleId, printingId } from '@roundtable/domain'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './server.js'

/**
 * Contract tests for API-02 against doc 10 §10.4 and §10.5.
 *
 * Real Postgres (AGENTS.md §4); SKIP loudly without one.
 */
const hasDatabase = databaseUrl() !== null
const describeDb = hasDatabase ? describe : describe.skip

if (!hasDatabase) {
  console.warn('[api] DATABASE_URL not set — skipping API-02 contract tests (AGENTS.md §4)')
}

const KROV = oracleId(randomUUID())
const PIECE_A = oracleId(randomUUID())
const PIECE_B = oracleId(randomUUID())
const RAMP = oracleId(randomUUID())
const LAND = oracleId(randomUUID())
const OFF_COLOR = oracleId(randomUUID())
const BAD_COMMANDER = oracleId(randomUUID())
const UNDECIDED = oracleId(randomUUID())
/**
 * Four cards flagged as Game Changers (DATA-05).
 *
 * Four because Bracket 3 allows three: three of them is the boundary that must
 * pass and four is the one that must fail, and a fixture with fewer could not
 * tell those apart.
 */
const GAME_CHANGERS = [0, 1, 2, 3].map(() => oracleId(randomUUID()))
/** A legendary Game Changer, so the command zone can be checked too. */
const GC_COMMANDER = oracleId(randomUUID())
/**
 * Two cards for the barometers Wizards names but never quantifies (ADR-0018),
 * plus the card that must NOT be counted with them.
 *
 * `NONLAND_WIPE` carries Ruinous Ultimatum's real text because "nonland"
 * contains "land": it is the false positive the whole land rule is shaped
 * around, and the endpoint is where it would reach a user.
 */
const EXTRA_TURN = oracleId(randomUUID())
const LAND_DENIAL = oracleId(randomUUID())
const NONLAND_WIPE = oracleId(randomUUID())

const card = (id: OracleId, name: string, opts: Partial<Card> = {}): Card => ({
  oracleId: id,
  name,
  manaCost: opts.manaCost ?? '{1}{R}',
  manaValue: opts.manaValue ?? 2,
  colorIdentity: opts.colorIdentity ?? ['R'],
  colors: opts.colors ?? ['R'],
  typeLine: opts.typeLine ?? 'Creature — Goblin',
  types: (opts.types ?? ['creature']) as readonly CardType[],
  oracleText: opts.oracleText ?? '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  // Absent unless the fixture says otherwise, which is the pre-re-ingest state
  // of every row in the real corpus and the one the analysis endpoint has to
  // report rather than rule on.
  ...(opts.canBeCommander === undefined ? {} : { canBeCommander: opts.canBeCommander }),
  edhrecRank: opts.edhrecRank ?? null,
  defaultPrinting: printingId(randomUUID()),
  roles: opts.roles ?? ['synergy'],
  primaryRole: opts.primaryRole ?? 'synergy',
  universesBeyond: false,
  gameChanger: opts.gameChanger ?? false,
  synergyProduces: [],
  synergyWants: [],
})

describeDb('API-02 contract', () => {
  let db: TestDatabase
  let app: FastifyInstance
  let deck: { id: string; version: number }

  beforeAll(async () => {
    db = await createTestDatabase('api02')
    await upsertCards(db.pool, [
      card(KROV, 'Krovax', {
        typeLine: 'Legendary Creature — Vampire',
        colorIdentity: ['R'],
        canBeCommander: true,
      }),
      // The production defect, preserved as a row: a deck already exists with
      // this in the command zone, and creation now refuses it, so the only way
      // to reach the analysis path is a deck written straight to the database.
      card(BAD_COMMANDER, 'Sol Ring', {
        typeLine: 'Artifact',
        types: ['artifact'],
        colorIdentity: [],
        colors: [],
        canBeCommander: false,
      }),
      // Deliberately undecided: a row the re-ingest behind migration 0010 has
      // not reached.
      card(UNDECIDED, 'Legend of Unknown Eligibility', {
        typeLine: 'Legendary Creature — Wizard',
      }),
      card(PIECE_A, 'Combo Piece A'),
      card(PIECE_B, 'Combo Piece B'),
      card(RAMP, 'Ramp Rock', {
        typeLine: 'Artifact',
        types: ['artifact'],
        roles: ['ramp'],
        primaryRole: 'ramp',
        universesBeyond: false,
        synergyProduces: [],
        synergyWants: [],
        colorIdentity: [],
        colors: [],
      }),
      card(LAND, 'Mountain', {
        typeLine: 'Basic Land — Mountain',
        roles: ['land'],
        primaryRole: 'land',
        universesBeyond: false,
        synergyProduces: [],
        synergyWants: [],
        manaCost: null,
        manaValue: 0,
        types: ['land'],
      }),
      card(OFF_COLOR, 'Blue Thing', { colorIdentity: ['U'], colors: ['U'] }),
      ...GAME_CHANGERS.map((id, index) => card(id, `Game Changer ${index}`, { gameChanger: true })),
      card(GC_COMMANDER, 'Tergrid, Test Legend', {
        typeLine: 'Legendary Creature — God',
        gameChanger: true,
      }),
      card(EXTRA_TURN, 'Time Warp', {
        typeLine: 'Sorcery',
        types: ['sorcery'],
        oracleText: 'Target player takes an extra turn after this one.',
      }),
      card(LAND_DENIAL, 'Armageddon', {
        typeLine: 'Sorcery',
        types: ['sorcery'],
        oracleText: 'Destroy all lands.',
      }),
      card(NONLAND_WIPE, 'Ruinous Ultimatum', {
        typeLine: 'Sorcery',
        types: ['sorcery'],
        oracleText: 'Destroy all nonland permanents your opponents control.',
      }),
    ])
    const combo: Combo = {
      id: comboId('combo-1'),
      pieces: [PIECE_A, PIECE_B],
      prerequisites: '',
      steps: [],
      produces: ['infinite-mana'],
      colorIdentity: ['R'],
    }
    await insertCombos(db.pool, [combo])

    app = await buildServer({ pool: db.pool })
    await app.ready()

    deck = (
      await app.inject({
        method: 'POST',
        url: '/api/v1/decks',
        payload: {
          name: 'Analysis deck',
          commanders: [KROV],
          targetBracket: 3,
          archetype: 'midrange',
        },
      })
    ).json()
  }, 60_000)

  afterAll(async () => {
    await app?.close()
    await db?.drop()
  }, 60_000)

  describe('POST /api/v1/decks/:id/recommendations', () => {
    it('returns groups, each item carrying non-empty reasons (pillar P4)', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${deck.id}/recommendations`,
        payload: {},
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(Array.isArray(body.groups)).toBe(true)
      for (const group of body.groups) {
        for (const item of group.items) {
          // A recommendation the user cannot interrogate is a bug (AGENTS.md §8).
          expect(item.reasons.length).toBeGreaterThan(0)
        }
      }
    })

    it('never recommends an off-colour card', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: {},
        })
      ).json()

      const suggested = body.groups.flatMap((g: { items: { oracleId: string }[] }) =>
        g.items.map((i) => i.oracleId),
      )
      expect(suggested).not.toContain(OFF_COLOR)
    })

    it('reports every missing source in `unavailable` rather than omitting groups', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: {},
        })
      ).json()

      const keys = body.unavailable.map((u: { key: string }) => u.key)
      // Corpus statistics have no source at all (ADR-0008) — the client must be
      // told, not left to infer it from an absent group.
      expect(keys).toContain('statistics')
      const stats = body.unavailable.find((u: { key: string }) => u.key === 'statistics')
      expect(stats.reason).toMatch(/ADR-0008/)
    })

    it('returns an unfiltered result plus errors when the query does not parse', async () => {
      const unfiltered = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: {},
        })
      ).json()

      // Half of this parses. Applying that half would filter the pool to
      // creatures and look like a correct, smaller answer — the exact failure
      // doc 10 §10.4 forbids. The totals must match the unfiltered run.
      const partial = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: { query: 'is:creature typ:creature' },
        })
      ).json()

      expect(partial.query.errors.length).toBeGreaterThan(0)
      expect(partial.query.errors[0]).toHaveProperty('position')

      const totals = (b: { groups: { key: string; total: number }[] }) =>
        Object.fromEntries(b.groups.map((g) => [g.key, g.total]))
      expect(totals(partial)).toEqual(totals(unfiltered))
      expect(
        Object.values(partial.query.withheldByGroup as Record<string, number>).reduce(
          (a, b) => a + b,
          0,
        ),
      ).toBe(0)
    })

    it('reports withheldByGroup so a filtered-out card is never silently absent', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: { query: 'zzzznothing' },
        })
      ).json()

      expect(body.query.errors).toEqual([])
      expect(body.query).toHaveProperty('withheldByGroup')
      const withheld = Object.values(body.query.withheldByGroup) as number[]
      expect(withheld.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
    })

    it('honours limitPerGroup', async () => {
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${deck.id}/recommendations`,
          payload: { limitPerGroup: 1 },
        })
      ).json()

      for (const group of body.groups) expect(group.items.length).toBeLessThanOrEqual(1)
    })

    it('answers 404 for a deck that does not exist', async () => {
      const response = await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${randomUUID()}/recommendations`,
        payload: {},
      })

      expect(response.statusCode).toBe(404)
    })
  })

  describe('GET /api/v1/decks/:id/combo-index', () => {
    it('reports a non-zero degree for a card that completes a combo', async () => {
      const fresh = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/decks',
          payload: {
            name: 'Combo deck',
            commanders: [KROV],
            targetBracket: 3,
            archetype: 'combo',
          },
        })
      ).json()
      await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${fresh.id}/commands`,
        payload: {
          commands: [{ type: 'accept', oracleId: PIECE_A, origin: 'manual' }],
          idempotencyKey: randomUUID(),
          baseVersion: 1,
        },
      })

      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/combo-index` })
      ).json()

      // With A accepted, B now completes combo-1.
      expect(body.comboDegreeByOracleId[PIECE_B]).toBeGreaterThan(0)
    })
  })

  describe('GET /api/v1/decks/:id/analysis', () => {
    it('returns counts, targets, deficits and an archetype assessment', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/decks/${deck.id}/analysis`,
      })

      expect(response.statusCode).toBe(200)
      const body = response.json()
      expect(body.counts.total).toBeGreaterThan(0)
      expect(body.targets.length).toBeGreaterThan(0)
      expect(body.archetype.declared).toBe('midrange')
      expect(body.archetype).toHaveProperty('assessed')
      expect(body.archetype).toHaveProperty('drivers')
      expect(body.curve).toHaveProperty('averageManaValue')
      expect(body.colorBalance.pips).toHaveProperty('R')
    })

    it('reports a land deficit for a deck with no lands', async () => {
      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}/analysis` })
      ).json()

      const land = body.deficits.find(
        (d: { dimension: { role?: string } }) => d.dimension.role === 'land',
      )
      expect(land).toBeDefined()
      expect(land.delta).toBeLessThan(0)
    })

    it('does not assert a bracket verdict it has no rules for', async () => {
      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}/analysis` })
      ).json()

      // Wizards publishes a per-bracket value for one barometer of five
      // (DATA-05), so which bracket a deck IS still cannot be decided. Guessing
      // is what AGENTS.md §8 rejects: `assessed` is null and the gap is named.
      expect(body.bracket.target).toBe(3)
      expect(body.bracket.assessed).toBeNull()
      const keys = body.unavailable.map((u: { key: string }) => u.key)
      expect(keys).toContain('bracket-assessment')
    })

    it('checks commander eligibility rather than declaring it unavailable', async () => {
      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${deck.id}/analysis` })
      ).json()

      const keys = body.unavailable.map((u: { key: string }) => u.key)
      // The endpoint used to admit here that it skipped these checks entirely.
      expect(keys).not.toContain('commander-legality')
      expect(keys).not.toContain('commander-eligibility')
      const kinds = body.legality.problems.map((p: { kind: string }) => p.kind)
      expect(kinds).not.toContain('invalid-commander')
    })

    it('reports a deck already led by an ineligible card', async () => {
      /*
       * Written straight to the database, because the creation route refuses
       * this now — and that is exactly the deck this test is about. The decks
       * built before the check existed are still out there, and an analysis
       * that stayed quiet about them would leave the user with no way to find
       * out why their suggestions look wrong.
       */
      const id = deckId(randomUUID())
      await createDeck(db.pool, {
        id,
        ownerId: '00000000-0000-0000-0000-000000000001',
        name: 'Led by Sol Ring',
        commanders: [BAD_COMMANDER],
        targetBracket: 3,
        archetype: 'midrange',
        colorIdentity: [],
      })

      const body = (await app.inject({ method: 'GET', url: `/api/v1/decks/${id}/analysis` })).json()

      const problem = body.legality.problems.find(
        (p: { kind: string }) => p.kind === 'invalid-commander',
      )
      expect(problem).toBeDefined()
      expect(problem.oracleId).toBe(BAD_COMMANDER)
      expect(body.legality.legal).toBe(false)
    })

    it('reports the gap rather than a verdict when the corpus has not decided', async () => {
      // `canBeCommander` is null for every row until the re-ingest runs. Ruling
      // "ineligible" on that would call every deck illegal; ruling "eligible"
      // would be inventing the answer. It says it does not know.
      const id = deckId(randomUUID())
      await createDeck(db.pool, {
        id,
        ownerId: '00000000-0000-0000-0000-000000000001',
        name: 'Undecided commander',
        commanders: [UNDECIDED],
        targetBracket: 3,
        archetype: 'midrange',
        colorIdentity: ['R'],
      })

      const body = (await app.inject({ method: 'GET', url: `/api/v1/decks/${id}/analysis` })).json()

      const kinds = body.legality.problems.map((p: { kind: string }) => p.kind)
      expect(kinds).not.toContain('invalid-commander')
      const gap = body.unavailable.find((u: { key: string }) => u.key === 'commander-eligibility')
      expect(gap).toBeDefined()
      expect(gap.reason).toMatch(/re-ingest/)
    })

    describe('bracket checks (DATA-05)', () => {
      /** A deck at `targetBracket` holding `count` of the Game Changer fixtures. */
      const deckHolding = async (targetBracket: number, count: number) => {
        const fresh = (
          await app.inject({
            method: 'POST',
            url: '/api/v1/decks',
            payload: {
              name: `Bracket ${targetBracket} with ${count}`,
              commanders: [KROV],
              targetBracket,
              archetype: 'midrange',
            },
          })
        ).json()
        if (count > 0) {
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${fresh.id}/commands`,
            payload: {
              commands: GAME_CHANGERS.slice(0, count).map((id) => ({
                type: 'accept',
                oracleId: id,
                origin: 'manual',
              })),
              idempotencyKey: randomUUID(),
              baseVersion: 1,
            },
          })
        }
        return (
          await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
        ).json()
      }

      it('names the Game Changers the deck holds', async () => {
        const body = await deckHolding(3, 2)
        expect(body.bracket.gameChangers).toHaveLength(2)
        expect(body.bracket.gameChangers).toContain(GAME_CHANGERS[0])
      })

      it('reports no violation at the allowance', async () => {
        // Three is what Bracket 3 allows, quoted in brackets/rules.data.json.
        const body = await deckHolding(3, 3)
        expect(body.bracket.violations).toEqual([])
      })

      it('reports a violation one Game Changer past the allowance', async () => {
        const body = await deckHolding(3, 4)
        expect(body.bracket.violations).toHaveLength(1)
        expect(body.bracket.violations[0].flag).toBe('game-changer')
        expect(body.bracket.violations[0].allowed).toBe(3)
        expect(body.bracket.violations[0].actual).toBe(4)
      })

      it('reports a violation for a single Game Changer at bracket 1', async () => {
        const body = await deckHolding(1, 1)
        expect(body.bracket.violations).toHaveLength(1)
        expect(body.bracket.violations[0].allowed).toBe(0)
      })

      it('reports no violation at bracket 4, whatever the deck holds', async () => {
        const body = await deckHolding(4, 4)
        expect(body.bracket.violations).toEqual([])
      })

      it('counts a Game Changer in the command zone', async () => {
        // The command zone is the one place a Game Changer is guaranteed to be
        // available every game, so leaving commanders out of the count would
        // clear the deck hardest to defend. Bracket 2 allows none.
        const fresh = (
          await app.inject({
            method: 'POST',
            url: '/api/v1/decks',
            payload: {
              name: 'Legendary Game Changer',
              commanders: [GC_COMMANDER],
              targetBracket: 2,
              archetype: 'midrange',
            },
          })
        ).json()

        const body = (
          await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
        ).json()

        expect(body.bracket.gameChangers).toEqual([GC_COMMANDER])
        expect(body.bracket.violations).toHaveLength(1)
        expect(body.bracket.violations[0].actual).toBe(1)
      })

      /*
       * The three barometers Wizards names and does not quantify (ADR-0018).
       *
       * These are findings, not violations, and the two lists stay apart in the
       * response for that reason: a violation is a published allowance broken,
       * a finding is our own count of what the deck holds. A test that only
       * checked the counts would pass just as happily if the two were merged,
       * so the separation is asserted alongside them.
       */
      describe('barometer findings', () => {
        const deckOf = async (targetBracket: number, oracleIds: readonly string[]) => {
          const fresh = (
            await app.inject({
              method: 'POST',
              url: '/api/v1/decks',
              payload: {
                name: `Barometers ${targetBracket}`,
                commanders: [KROV],
                targetBracket,
                archetype: 'midrange',
              },
            })
          ).json()
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${fresh.id}/commands`,
            payload: {
              commands: oracleIds.map((id) => ({
                type: 'accept',
                oracleId: id,
                origin: 'manual',
              })),
              idempotencyKey: randomUUID(),
              baseVersion: 1,
            },
          })
          return (
            await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
          ).json()
        }

        const finding = (
          body: { bracket: { barometers: { findings: unknown[] } } },
          name: string,
        ) =>
          body.bracket.barometers.findings.find(
            (f) => (f as { barometer: string }).barometer === name,
          ) as { severity: string; count: number; cards: string[]; combos: string[] } | undefined

        it('errors on a card that takes an extra turn', async () => {
          const body = await deckOf(3, [EXTRA_TURN])
          const extra = finding(body, 'extra-turns')
          expect(extra).toBeDefined()
          expect(extra?.severity).toBe('error')
          expect(extra?.count).toBe(1)
          expect(extra?.cards).toEqual([EXTRA_TURN])
        })

        it('warns on land denial and leaves a nonland wipe out of the count', async () => {
          const body = await deckOf(3, [LAND_DENIAL, NONLAND_WIPE])
          const denial = finding(body, 'mass-land-denial')
          expect(denial?.severity).toBe('warn')
          expect(denial?.cards).toEqual([LAND_DENIAL])
        })

        it('warns on a two-card infinite the deck assembles', async () => {
          const body = await deckOf(3, [PIECE_A, PIECE_B])
          const infinite = finding(body, 'two-card-infinites')
          expect(infinite?.severity).toBe('warn')
          expect(infinite?.combos).toEqual(['combo-1'])
        })

        /*
         * Unconditional on the bracket, and that is the ADR-0018 boundary in a
         * test. Raising these only for brackets 1-3 would re-create the
         * per-bracket table Wizards retired on 2025-10-21; a bracket 5 deck gets
         * the same count, because the count is about the deck.
         */
        it('reports the same findings at bracket 5 as at bracket 1', async () => {
          // All three barometers at once, because a gate could be put on any one
          // of them and a deck holding only two would not notice.
          const held = [EXTRA_TURN, LAND_DENIAL, PIECE_A, PIECE_B]
          const low = await deckOf(1, held)
          const high = await deckOf(5, held)
          expect(low.bracket.barometers.findings).toHaveLength(3)
          expect(high.bracket.barometers.findings).toEqual(low.bracket.barometers.findings)
        })

        it('keeps the findings out of `violations` and says whose reading they are', async () => {
          const body = await deckOf(1, [EXTRA_TURN, LAND_DENIAL])
          // Bracket 1 allows no Game Changers and this deck holds none, so a
          // finding leaking into `violations` would be visible here and only
          // here.
          expect(body.bracket.violations).toEqual([])
          expect(body.bracket.assessed).toBeNull()
          expect(body.bracket.barometers.basis).toContain('not a Wizards bracket verdict')
        })

        it('reports an empty findings list for a deck that trips nothing', async () => {
          const body = await deckOf(3, [RAMP])
          expect(body.bracket.barometers.findings).toEqual([])
          // Still sent, so a client can say what was looked for.
          expect(body.bracket.barometers.basis).toBeTruthy()
        })
      })

      it('flags a Game Changer among the recommendations it offers', async () => {
        // The flag is surfaced, never used to filter (doc 03 §3.2): the card is
        // still offered, and the user is told what it is.
        const body = (
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${deck.id}/recommendations`,
            payload: {},
          })
        ).json()

        const items = body.groups.flatMap(
          (g: { items: { oracleId: string; bracketFlags: string[] }[] }) => g.items,
        )
        const flagged = items.filter((i: { bracketFlags: string[] }) =>
          i.bracketFlags.includes('game-changer'),
        )
        expect(flagged.length).toBeGreaterThan(0)
        // Nothing unflagged may sneak into that list either: a flag applied to
        // everything is as useless as a flag applied to nothing.
        for (const item of flagged) {
          expect([...GAME_CHANGERS, GC_COMMANDER]).toContain(item.oracleId)
        }
        const unflagged = items.filter(
          (i: { bracketFlags: string[] }) => !i.bracketFlags.includes('game-changer'),
        )
        expect(unflagged.length).toBeGreaterThan(0)
      })

      it('carries the provenance of the allowance to the client', async () => {
        // The product should be able to show where the rule came from and when,
        // which is the whole point of ADR-0006 reaching past the repository.
        const body = await deckHolding(3, 0)
        expect(body.bracket.rules.sourceUrl).toMatch(/^https:\/\/magic\.wizards\.com\//)
        expect(body.bracket.rules.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
      })

      it('carries the target bracket ENTRY, nulls included', async () => {
        /*
         * `violations` names the allowance only when the deck breaks it, so a
         * deck inside its allowance could otherwise be told how many Game
         * Changers it holds and never what it is allowed.
         *
         * The four nulls travel too, and they are the substance of ADR-0018:
         * a client that receives them can say "the format publishes no rule
         * here", which is a different claim from 'allowed'. A client that
         * received only the number would have to name the other four
         * barometers from memory — the hardcoded ruleset AGENTS.md §8 rejects.
         */
        const body = await deckHolding(3, 0)
        expect(body.bracket.rules.targetBracket).toEqual({
          bracket: 3,
          name: 'Upgraded',
          gameChangersAllowed: 3,
          massLandDenial: null,
          extraTurnChaining: null,
          twoCardInfinites: null,
          tutorDensity: null,
        })
      })

      it('carries the entry of the bracket the DECK targets, not a fixed one', async () => {
        // Reading bracket 3's row for every deck would tell a Bracket 1 builder
        // they may run three Game Changers.
        const body = await deckHolding(1, 0)
        expect(body.bracket.rules.targetBracket.bracket).toBe(1)
        expect(body.bracket.rules.targetBracket.gameChangersAllowed).toBe(0)
      })

      it('says "unlimited" at bracket 4 rather than a number', async () => {
        // The difference between "room for more" and "no limit at all" is not
        // recoverable from a count, and only this field carries it.
        const body = await deckHolding(4, 4)
        expect(body.bracket.rules.targetBracket.gameChangersAllowed).toBe('unlimited')
      })
    })

    it('lists an assembled combo once both pieces are accepted', async () => {
      const fresh = (
        await app.inject({
          method: 'POST',
          url: '/api/v1/decks',
          payload: {
            name: 'Assembled',
            commanders: [KROV],
            targetBracket: 3,
            archetype: 'combo',
          },
        })
      ).json()
      await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${fresh.id}/commands`,
        payload: {
          commands: [
            { type: 'accept', oracleId: PIECE_A, origin: 'manual' },
            { type: 'accept', oracleId: PIECE_B, origin: 'manual' },
          ],
          idempotencyKey: randomUUID(),
          baseVersion: 1,
        },
      })

      const body = (
        await app.inject({ method: 'GET', url: `/api/v1/decks/${fresh.id}/analysis` })
      ).json()

      expect(body.deckCombos).toHaveLength(1)
      expect(body.deckCombos[0].comboId).toBe('combo-1')
      expect(body.deckCombos[0].produces).toContain('infinite-mana')
    })

    it('answers 404 for a deck that does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/api/v1/decks/${randomUUID()}/analysis`,
      })

      expect(response.statusCode).toBe(404)
    })
  })

  /**
   * The archetype customiser end to end (doc 16).
   *
   * The domain tests prove the arithmetic; these prove the wire — that a number
   * typed into `PATCH /decks/:id` reaches the targets the analysis reports and
   * the recommendations are ordered by, and that it can be taken back off.
   */
  describe('per-deck target overrides (doc 16)', () => {
    /** A deck of its own, so tuning it cannot disturb the shared fixture deck. */
    const freshDeck = async (archetype = 'midrange'): Promise<{ id: string }> =>
      (
        await app.inject({
          method: 'POST',
          url: '/api/v1/decks',
          payload: { name: 'Tuned', commanders: [KROV], targetBracket: 3, archetype },
        })
      ).json()

    const analyse = async (id: string) =>
      (await app.inject({ method: 'GET', url: `/api/v1/decks/${id}/analysis` })).json()

    const idealOf = (
      body: { targets: { dimension: { role?: string }; ideal: number }[] },
      role: string,
    ) => body.targets.find((t) => t.dimension.role === role)?.ideal

    it('starts every deck on its archetype with nothing overridden', async () => {
      const body = await analyse((await freshDeck()).id)
      expect(body.targetOverrides).toEqual({})
      expect(body.targets.every((t: { source: string }) => t.source === 'archetype')).toBe(true)
      // With nothing overridden the preset IS the target, everywhere.
      for (const t of body.targets) expect(t.preset).toBe(t.ideal)
    })

    it('moves the target a builder typed and leaves the others alone', async () => {
      const fresh = await freshDeck()
      const before = await analyse(fresh.id)

      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().targetOverrides).toEqual({ roles: { 'role:ramp': 17 } })

      const after = await analyse(fresh.id)
      expect(idealOf(after, 'ramp')).toBe(17)
      // Sparse: every other row is still exactly what the archetype said, so
      // this deck keeps inheriting later revisions of all of them.
      expect(idealOf(after, 'draw')).toBe(idealOf(before, 'draw'))
      expect(idealOf(after, 'land')).toBe(idealOf(before, 'land'))
    })

    it('says which targets are the builder’s and what the archetype wanted', async () => {
      const fresh = await freshDeck()
      const presetRamp = idealOf(await analyse(fresh.id), 'ramp')
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })

      const body = await analyse(fresh.id)
      const ramp = body.targets.find(
        (t: { dimension: { role?: string } }) => t.dimension.role === 'ramp',
      )
      expect(ramp.source).toBe('custom')
      // The preset stays visible behind the number, which is doc 16's whole
      // interface argument: a box reading 17 cannot tell you it wanted 10.
      expect(ramp.preset).toBe(presetRamp)
      expect(
        body.targets.find((t: { dimension: { role?: string } }) => t.dimension.role === 'draw')
          .source,
      ).toBe('archetype')
    })

    it('reports null rather than zero for a dimension the archetype never named', async () => {
      // "The archetype wanted none of these" and "the archetype has no opinion
      // about these" are different, and only one of them is true here.
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:stax': 5 } } },
      })
      const stax = (await analyse(fresh.id)).targets.find(
        (t: { dimension: { role?: string } }) => t.dimension.role === 'stax',
      )
      expect(stax.ideal).toBe(5)
      expect(stax.preset).toBeNull()
    })

    it('moves the curve the panel draws, and keeps the preset beside it', async () => {
      const fresh = await freshDeck()
      const before = await analyse(fresh.id)
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { curve: { '6': 14 } } },
      })
      const after = await analyse(fresh.id)

      expect(after.curve.target[6].ideal).toBeGreaterThan(before.curve.target[6].ideal)
      expect(after.curve.target[6].source).toBe('custom')
      expect(after.curve.target[5].source).toBe('archetype')
      // The archetype's own shape survives alongside, for the sheet to show.
      expect(after.curve.preset[6].ideal).toBeCloseTo(before.curve.target[6].ideal, 9)
    })

    it('judges the deck against the same tuned curve in both endpoints', async () => {
      /*
       * The two endpoints build their curve target from the same three
       * arguments, and they MUST agree: an analysis panel saying the deck is
       * fine at two, beside an ordering that is pushing two-drops down because
       * it thinks the bucket is over-full, is worse than either alone. That is
       * the reason `deck-context` exists at all, and the curve is the one target
       * it does not carry.
       *
       * Observed through `curve-fit`, which the domain emits only for a card
       * with nothing else to say for itself — and whose `delta` is read off the
       * same `curveDeltas` the analysis reports.
       */
      const fresh = await freshDeck()
      await app.inject({
        method: 'POST',
        url: `/api/v1/decks/${fresh.id}/commands`,
        payload: {
          commands: [PIECE_A, PIECE_B, RAMP].map((oracle) => ({
            type: 'accept',
            oracleId: oracle,
            origin: 'manual',
          })),
          idempotencyKey: randomUUID(),
          baseVersion: 1,
        },
      })

      const curveFitDelta = async (): Promise<number | undefined> => {
        const body = (
          await app.inject({
            method: 'POST',
            url: `/api/v1/decks/${fresh.id}/recommendations`,
            payload: {},
          })
        ).json()
        return body.groups
          .flatMap((g: { items: { reasons: { kind: string; delta?: number }[] }[] }) => g.items)
          .flatMap((i: { reasons: { kind: string; delta?: number }[] }) => i.reasons)
          .find((r: { kind: string }) => r.kind === 'curve-fit')?.delta
      }

      // Every fixture card sits at mana value two, so bucket two is where the
      // deck actually is and the only bucket the assertion can be about.
      const before = await analyse(fresh.id)
      expect(await curveFitDelta()).toBe(before.curve.deltas[2].delta)
      // Over-full at two before the override, so the numbers below are a real
      // change rather than two zeroes agreeing by accident.
      expect(before.curve.deltas[2].delta).toBeLessThan(0)

      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { curve: { '2': 60 } } },
      })

      const after = await analyse(fresh.id)
      expect(after.curve.deltas[2].delta).toBe(0)
      expect(await curveFitDelta()).toBe(after.curve.deltas[2].delta)
    })

    it('reaches the recommendation reasons, not only the meters', async () => {
      /*
       * Pillar P4. The suggestion is now being made on the builder's authority
       * rather than the archetype's, and the reason has to say so — otherwise
       * the one number they could change is the one thing the explanation hides.
       */
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 20 } } },
      })
      const body = (
        await app.inject({
          method: 'POST',
          url: `/api/v1/decks/${fresh.id}/recommendations`,
          payload: {},
        })
      ).json()

      const reasons = body.groups
        .flatMap((g: { items: { reasons: { kind: string; source?: string }[] }[] }) => g.items)
        .flatMap((i: { reasons: { kind: string; source?: string }[] }) => i.reasons)
        .filter((r: { kind: string }) => r.kind === 'fills-deficit')
      expect(reasons.length).toBeGreaterThan(0)
      expect(reasons.some((r: { source?: string }) => r.source === 'custom')).toBe(true)
      // And every recommendation still explains itself at all (P4).
      for (const group of body.groups) {
        for (const item of group.items) expect(item.reasons.length).toBeGreaterThan(0)
      }
    })

    it('can be cleared with an empty object', async () => {
      const fresh = await freshDeck()
      const before = await analyse(fresh.id)
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 }, tolerance: 0.1 } },
      })
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: {} },
      })
      const after = await analyse(fresh.id)
      expect(after.targetOverrides).toEqual({})
      expect(after.targets).toEqual(before.targets)
    })

    it('can be cleared with an explicit null', async () => {
      // The way out has to be sayable in a body whose other fields all treat
      // absence as "leave alone". An override you cannot remove is a trap.
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      const patched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: null },
      })
      expect(patched.statusCode).toBe(200)
      expect(patched.json().targetOverrides).toEqual({})
    })

    it('leaves the overrides alone when the patch does not mention them', async () => {
      // Every other field on this endpoint behaves this way, and a target that
      // silently reset when a deck was renamed would be indistinguishable from
      // a bug the user could not describe.
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      const renamed = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { name: 'Renamed' },
      })
      expect(renamed.json().name).toBe('Renamed')
      expect(renamed.json().targetOverrides).toEqual({ roles: { 'role:ramp': 17 } })
    })

    it('carries the overrides through an archetype change', async () => {
      /*
       * Doc 16's second open question, answered: FOLLOW, and say so loudly.
       *
       * Silently discarding numbers the builder typed is worse than carrying
       * numbers they may not want, because only one of those is reversible —
       * there is a reset for the second and nothing at all for the first.
       */
      const fresh = await freshDeck('midrange')
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      const switched = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { archetype: 'control' },
      })
      expect(switched.json().archetype).toBe('control')
      expect(switched.json().targetOverrides).toEqual({ roles: { 'role:ramp': 17 } })

      const body = await analyse(fresh.id)
      expect(idealOf(body, 'ramp')).toBe(17)
      // The rest of the deck really did become a control deck, so the override
      // is riding on top of the new archetype rather than pinning the old one.
      expect(idealOf(body, 'draw')).toBe(
        idealOf(await analyse((await freshDeck('control')).id), 'draw'),
      )
    })

    it('replaces wholesale rather than merging', async () => {
      // A merge protocol has no way to express a deletion: "reset ramp" and
      // "leave ramp alone" are both an absent key.
      const fresh = await freshDeck()
      await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17, 'role:draw': 4 } } },
      })
      const second = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${fresh.id}`,
        payload: { targetOverrides: { roles: { 'role:ramp': 17 } } },
      })
      expect(second.json().targetOverrides).toEqual({ roles: { 'role:ramp': 17 } })
    })

    it('rejects a count that is not a whole card', async () => {
      for (const roles of [{ 'role:ramp': -1 }, { 'role:ramp': 3.5 }, { 'role:ramp': 100 }]) {
        const response = await app.inject({
          method: 'PATCH',
          url: `/api/v1/decks/${(await freshDeck()).id}`,
          payload: { targetOverrides: { roles } },
        })
        expect(response.statusCode, JSON.stringify(roles)).toBe(400)
      }
    })

    it('rejects a curve bucket that is not 0..7', async () => {
      // Kept, an `8` would be an override the curve never applies and the sheet
      // cannot show — an edit the builder made and can never find again.
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${(await freshDeck()).id}`,
        payload: { targetOverrides: { curve: { '8': 4 } } },
      })
      expect(response.statusCode).toBe(400)
    })

    it('rejects a tolerance outside 0..1', async () => {
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/v1/decks/${(await freshDeck()).id}`,
        payload: { targetOverrides: { tolerance: 1.5 } },
      })
      expect(response.statusCode).toBe(400)
    })
  })
})
