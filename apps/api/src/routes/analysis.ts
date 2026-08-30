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

    // Summed over the CHEAPEST printing of each accepted card, commanders
    // included. An estimate, never a purchase price (ADR-0009 Q7, ADR-0011).
    let deckTotalUsd = 0
    let pricedCards = 0
    let unpricedCards = 0
    for (const entry of deck.entries) {
      if (entry.zone !== 'accepted') continue
      const price = context.printingFacts.get(entry.oracleId)?.priceUsd ?? null
      if (price === null) unpricedCards += 1
      else {
        deckTotalUsd += price
        pricedCards += 1
      }
    }
    for (const commander of deck.commanders) {
      const price = context.printingFacts.get(commander)?.priceUsd ?? null
      if (price === null) unpricedCards += 1
      else {
        deckTotalUsd += price
        pricedCards += 1
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
      prices: {
        // Rounded to cents; summing floats over 100 cards drifts otherwise.
        deckTotalUsd: Math.round(deckTotalUsd * 100) / 100,
        pricedCards,
        // Named so the UI can say the total is incomplete rather than implying
        // these cards are free.
        unpricedCards,
        budget: deck.budget,
        estimatedAt: context.snapshotId,
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
