import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getDeck } from '@roundtable/db'
import type { CandidateGroupKey, ComboId, ScoringWeights } from '@roundtable/domain'
import {
  BRACKET_DATA,
  acceptedSet,
  comboDegree,
  deckGameChangers,
  deckId,
  deckLandsFrom,
  excludedSet,
  isOk,
  loadBracketRules,
  matchesQuery,
  parseQuery,
  recommend,
  curveTarget,
  deckSynergy,
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
        columns?: string[]
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

      /**
       * How many more Game Changers this deck may take before it breaks the
       * bracket the builder chose (ADR-0044).
       *
       * Computed HERE rather than in `recommend`, because the Game Changers
       * list lives in the corpus — Scryfall's `game_changer` boolean, so it
       * rides the nightly ingest — and `packages/domain` does no IO (R1).
       * `context.gameChangers` is already loaded for the analysis endpoint;
       * this is the same set read by the same loader, so the two endpoints
       * cannot disagree about which cards count.
       *
       * `0` WHEN THE RULES WILL NOT LOAD. `loadBracketRules` refuses when the
       * corpus supplies no Game Changers at all, precisely so a deck full of
       * them cannot pass Bracket 1 vacuously (`bracket-rules.ts`). Reading that
       * refusal as "unlimited" here would reintroduce the same vacuous pass one
       * layer up, on the one surface that presents a card as a pick the builder
       * need not think about.
       */
      const bracketRules = loadBracketRules(BRACKET_DATA, context.gameChangers)
      const allowed = bracketRules.ok
        ? (bracketRules.value.byBracket.get(deck.targetBracket)?.gameChangersAllowed ?? 0)
        : 0
      const held = bracketRules.ok
        ? deckGameChangers(bracketRules.value, [...acceptedSet(deck)]).length
        : 0
      const gameChangerBudget =
        allowed === 'unlimited' ? ('unlimited' as const) : Math.max(0, allowed - held)

      /*
       * What a fetchland could actually find in THIS deck.
       *
       * Computed here for the same reason `gameChangerBudget` is: `recommend`
       * is pure and cannot look, and in this case it could not look even if it
       * were allowed to — `findEligibleCards` filters basic lands out of the
       * candidate pool in SQL, so the deck's twelve Islands are not in
       * `context.pool` at all. `context.cards` holds the deck's own cards,
       * loaded already for the composition count, and is the only place the
       * answer exists.
       *
       * ACCEPTED cards only. A card in `considering` is not in the library yet,
       * and a fetch recommended on the strength of a basic the builder has not
       * taken is exactly the dead draw this is here to prevent.
       */
      const accepted = acceptedSet(deck)
      const deckLands = deckLandsFrom(
        [...accepted].flatMap((id) => {
          const card = context.cards.get(id)
          return card === undefined ? [] : [card]
        }),
      )

      const result = recommend({
        pool: context.pool,
        comboIndex: context.comboIndex,
        accepted,
        excluded: excludedSet(deck),
        colorIdentity: deck.colorIdentity,
        targets: context.targets,
        counts: context.counts,
        weights: weightsFor(deck.archetype, body.weights ?? {}),
        // The curve a deck of this archetype wants (ADR-0011), as tuned by this
        // deck's own overrides (doc 16). The analysis endpoint builds the same
        // target from the same three arguments; the two MUST agree, or the panel
        // says the deck is short at two while the ordering thinks otherwise.
        curveTarget: curveTarget(deck.archetype, deck.archetypeSecondary, deck.targetOverrides),
        // What this deck already does and wants, commander weighted (ADR-0011).
        deckSynergy: deckSynergy(
          deck.commanders,
          deck.entries.filter((e) => e.zone === 'accepted').map((e) => e.oracleId),
          (id) => {
            const card = context.cards.get(id)
            return card === undefined
              ? undefined
              : { produces: card.synergyProduces, wants: card.synergyWants }
          },
        ),
        // What the builder said this deck is ABOUT, as opposed to what it
        // happens to do. Its own scoring term — it reorders within a group and
        // never changes which group a card is in (pillar P5).
        emphasis: deck.semanticEmphasis ?? [],
        query: queryNode,
        // No corpus statistics exist (ADR-0008), so groups 6-7 report as
        // unavailable rather than being silently absent.
        stats: null,
        // What the staples phase may spend without pushing the deck past its
        // own bracket (ADR-0044). Read by nothing else — every other group
        // surfaces bracket flags and filters on none of them (doc 03 §3.2).
        gameChangerBudget,
        // What a fetchland can find here. Absent would mean "nothing", so this
        // is passed unconditionally rather than spread — a deck with no basics
        // sends an empty set and gets fetches scored at zero, which is the
        // answer, not a missing field.
        deckLands,
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
        /*
         * Each completed combo, expanded to its pieces.
         *
         * `completedCombos` is a list of combo IDs, which is exactly enough to
         * count and nothing at all to read. The UI lets you open "completes 3
         * combos" to see WHICH three, and a bare id cannot answer that.
         *
         * Pieces go out as oracle ids, not names: every piece of a COMPLETED
         * combo is by definition a card already in the deck, so the client has
         * it hydrated and can name it without another request. `produces` rides
         * along because it is the point of the combo.
         */
        items: g.items.map((item) => ({
          ...item,
          combos: item.completedCombos.flatMap((id) => {
            const combo = context.comboIndex.byId.get(id as ComboId)
            return combo === undefined
              ? []
              : [{ id: combo.id, pieces: combo.pieces, produces: combo.produces }]
          }),
        })),
      }))

      /**
       * Evaluate each column query per row.
       *
       * Columns do NOT filter and do NOT reorder: the groups and their ranking
       * are exactly what they would have been, and this only answers "which of
       * these match" for each one. That is the whole distinction from `query`.
       *
       * Evaluated against the returned recommendations rather than the raw pool,
       * so deck-relative fields like `combo>=2` mean the same thing in a column
       * as they do in a filter.
       */
      const poolByOracleId = new Map(context.pool.map((p) => [p.card.oracleId, p]))
      const columnResults = (body.columns ?? []).map((source) => {
        const parsedColumn = parseQuery(source)
        const columnErrors = isOk(parsedColumn) ? parsedColumn.value.errors : parsedColumn.error
        if (columnErrors.length > 0) {
          return { query: source, matched: [], error: columnErrors[0]?.message ?? 'bad query' }
        }
        const ast = isOk(parsedColumn) ? parsedColumn.value.ast : null

        const matched: string[] = []
        for (const group of result.groups) {
          for (const item of group.items) {
            const pooled = poolByOracleId.get(item.oracleId)
            if (pooled === undefined) continue
            const candidate = {
              card: pooled.card,
              comboDegree: item.comboDegree,
              nearCombosAt1: item.nearCombosAt1,
              roles: pooled.roles,
              bracketFlags: pooled.bracketFlags,
              priceUsd: pooled.priceUsd,
              rarity: pooled.rarity,
              setCode: pooled.setCode,
              power: pooled.power,
              toughness: pooled.toughness,
              reserved: pooled.reserved,
              group: group.key,
              /*
               * Read off the ITEM, not recomputed from the card.
               *
               * This is the whole of "the filter agrees with the column": the
               * numbers the client draws in the impact and efficiency cells are
               * `item.impact.score` and `item.efficiency.score`, and a column
               * of `impact>=6` ticks exactly the rows whose own cell says 6 or
               * more, by construction rather than by two implementations
               * happening to match.
               *
               * The `?? 0` is unreachable — `recommend` sets both on every item
               * — but the fields are optional on `Recommendation` (AGENTS.md
               * R2 made them additive), so the type needs an answer. Zero is
               * the honest one: it is what a card with no rules text scores, so
               * a build that somehow omitted them would drop out of `impact>=6`
               * rather than silently pass it.
               */
              impact: item.impact?.score ?? 0,
              efficiency: item.efficiency?.score ?? 0,
            }
            if (matchesQuery(ast, candidate)) matched.push(item.oracleId)
          }
        }
        return { query: source, matched }
      })

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
        columns: columnResults,
        /*
         * The emphasis, and how much of the pool each tag actually reaches.
         *
         * Sent even when `supporting` is healthy, so the chips above the
         * commander can be rendered from the same response that scored against
         * them. `supporting: 0` is the case this exists for: emphasis never
         * filters, so an emphasis nothing supports returns a completely normal
         * list, and without this line the builder has no way to tell that from
         * an emphasis that worked.
         */
        emphasis: result.emphasis,
        /*
         * The same count for every tag, which is what lets the interface RANK
         * the semantics it offers next to a chosen focus.
         *
         * Those are by definition tags the deck does not emphasise, so the
         * report above cannot reach them; without this the offer would be
         * ordered by nothing, and would lead with whichever tag sorts first
         * even when the deck's colours contain no card that supports it.
         *
         * One entry per `SYNERGY_TAGS` member, computed in the pass that
         * already produced `emphasis`.
         */
        tagSupport: result.tagSupport,
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
