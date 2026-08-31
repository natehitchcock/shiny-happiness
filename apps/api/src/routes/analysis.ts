import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { getDeck } from '@roundtable/db'
import type { CardType, CommanderInfo, OracleId, Role } from '@roundtable/domain'
import {
  BAROMETER_BASIS,
  BRACKET_DATA,
  NO_SINGLETON_EXCEPTIONS,
  acceptedSet,
  assessArchetype,
  bracketFindings,
  bracketViolations,
  // Aliased: `colorBalance` is the name of the response key AND of the local
  // holding it, and a function shadowed by a value of the same name reads as a
  // bug even when it is not one (the same reason `oracleId` is aliased in the
  // web app).
  colorBalance as deckColorBalance,
  deckGameChangers,
  loadBracketRules,
  deckCombos,
  deckId,
  findDeficits,
  curveDeltas,
  curveTarget,
  deckSynergy,
  hasTargetOverrides,
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
    const presetIdeals = new Map(
      context.presetTargets.map((t) => [dimensionKey(t.dimension), t.ideal]),
    )
    const assessment = assessArchetype(counts.byDimension)

    /*
     * What the deck IS, and what it MAKES (ADR-0024).
     *
     * One call, because the two charts must be counted over the same copies or
     * they cannot be read against each other. The whole computation is in
     * `packages/domain` rather than here: it is pure arithmetic over a deck and
     * a card map, it has degenerate cases worth unit-testing (a deck of one
     * colourless card, a corpus with no `producedMana`), and inlining it here
     * would put it somewhere only an integration test against Postgres could
     * reach.
     */
    const {
      identity,
      generation,
      cards: colorBalanceCards,
      producers,
    } = deckColorBalance(deck, cards)
    /*
     * `unknownProduction` is computed and deliberately NOT forwarded. It counts
     * cards whose production is unrecorded rather than empty, and it is
     * structurally 0 on this path: migration 0008 added `produced_mana` as
     * `NOT NULL DEFAULT '{}'`, so a row written before it and a fetchland are
     * the same bytes on disk. A field that can only ever be zero invites a
     * client to render a caveat that can never be true.
     */
    const colorBalance = { identity, generation, cards: colorBalanceCards, producers }

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

    const targetCurve = curveTarget(deck.archetype, deck.archetypeSecondary, deck.targetOverrides)
    // What the archetype alone would have asked for, so the sheet can show the
    // preset behind each pinned bucket (doc 16). Same call, minus the overrides,
    // so the two can never be computed differently.
    const presetCurve = hasTargetOverrides(deck.targetOverrides)
      ? curveTarget(deck.archetype, deck.archetypeSecondary)
      : targetCurve

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

    /*
     * The combos this deck actually assembles, as combos.
     *
     * Resolved once and shared with the bracket barometers below, rather than
     * resolved again there: the two-card-infinite finding and the `deckCombos`
     * block of the response are the same claim about the same deck, and reading
     * the index twice is how they would eventually stop agreeing.
     */
    const assembledCombos = deckCombos(comboIndex, accepted)
      .map((comboId) => comboIndex.byId.get(comboId))
      .filter((combo) => combo !== undefined)
    const assembled = assembledCombos.map((combo) => ({
      comboId: combo.id,
      pieces: combo.pieces,
      produces: combo.produces,
    }))

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
     *
     * `barometers` below is a different kind of claim and is kept apart from
     * `violations` for exactly that reason. A violation is Wizards' rule broken;
     * a finding is our own count of what the deck holds, carried with the
     * sentence that says so. Merging the two lists would erase the distinction
     * ADR-0018 exists to protect, and the client would have no way to redraw it.
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
        // part is missing rather than implying the whole feature is off — the
        // findings under `bracket.barometers` count the other three barometers
        // but cannot say what any bracket permits, which is what is missing.
        {
          key: 'bracket-assessment',
          reason:
            'only the Game Changers allowance is checked against a published rule. ' +
            'Wizards withdrew the tutor restriction and publishes no current ' +
            'per-bracket value for mass land denial, extra turns or two-card ' +
            'infinites, so those are reported as findings about the deck and no ' +
            'bracket is assessed',
        }
      : { key: 'bracket-assessment', reason: bracketRules.error.message }

    /*
     * Our own reading of the three barometers Wizards names but never quantifies
     * (ADR-0018) — counted over the deck's own cards and its assembled combos.
     *
     * Unconditional on the target bracket, deliberately. Gating them at bracket
     * 3 and below would re-create the per-bracket table the 2025-10-21 update
     * retired, which is the failure ADR-0006 exists to prevent; a count of what
     * the deck contains is true at every bracket and claims nothing about any.
     */
    const barometers = bracketFindings({
      cards: [...accepted].flatMap((oracleId) => {
        const card = cards.get(oracleId)
        return card === undefined ? [] : [card]
      }),
      assembled: assembledCombos,
    })

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
        /*
         * What the archetype wanted here, whether or not it was overridden
         * (doc 16). `source` on the target itself says WHICH of the two numbers
         * is in force; this says what the other one was.
         *
         * A dimension the override INVENTED — a midrange deck asking for five
         * stax pieces — has no preset, and `null` says so rather than `0`,
         * which would read as "the archetype wanted none of these" when the
         * truth is that the archetype has no opinion about them at all.
         */
        preset:
          presetIdeals.get(dimensionKey(t.dimension)) ?? (t.source === 'custom' ? null : t.ideal),
      })),
      /**
       * The deck's own overrides, echoed back so the sheet can render exactly
       * what it will be saving over. Derived state — `targets` above is the
       * thing that is actually used — but a client that had to reconstruct the
       * sparse set by diffing targets against presets would get a false
       * positive every time an override happened to equal the preset.
       */
      targetOverrides: deck.targetOverrides ?? {},
      /**
       * The semantics the builder said this deck is about, echoed the same way
       * and for the same reason. A SEPARATE key from `targetOverrides`, because
       * they are separate axes: one says how many ramp cards the deck should
       * hold, the other says which of two ramp cards to offer first, and a deck
       * may have opinions about both (doc 16).
       */
      semanticEmphasis: deck.semanticEmphasis ?? [],
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
        // The archetype's own shape, for the buckets the builder pinned. Same
        // shape as `target`; equal to it when nothing is overridden.
        preset: presetCurve,
        deltas: curveDeltas(counts.manaCurve, targetCurve),
        // Cards the user has committed to at each mana value, so the curve can
        // show what is settled and what is still moving.
        locked: lockedByBucket,
      },
      colorBalance,
      bracket: {
        target: deck.targetBracket,
        assessed: null,
        violations,
        // The offending cards themselves, so the UI can name them instead of
        // making the user find four Game Changers in a 100-card list.
        gameChangers: gameChangersInDeck,
        /*
         * The three barometers the format names but does not quantify.
         *
         * `basis` travels with the findings rather than sitting in a client
         * constant, because it is the sentence that stops them reading as a
         * bracket verdict, and a client that forgot to render it would turn our
         * count into Wizards' ruling. It is sent whether or not there are any
         * findings, so a deck with none still says what was looked for.
         */
        barometers: { basis: BAROMETER_BASIS, findings: barometers },
        // Where the allowance came from and when, carried to the client so the
        // provenance is visible in the product and not only in the repo.
        rules: bracketRules.ok
          ? {
              sourceUrl: bracketRules.value.sourceUrl,
              retrievedAt: bracketRules.value.retrievedAt,
              /*
               * The target bracket's published entry, sent WHOLE.
               *
               * `violations` carries the allowance only when the deck BREAKS
               * it, so a deck inside its allowance could be told how many Game
               * Changers it holds and not what it is allowed — and at bracket 4
               * or 5 could not tell "room for more" from "no limit at all".
               *
               * Whole rather than just the one number the check uses, because
               * the four nulls are the substance of ADR-0018. A client that
               * renders them says "the format publishes no rule here"; a client
               * handed only `gameChangersAllowed` would have to name the other
               * four barometers from memory, which is the hardcoded ruleset
               * AGENTS.md §8 rejects. If Wizards ever publishes one of them it
               * appears here with no client change.
               */
              targetBracket: bracketRules.value.byBracket.get(deck.targetBracket) ?? null,
            }
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
        /*
         * No `mana-production` gap is reported here, deliberately.
         *
         * `colorBalance.unknownProduction` counts cards whose production is not
         * merely empty but unrecorded, and it is always 0 on this path: migration
         * 0008 added `produced_mana` as `NOT NULL DEFAULT '{}'`, so a row written
         * before it and a fetchland read back identically. There is no gap this
         * route could detect, and a caveat wired to a branch that can never run
         * would be a claim about the corpus we cannot actually make.
         */
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
