import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getDeck } from '@roundtable/db'
import type { CandidateGroupKey, ScoringWeights } from '@roundtable/domain'
import {
  acceptedSet,
  comboDegree,
  deckId,
  excludedSet,
  isOk,
  parseQuery,
  recommend,
  curveTarget,
  weightsFor,
} from '@roundtable/domain'
import { loadDeckContext } from '../deck-context.js'
import { notFound, sendProblem } from '../errors.js'
import { deckIdParams, recommendationsBody } from '../schemas.js'

export const registerRecommendationRoutes = (app: FastifyInstance, pool: Pool): void => {
  app.post(
    '/api/v1/decks/:id/recommendations',
    { schema: { params: deckIdParams, body: recommendationsBody } },
    async (req, rep) => {
      const id = (req.params as { id: string }).id
      const body = (req.body ?? {}) as {
        groups?: CandidateGroupKey[]
        limitPerGroup?: number
        query?: string
        weights?: Partial<ScoringWeights>
      }

      const deck = await getDeck(pool, deckId(id))
      if (deck === null) return sendProblem(rep, notFound(`No deck with id ${id}`))

      // A query that fails to parse is returned with the UNFILTERED result and
      // its errors, never partially applied (doc 10 §10.4). Applying the half
      // that happened to parse is a wrong answer that looks right.
      const parsed = parseQuery(body.query ?? '')
      const parseErrors = isOk(parsed) ? parsed.value.errors : parsed.error
      const queryNode = parseErrors.length > 0 ? null : isOk(parsed) ? parsed.value.ast : null

      const context = await loadDeckContext(pool, deck)

      const result = recommend({
        pool: context.pool,
        comboIndex: context.comboIndex,
        accepted: acceptedSet(deck),
        excluded: excludedSet(deck),
        colorIdentity: deck.colorIdentity,
        targets: context.targets,
        counts: context.counts,
        weights: weightsFor(deck.archetype, body.weights ?? {}),
        // The curve a deck of this archetype wants (ADR-0011).
        curveTarget: curveTarget(deck.archetype, deck.archetypeSecondary),
        query: queryNode,
        // No corpus statistics exist (ADR-0008), so groups 6-7 report as
        // unavailable rather than being silently absent.
        stats: null,
        ...(body.limitPerGroup !== undefined ? { limitPerGroup: body.limitPerGroup } : {}),
        ...(deck.budget?.maxCardUsd !== undefined ? { maxBudgetUsd: deck.budget.maxCardUsd } : {}),
      })

      const wanted = body.groups
      const groups = (
        wanted === undefined ? result.groups : result.groups.filter((g) => wanted.includes(g.key))
      ).map((g) => ({
        key: g.key,
        label: g.label,
        rationale: g.rationale,
        total: g.total,
        items: g.items,
      }))

      const withheldByGroup: Record<string, number> = {}
      for (const g of result.groups) withheldByGroup[g.key] = g.withheldByFilter

      return {
        datasetSnapshotId: context.snapshotId,
        generatedAt: new Date().toISOString(),
        groups,
        // Every source that is missing is named, in the shape doc 10 §10.4
        // defines, so degradation is visible instead of looking like "nothing
        // matched" (doc 05 §5.3).
        unavailable: [
          ...result.unavailable,
          ...context.missing.map((m) => ({ key: m.source, reason: m.reason })),
        ],
        query: {
          matched: result.groups.reduce((n, g) => n + g.total, 0),
          total: context.pool.length,
          withheldByGroup,
          errors: parseErrors,
        },
      }
    },
  )

  app.get(
    '/api/v1/decks/:id/combo-index',
    { schema: { params: deckIdParams } },
    async (req, rep) => {
      const id = (req.params as { id: string }).id
      const deck = await getDeck(pool, deckId(id))
      if (deck === null) return sendProblem(rep, notFound(`No deck with id ${id}`))

      const context = await loadDeckContext(pool, deck)
      const accepted = acceptedSet(deck)

      // Degree per candidate, so the client can patch incrementally on accept
      // without shipping the whole combo database to a phone (doc 09 §9.4).
      const comboDegreeByOracleId: Record<string, number> = {}
      for (const poolCard of context.pool) {
        const degree = comboDegree(context.comboIndex, accepted, poolCard.card.oracleId)
        if (degree > 0) comboDegreeByOracleId[poolCard.card.oracleId] = degree
      }

      return { comboDegreeByOracleId, snapshotId: context.snapshotId }
    },
  )
}
