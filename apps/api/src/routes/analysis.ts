import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getDeck } from '@roundtable/db'
import type { CardType, Color, Role } from '@roundtable/domain'
import {
  NO_SINGLETON_EXCEPTIONS,
  acceptedSet,
  assessArchetype,
  deckCombos,
  deckId,
  findDeficits,
  validateDeck,
} from '@roundtable/domain'
import { loadDeckContext } from '../deck-context.js'
import { notFound, sendProblem } from '../errors.js'
import { deckIdParams } from '../schemas.js'

/** JSON has no Map. Every count map crosses the wire as a plain object. */
const fromMap = <K extends string>(map: ReadonlyMap<K, number>): Record<string, number> =>
  Object.fromEntries(map)

export const registerAnalysisRoutes = (app: FastifyInstance, pool: Pool): void => {
  app.get('/api/v1/decks/:id/analysis', { schema: { params: deckIdParams } }, async (req, rep) => {
    const id = (req.params as { id: string }).id
    const deck = await getDeck(pool, deckId(id))
    if (deck === null) return sendProblem(rep, notFound(`No deck with id ${id}`))

    const context = await loadDeckContext(pool, deck)
    const { counts, cards, comboIndex } = context
    const accepted = acceptedSet(deck)

    const deficits = findDeficits(counts, context.targets)
    const assessment = assessArchetype(counts.byDimension)

    // Colour pips from mana costs; sources from the accepted lands' identity.
    const pips: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
    const sources: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 }
    for (const oracleId of accepted) {
      const card = cards.get(oracleId)
      if (card === undefined) continue
      for (const symbol of card.manaCost?.match(/\{([WUBRG])\}/g) ?? []) {
        const color = symbol.slice(1, -1)
        pips[color] = (pips[color] ?? 0) + 1
      }
      if (card.types.includes('land')) {
        for (const color of card.colorIdentity) sources[color] = (sources[color] ?? 0) + 1
      }
    }

    const assembled = deckCombos(comboIndex, accepted).map((comboId) => {
      const combo = comboIndex.byId.get(comboId)
      return { comboId, pieces: combo?.pieces ?? [], produces: combo?.produces ?? [] }
    })

    // Commander eligibility is not stored yet, so `validateDeck` is given an
    // empty map and will report `invalid-commander`. Rather than feed it a
    // fabricated "yes", the problem is filtered out and the gap is reported in
    // `unavailable` — a legality verdict built on invented data is worse than a
    // stated absence (doc 10 §10.9).
    const report = validateDeck(deck, cards, new Map(), NO_SINGLETON_EXCEPTIONS)
    const problems = report.problems.filter((p) => p.kind !== 'invalid-commander')

    return {
      counts: {
        total: counts.total,
        byRole: fromMap<Role>(counts.byRole),
        byType: fromMap<CardType>(counts.byType),
        byManaValue: counts.manaCurve,
      },
      targets: context.targets,
      deficits: deficits.map((d) => ({ dimension: d.dimension, delta: d.delta })),
      archetype: {
        declared: deck.archetype,
        secondary: deck.archetypeSecondary,
        assessed: assessment.assessed,
        confidence: assessment.confidence,
        drivers: assessment.drivers,
      },
      curve: { averageManaValue: counts.averageManaValue, histogram: counts.manaCurve },
      colorBalance: {
        pips: pips as Record<Color, number>,
        sources: sources as Record<Color, number>,
      },
      bracket: {
        target: deck.targetBracket,
        // `assessed` needs the official bracket rules and the Game Changers
        // list, which DATA-05 has not populated; asserting a bracket from an
        // empty rules file is exactly what AGENTS.md §8 rejects. Reported as
        // unavailable instead of guessed.
        assessed: null,
        violations: [],
      },
      deckCombos: assembled,
      legality: { legal: problems.length === 0, problems },
      unavailable: [
        ...context.missing.map((m) => ({ key: m.source, reason: m.reason })),
        {
          key: 'bracket-assessment',
          reason: 'brackets/rules.data.json is not populated (DATA-05)',
        },
        {
          key: 'commander-legality',
          reason: 'commander eligibility is not stored yet; those checks are skipped',
        },
      ],
    }
  })
}
