import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getDeck } from '@roundtable/db'
import type { CardType, Color, CommanderInfo, OracleId, Role } from '@roundtable/domain'
import {
  BRACKET_DATA,
  NO_SINGLETON_EXCEPTIONS,
  acceptedSet,
  assessArchetype,
  bracketViolations,
  deckGameChangers,
  loadBracketRules,
  deckCombos,
  deckId,
  findDeficits,
  curveDeltas,
  curveTarget,
  deckSynergy,
  lockedComposition,
  lockedCurve,
  primaryRole,
  suggestCuts,
  validateDeck,
} from '@roundtable/domain'
import { dimensionKey } from '@roundtable/domain'
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

    const targetCurve = curveTarget(deck.archetype, deck.archetypeSecondary)

    // What the deck already does, so a cut hint knows what it would break.
    const synergy = deckSynergy(
      deck.commanders,
      deck.entries.filter((e) => e.zone === 'accepted').map((e) => e.oracleId),
      (id) => {
        const c = cards.get(id)
        return c === undefined ? undefined : { produces: c.synergyProduces, wants: c.synergyWants }
      },
    )

    const cuts = suggestCuts({
      deck,
      cards,
      counts,
      targets: context.targets,
      curveTarget: targetCurve,
      comboIndex,
      deckSynergy: synergy,
      priceOf: (id) => context.printingFacts.get(id)?.priceUsd ?? null,
      maxCardUsd: deck.budget?.maxCardUsd ?? null,
    })

    const lockedByBucket = lockedCurve(deck, cards, counts.manaCurve.length)
    const lockedByDimension = lockedComposition(deck, cards, (c) => primaryRole(c.roles))

    const assembled = deckCombos(comboIndex, accepted).map((comboId) => {
      const combo = comboIndex.byId.get(comboId)
      return { comboId, pieces: combo?.pieces ?? [], produces: combo?.produces ?? [] }
    })

    /*
     * Commander eligibility, from the corpus rather than from an empty map.
     *
     * This used to hand `validateDeck` no information at all and then throw
     * away the `invalid-commander` it inevitably produced, which is why a deck
     * led by Sol Ring analysed as fine. The flag is derived at ingest now, so
     * the check is real.
     *
     * A commander whose card row predates migration 0010 has `canBeCommander`
     * undefined, which is "not decided", not "no". Those are left out of the
     * map entirely and their `invalid-commander` is filtered below — feeding a
     * fabricated "yes" would be worse than a stated absence (doc 10 §10.9).
     */
    const commanderInfo = new Map<OracleId, CommanderInfo>()
    const undecided = new Set<OracleId>()
    for (const oracle of deck.commanders) {
      const eligible = cards.get(oracle)?.canBeCommander
      if (eligible === undefined) {
        undecided.add(oracle)
        continue
      }
      // `none` for every commander because the partnership rules are not
      // derived yet (see the `commander-partnership` gap below); the pairing
      // verdict this would produce is discarded rather than reported.
      commanderInfo.set(oracle, { canBeCommander: eligible, partnerRule: { kind: 'none' } })
    }

    const report = validateDeck(deck, cards, commanderInfo, NO_SINGLETON_EXCEPTIONS)
    const problems = report.problems.filter((p) => {
      if (p.kind === 'invalid-commander') return !undecided.has(p.oracleId)
      // Every commander is fed `partnerRule: none`, so a two-commander deck
      // always fails `partnershipAllowed` here. That verdict is about the
      // placeholder, not about the cards, so it is dropped and the gap named.
      return p.kind !== 'invalid-partnership'
    })

    /*
     * Bracket checks (DATA-05).
     *
     * The Game Changers list comes from the corpus, the allowance from the
     * fetched rules file. Commanders are counted too — a Game Changer in the
     * command zone is the one you are least able to avoid drawing — and they
     * need no separate term here because `acceptedSet` already seeds from them.
     *
     * `assessed` stays null even now. Deciding which bracket a deck IS needs all
     * five barometers, and Wizards currently publishes a per-bracket value for
     * exactly one of them, so a verdict here would be a guess dressed as an
     * answer. What CAN be said — this deck breaks the Game Changers allowance of
     * the bracket you chose — is said, with the arithmetic attached.
     */
    const bracketRules = loadBracketRules(BRACKET_DATA, context.gameChangers)
    const deckOracleIds = [...accepted]
    const gameChangersInDeck = bracketRules.ok
      ? deckGameChangers(bracketRules.value, deckOracleIds)
      : []
    const violations = bracketRules.ok
      ? bracketViolations(bracketRules.value, deck.targetBracket, deckOracleIds)
      : []
    const bracketUnavailable = bracketRules.ok
      ? // Loaded, and still only one barometer deep. Named so the UI says which
        // part is missing rather than implying the whole feature is off.
        {
          key: 'bracket-assessment',
          reason:
            'only the Game Changers allowance is checked. Wizards withdrew the tutor ' +
            'restriction and publishes no current per-bracket value for mass land ' +
            'denial, extra turns or two-card infinites, so no bracket is assessed',
        }
      : { key: 'bracket-assessment', reason: bracketRules.error.message }

    return {
      counts: {
        total: counts.total,
        byRole: fromMap<Role>(counts.byRole),
        byType: fromMap<CardType>(counts.byType),
        byManaValue: counts.manaCurve,
      },
      targets: context.targets.map((t) => ({
        ...t,
        // Locked count per role, for the committed portion of each bar.
        locked: lockedByDimension.get(dimensionKey(t.dimension)) ?? 0,
        actual: counts.byDimension.get(dimensionKey(t.dimension)) ?? 0,
      })),
      cuts,
      deficits: deficits.map((d) => ({ dimension: d.dimension, delta: d.delta })),
      archetype: {
        declared: deck.archetype,
        secondary: deck.archetypeSecondary,
        assessed: assessment.assessed,
        confidence: assessment.confidence,
        drivers: assessment.drivers,
      },
      curve: {
        averageManaValue: counts.averageManaValue,
        histogram: counts.manaCurve,
        // The target shape and the per-bucket gap, so the panel can draw both
        // and say which mana values need more or fewer cards (ADR-0011).
        target: targetCurve,
        deltas: curveDeltas(counts.manaCurve, targetCurve),
        // Cards the user has committed to at each mana value, so the curve can
        // show what is settled and what is still moving.
        locked: lockedByBucket,
      },
      colorBalance: {
        pips: pips as Record<Color, number>,
        sources: sources as Record<Color, number>,
      },
      bracket: {
        target: deck.targetBracket,
        assessed: null,
        violations,
        // The offending cards themselves, so the UI can name them instead of
        // making the user find four Game Changers in a 100-card list.
        gameChangers: gameChangersInDeck,
        // Where the allowance came from and when, carried to the client so the
        // provenance is visible in the product and not only in the repo.
        rules: bracketRules.ok
          ? { sourceUrl: bracketRules.value.sourceUrl, retrievedAt: bracketRules.value.retrievedAt }
          : null,
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
        bracketUnavailable,
        /*
         * Both entries are conditional, which is the point: the flat
         * "eligibility is not stored" line that used to sit here was reported
         * for every deck forever, so it said nothing about any particular one.
         *
         * A single-commander deck on an ingested corpus now gets neither, and
         * `legality.problems` is the whole answer.
         */
        ...(undecided.size > 0
          ? [
              {
                key: 'commander-eligibility',
                reason: `eligibility is not stored for ${undecided.size} of this deck's commanders; the corpus predates migration 0010 and needs a re-ingest`,
              },
            ]
          : []),
        ...(deck.commanders.length > 1
          ? [
              {
                key: 'commander-partnership',
                reason:
                  'partner rules are not derived at ingest, so whether these two commanders may be paired is not checked; each is checked on its own',
              },
            ]
          : []),
      ],
    }
  })
}
