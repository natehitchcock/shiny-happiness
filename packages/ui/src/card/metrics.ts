/**
 * Reading the two card-intrinsic metrics — impact and efficiency (doc 18).
 *
 * Everything here is pure and string-shaped so it can be tested without a DOM.
 * `Metrics.tsx` only arranges what this returns.
 *
 * THE PROBLEM THIS FILE EXISTS TO SOLVE. Both metrics were computed, persisted
 * and made filterable (ADR-0025) before anything drew them, and the naive draw —
 * `Impact 6.12` — is worse than drawing nothing. 6.12 out of what? High or low?
 * Because of what? A number with no stated range is not information, it is a
 * decoration that looks like information.
 *
 * So each metric is rendered as a value, a way to place that value, and the
 * model's own reasons for it. The two are placed DIFFERENTLY and on purpose;
 * see `IMPACT_MAX` and `efficiencyWorking` below.
 */

/**
 * `CardImpact` from `@roundtable/domain`, as a view model.
 *
 * Restated rather than imported because `@roundtable/ui` deliberately does not
 * depend on `@roundtable/domain` — see the docblock on `types.ts`, which gives
 * the reasoning for the whole package. The structural match is not left to
 * chance: `apps/web/src/metrics-contract.test.ts` imports both and fails if the
 * domain type stops assigning to this one.
 */
export interface ImpactView {
  readonly score: number
  readonly breadth: 'none' | 'one' | 'few' | 'several' | 'variable' | 'unbounded'
  readonly persistence: 'one-shot' | 'activated' | 'triggered' | 'upkeep'
  readonly stakes: 'self' | 'own' | 'opposing' | 'player'
  readonly symmetry: 'none' | 'symmetric' | 'one-sided'
  readonly severity: 'none' | 'tap' | 'flicker' | 'bounce' | 'damage' | 'destroy' | 'exile'
  readonly scales: boolean
  readonly fragile: boolean
}

/**
 * Where this card's role sits, as a view model. Same rule as `ImpactView`.
 *
 * `RoleImpactBand` + `impactRolePlacement` + `roleImpactIsMostlyUnreadable`
 * from `@roundtable/domain`, flattened. The two derived fields arrive already
 * decided rather than being recomputed here, and that is deliberate: a
 * placement computed in the renderer could disagree with the one the domain
 * would give, and the whole point of the line is that its cutoffs are the
 * corpus's rather than the interface's. This file formats; it does no
 * arithmetic on corpus data.
 *
 * The structural match is checked, not promised —
 * `apps/web/src/metrics-contract.test.ts` imports both and fails if the domain
 * types stop assigning to these.
 */
export interface ImpactRoleView {
  /** The role name, exactly as `RoleDot` prints it on the badge above. */
  readonly role: string
  /** Commander-legal cards holding this role. */
  readonly n: number
  readonly q1: number
  readonly q3: number
  readonly placement: 'bottom-quarter' | 'middle-half' | 'top-quarter'
  /** More than half the role names nothing the model can count. */
  readonly mostlyUnreadable: boolean
  /** How many of the `n` name nothing the model can count. */
  readonly noCountableEffect: number
}

/** `CardEfficiency` from `@roundtable/domain`, as a view model. Same rule. */
export interface EfficiencyView {
  readonly score: number
  readonly statSurplus: number
  readonly effectValue: number
  readonly baseline: number
  readonly cost: number
}

/**
 * The top of the impact scale: 22.176.
 *
 * MIRRORS `IMPACT_MAX` in `packages/domain/src/impact.ts`, where it is derived
 * from the four tier tables rather than written down. The duplication is the
 * price of `@roundtable/ui` not depending on `@roundtable/domain`, and it is
 * paid with a test rather than a promise — `apps/web/src/metrics-contract.test.ts`
 * imports both constants and asserts they are equal, so moving a rung in the
 * domain fails a build instead of silently mis-drawing every meter.
 *
 * Rejected: taking the maximum as a prop. It pushes the same constant into
 * every call site instead of one, and `Detail` would still need a default —
 * which is this constant, in this file, with one more indirection in front.
 *
 * Rejected: the "roughly 0–13" the domain docblock used to claim. It was
 * measured wrong (ADR-0025: 93 of 1,448 rows above 13), and a meter drawn
 * against it would have pegged the best cards in the format at "full".
 */
export const IMPACT_MAX = 22.176

/**
 * A metric value as text — the stored number, unrounded.
 *
 * ADR-0025 §2 and doc 18 §18.7 both bind this: the filter compares the raw
 * score, so **a renderer that rounds must move the rounding into `impact.ts`
 * where the predicate reads it too**. Nothing has, so this rounds nowhere.
 * `cardImpact` and `cardEfficiency` already quantise to three decimals at
 * source, so there is exactly one number per card per metric and this is it.
 *
 * The visible cost is ragged decimal counts — `6.12` beside `13.464` beside
 * `7.2`. That was the rejected alternative: `toFixed(2)` looks tidier and would
 * make `impact>=6.13` drop a row whose own cell says 6.13, which is precisely
 * the failure ADR-0025 was written to prevent. Tidy is not worth a filter that
 * disagrees with the screen.
 */
export const metricValue = (n: number): string => String(n)

/** Where the score sits on the meter, as a percentage. Clamped, never past the end. */
export const impactFraction = (score: number): number =>
  Math.max(0, Math.min(100, (score / IMPACT_MAX) * 100))

/**
 * The tiers, in the words a Magic player would use.
 *
 * USING THE TIERS IS THE POINT, not a garnish on the number. `breadth:
 * 'unbounded'` and `stakes: 'player'` are the actual reasons a card scores 18
 * rather than 2, they are already on the wire (doc 18 §18.8), and they are the
 * only part of this a reader can check against the card in front of them. A
 * score with its reasons is a different product from a score alone: one can be
 * disbelieved usefully, the other can only be taken on trust.
 *
 * Rejected: printing the raw tier names (`unbounded`, `one-shot`, `opposing`).
 * They are the model's vocabulary, not the game's, and "opposing" in particular
 * reads as a claim about targeting restrictions that the tier does not make.
 *
 * Rejected: deriving a letter grade or a band from the score. Every cutoff
 * would be invented here, in a renderer, and would then be the interface's
 * opinion rather than the model's — and doc 18 §18.9 already declined to give
 * the model bands.
 */
const REACH: Readonly<Record<ImpactView['breadth'], string>> = {
  none: 'nothing it can count',
  one: 'one thing',
  few: 'up to two things',
  several: 'a few things',
  variable: 'as many as X pays for',
  unbounded: 'everything at once',
}

/**
 * REACH SAYS WHOSE, when the model knows whose.
 *
 * "Everything at once" is exactly right for a wrath and an over-claim on every
 * other unbounded card. Agatha's Soul Cauldron reaches the creatures you
 * control and the graveyards — a real unbounded set, and nothing like
 * everything — and reporting it as "everything at once" is the line the product
 * owner read and disbelieved. Craterhoof Behemoth had carried the same
 * over-claim since this file was written; it was only ever noticed on a card
 * whose other two rows made it obvious.
 *
 * NO NEW FIELD. `symmetry` and `stakes` are already on the wire and already
 * decide the "Falls on" row directly below, so the refinement costs nothing and
 * cannot disagree with the line under it. A `symmetric` effect keeps the
 * unqualified words because it genuinely is everything — that is what the 0.85
 * discount is charged for.
 *
 * `player` stakes keep them too, and deliberately. `unbounded` + `player` is
 * both "each opponent loses 3 life" and "all permanents target player
 * controls", and the payload cannot tell those apart; a phrase that is true of
 * both beats a guess that is wrong for one, which is the rule `efficiencyWorking`
 * already follows for `statSurplus === 0`.
 */
const reachOf = (impact: ImpactView): string => {
  if (impact.breadth !== 'unbounded' || impact.symmetry !== 'one-sided') {
    return REACH[impact.breadth]
  }
  if (impact.stakes === 'own' || impact.stakes === 'self') return 'your whole side at once'
  if (impact.stakes === 'opposing') return "an opponent's whole side at once"
  return REACH.unbounded
}

const REPEATS: Readonly<Record<ImpactView['persistence'], string>> = {
  'one-shot': 'once, then it is done',
  activated: 'each time you pay for it',
  triggered: 'each time it triggers',
  upkeep: 'every upkeep',
}

/**
 * What is left of the thing afterwards (doc 18 §18.17).
 *
 * The register is the pane's own — these read as the end of a sentence starting
 * "Ends up", the way "Reach" reads as "everything at once". `none` has no entry
 * because it draws no row at all: 79.5% of the corpus removes nothing, and a
 * row saying so on four cards in five is noise rather than information.
 *
 * `damage` says out loud that it is not always lethal, because that is the one
 * rung whose severity is probabilistic and a reader who is not told will assume
 * otherwise.
 */
const ENDS_UP: Readonly<Record<Exclude<ImpactView['severity'], 'none'>, string>> = {
  tap: 'tapped, and still there',
  flicker: 'right back where it was',
  bounce: "in its owner's hand",
  damage: 'damaged, and dead only sometimes',
  destroy: 'in the graveyard',
  exile: 'gone for good',
}

const FALLS_ON: Readonly<Record<ImpactView['stakes'], string>> = {
  self: 'itself',
  own: 'your own side',
  opposing: "an opponent's side",
  player: 'a player, not the board',
}

/**
 * Symmetry qualifies the stakes rather than replacing it.
 *
 * A wrath's stakes are `opposing` AND it is `symmetric`, and both halves are
 * true of the card: it is pointed at the opponents' boards and it takes yours
 * with it. Showing only one of them would drop the half the 0.85 discount is
 * charged for.
 *
 * TWO THINGS HERE ARE NOT DECORATION, and both were found by running the model
 * over real cards rather than by reasoning about the tiers:
 *
 *   - `one-sided` does not mean "not yours". It means "does not hit everyone
 *     equally", and Craterhoof Behemoth is `own` + `one-sided` — the side it
 *     spares is the opponents'. A flat "— never yours" appended to the stakes
 *     produced "your own side — never yours", which is a contradiction printed
 *     under a card's own text. So the qualifier is dropped whenever the stakes
 *     already say the effect is yours.
 *   - `player` stakes are about a person, not a board. "never your board" is
 *     the wrong noun for Torment of Hailfire, which takes life and cards.
 */
const qualifier = (stakes: ImpactView['stakes'], symmetry: ImpactView['symmetry']): string => {
  if (symmetry === 'none') return ''
  const you = stakes === 'player' ? 'you' : 'your board'
  if (symmetry === 'symmetric') return `, ${you} included`
  if (stakes === 'own' || stakes === 'self') return ''
  return `, never ${you}`
}

export interface MetricRow {
  readonly label: string
  readonly value: string
}

/**
 * The tier rows. Empty for a card with no rules text — see `impactNotes`.
 *
 * "Ends up" is drawn ONLY when the card removes something. It is the one row
 * that does not apply to every card, and printing "Ends up: nothing" on the
 * 79.5% of the corpus with `severity: 'none'` would be a row that never varies
 * — which is a row that stops being read.
 */
export const impactRows = (impact: ImpactView): readonly MetricRow[] => {
  if (impact.score === 0) return []
  return [
    { label: 'Reach', value: reachOf(impact) },
    { label: 'Repeats', value: REPEATS[impact.persistence] },
    {
      label: 'Falls on',
      value: FALLS_ON[impact.stakes] + qualifier(impact.stakes, impact.symmetry),
    },
    ...(impact.severity === 'none' ? [] : [{ label: 'Ends up', value: ENDS_UP[impact.severity] }]),
  ]
}

/**
 * A card count, with the thousands grouped.
 *
 * `11820` sitting in a sentence beside `6.12` and `18.48` reads as another
 * score. `11,820` cannot be mistaken for one. Grouped by hand rather than
 * through `Intl.NumberFormat`, which formats to the RUNTIME's locale — the same
 * sentence would come back with a full stop in it on a de-DE browser, and this
 * copy is English either way.
 */
const count = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

/**
 * WHERE THIS CARD SITS AMONG THE CARDS THAT SHARE ITS JOB (doc 18 §18.12).
 *
 * THE PROBLEM. Impact is a property of the card and is NOT comparable across
 * roles. Sol Ring scores 0.68 against a ceiling of 18.48, and a reader handed
 * that with no comparison concludes the app rates one of the format's defining
 * cards as near-worthless. It is the median ramp card. Wrath of God's 6.12
 * looks enormous next to it and is the BOTTOM of the middle half of board
 * wipes. One bar for all eighteen roles would tell a builder their entire mana
 * base was bad, which is the specific harm this line exists to prevent.
 *
 * DESCRIPTIVE, NOT PRESCRIPTIVE, and the distinction is the reason this is
 * allowed to exist at all. doc 18 §18.9 declined to give the model bands and
 * `impactRows` above rejected letter grades because "every cutoff would be the
 * renderer's opinion". Neither is being overturned. Nothing here says what a
 * card SHOULD score; it names the quartile the card lands in and PRINTS THE
 * TWO QUARTILES IT USED, so the cutoff is a corpus measurement a reader can
 * check and disagree with rather than a bar the interface invented.
 *
 * ONE ROLE — the card's `primaryRole`, the one the badge above already shows.
 * Rejected: a line per role for the 4,891 cards that hold more than one.
 * Measured, 1,251 of those have roles that DISAGREE about the placement
 * (Pathway Arrows is typical spot removal and top-quarter equipment), so the
 * multi-role version hands the reader two verdicts and no way to choose. The
 * pane names one role; the comparison names the same one.
 *
 * Rejected: the whole eighteen-row table, behind a `Hint` or otherwise. The
 * pane is 21rem and a bottom sheet on a phone, and it does not need the table —
 * it is showing ONE card, so it needs one row of it. That is also why this is
 * plain text with no control: the reader whose Sol Ring reads 0.68 must not
 * have to suspect they need help before the help appears.
 */
export const impactRoleLine = (
  impact: ImpactView,
  role: ImpactRoleView | undefined,
): string | null => {
  if (role === undefined) return null
  // The same rule `impactRows` follows. The pane already tells a textless card
  // there is nothing here to measure, and ranking it against its peers directly
  // underneath would contradict the sentence above it.
  if (impact.score === 0) return null
  return `${PLACEMENT[role.placement]} of the ${count(role.n)} ${role.role} cards in the corpus; half of them score ${metricValue(role.q1)} to ${metricValue(role.q3)}.`
}

/**
 * Named for the quartile, not graded.
 *
 * "Bottom quarter" is a description of where the card fell, checkable against
 * the two numbers in the same sentence. "D-" is a verdict, and a verdict is
 * what §18.9 and `impactRows` both refused.
 */
const PLACEMENT: Readonly<Record<ImpactRoleView['placement'], string>> = {
  'bottom-quarter': 'Bottom quarter',
  'middle-half': 'Middle half',
  'top-quarter': 'Top quarter',
}

/**
 * What the tiers alone would leave a reader to guess wrong.
 *
 * The blindness note is unconditional and deliberate. `impact.ts`'s own
 * docblock records that the model cannot see a card whose point is a resource
 * or a tax — Sol Ring scores 0.68 — and that this was accepted rather than
 * patched. A reader who is not told will conclude the app thinks Sol Ring is a
 * bad card. Naming the blind spot beside the number is what makes a low score
 * legible instead of insulting.
 *
 * Rejected: naming Sol Ring and its 0.68 as an anchor. It reads better and it
 * goes stale the first time a regex moves, with nothing to catch it — a UI
 * string is not covered by the model's tests.
 */
export const impactNotes = (
  impact: ImpactView,
  role?: ImpactRoleView | undefined,
): readonly string[] => {
  const notes: string[] = []
  if (impact.score === 0) {
    // Exactly 0, and only 0, for a card with no rules text at all — see the
    // `score` docblock in `impact.ts`. A land or a vanilla creature lands here,
    // and "0" with no explanation reads as a failure to load.
    notes.push('No rules text, so there is nothing here for this model to measure.')
  }
  if (impact.scales) {
    // doc 18 §18.5: `scales` is a marker precisely because the number is not the
    // whole answer, and "it costs the UI one glyph". This is the glyph.
    notes.push('Scales with X — the real figure is this one times whatever X turns out to be.')
  }
  if (impact.fragile) {
    // Otherwise "Repeats: once" on a permanent looks like a misclassification.
    notes.push('It sacrifices itself, so it counts as one-shot whatever its type line says.')
  }
  /*
   * The blind spot, QUANTIFIED where the role makes it the headline rather than
   * a caveat.
   *
   * "Effects only" is true of every card in the format, which is exactly what
   * makes it easy to skim past — and for a land or a ramp rock it is not a
   * footnote, it is the whole explanation of the number. The model finds
   * nothing to count on 896 of 1,194 lands and 961 of 1,401 ramp cards, so the
   * range on the line above is largely a measurement of its own blindness, and
   * a reader cannot tell that from the range.
   *
   * REPLACES the generic sentence rather than stacking on it: they are the same
   * claim and the sourced one is strictly better. Two caveats saying one thing
   * in a 21rem column is how a pane teaches people to stop reading it.
   *
   * Only when the model reads fewer than half the role. Spot removal is 0 of
   * 3,273 and a "blind spot" line there would be a false statement wearing the
   * costume of sourcing.
   */
  if (role !== undefined && role.mostlyUnreadable) {
    notes.push(
      `Effects only — and on ${count(role.noCountableEffect)} of those ${count(role.n)} it finds nothing to count at all, so that range is largely its blind spot.`,
    )
    return notes
  }
  notes.push('Effects only: a card whose job is mana or a tax reads low here.')
  return notes
}

/**
 * The efficiency arithmetic, spelled out.
 *
 * WHY NO METER FOR THIS ONE. Impact has an exact, reachable ceiling that the
 * model itself defines, so a proportion of it is a true statement. Efficiency
 * is a ratio with no ceiling at all — `(surplus + r × impact) / (MV + 1)` grows
 * with both terms — so any bar would need a maximum invented in this file, and
 * an invented maximum is exactly the unstated range this whole file exists to
 * remove. Drawing one would be the more polished lie.
 *
 * What replaces it is the working. Both numerator terms and the denominator are
 * already on the wire, and showing them is what stops the reader concluding
 * "higher is better, therefore better card" — the misreading that sank the
 * FIRST efficiency formula, which rated Grizzly Bears 2.00 against Wrath of God
 * 0.69 (`efficiency.ts`). The shipped formula measures surpluses and no longer
 * does that, but it still divides by cost, so a cheap small card can still
 * out-rate a bomb and the interface has to say so rather than hope.
 *
 * `statSurplus === 0` is deliberately phrased as "no surplus body" rather than
 * "no body": it is 0 both for a noncreature, which has no body term at all, and
 * for a creature at or under the going rate, and the payload cannot tell those
 * apart. A phrase that is true of both beats a guess that is wrong for one.
 */
export const efficiencyWorking = (efficiency: EfficiencyView): string => {
  // The baseline is named only when there is a surplus to measure against it.
  // It is a vanilla-creature figure (`efficiency.ts`), so quoting it beside a
  // noncreature's zero would answer a question nobody asked with a number that
  // does not apply to the card.
  const body =
    efficiency.statSurplus === 0
      ? 'No surplus body'
      : `${metricValue(efficiency.statSurplus)} of body above the ${metricValue(efficiency.baseline)} this mana usually buys`
  return `${body}, plus ${metricValue(efficiency.effectValue)} for its text, over ${metricValue(efficiency.cost)} — its mana plus the card itself.`
}

/** The caveat that has to travel with a ratio. */
export const EFFICIENCY_CAVEAT =
  'A rate, not a ranking: it divides by cost, so a small cheap card can out-rate a bomb.'

/**
 * HOW THE NUMBER WAS ARRIVED AT — the explanation behind the `Hint`.
 *
 * NOT THE FORMULA. A reader looking at Sol Ring's 0.68 wants to know why it is
 * low; `0.5 × 1.6 × 0.85 = 0.68` does not tell them that, it restates the same
 * number in a second notation and leaves them exactly as puzzled. What answers
 * them is that the model reads effects and only effects, that Sol Ring names
 * nothing to affect, and that this is a stated limit rather than a verdict on
 * the card. So these lines explain the METHOD and its blind spot, and the
 * arithmetic appears only as the shape — three readings, multiplied.
 *
 * The register is the pane's own — "Reach: everything at once", "Effects only".
 * Short sentences, the game's words, and the same three labels the tier rows
 * above already use, so the explanation and the thing it explains share a
 * vocabulary instead of introducing a second one.
 *
 * NO CONSTANT IS QUOTED. The tier values live in `impact.ts` and `r` lives in
 * `baseline.data.json`, which is regenerated from the corpus; copy repeating
 * either goes stale the first time one moves with nothing to catch it, because
 * a UI string is not covered by the model's tests. Every number a reader needs
 * is already on the screen — the score, the ceiling, and `efficiencyWorking`'s
 * three terms. This says what those numbers MEAN.
 *
 * Returned as lines rather than a paragraph so the popover can set them as
 * separate rows, which is how every other `Hint` in the app is built, and so
 * this file stays testable without a DOM.
 *
 * WHY THIS ONE IS BEHIND A DISCLOSURE when `impactRoleLine` refused to be.
 * They fail differently. A reader who is not told Sol Ring is the median ramp
 * card concludes the app is wrong and never asks — help they must request
 * cannot reach them, which is why that line is printed. A reader who wants to
 * know HOW the number is derived knows they want it and goes looking; and the
 * answer is eight lines, which is a wall of text in a 21rem column and a bottom
 * sheet on a phone. The pane is unchanged for everyone who does not ask.
 */
export const impactAlgorithm = (): readonly string[] => [
  'Three readings of the card’s own text, multiplied together.',
  'Reach — how much the effect names, from nothing it can count up to everything at once. This is the biggest of the three by far, and it is why a wrath outscores a removal spell rather than doubling it.',
  'Repeats — once, or every time you pay, or every trigger, or every upkeep. Capped low on purpose: a permanent that repeats is worth about twice a one-shot, and past that what ends the effect is the game ending.',
  'Falls on — itself, your side, an opponent’s, or a player. A small nudge either way, not a multiplier that decides the number.',
  'Ends up — only for cards that remove something, and only how hard: tapped, flickered, bounced, damaged, destroyed, exiled. Destroy is the neutral point, so a card that removes nothing is not scored down for it.',
  'A mass effect that catches your own board keeps a little less than all of it, because it is pointed at you as well.',
  'Effects only, and that is the honest limit. A card whose job is mana, or a tax, or a card draw, names nothing the model can count, so it lands near the floor however good it is in play. That is a blind spot, not a verdict — which is what the line about its role is for.',
  'Nothing is special-cased, and the deck is never consulted: this is a fact about the card, the same in every deck.',
]

/**
 * The same, for the ratio. Companion to `efficiencyWorking`, which prints this
 * card's three actual terms; this says what they are.
 *
 * The one thing a reader cannot guess is the `+ 1` in the denominator, so it is
 * named outright. The second is that BOTH terms are surpluses — the correction
 * that rejected the first formula for rating Grizzly Bears three times Wrath of
 * God (doc 18 §18.6) — so "above what the mana already buys" carries it.
 */
export const efficiencyAlgorithm = (): readonly string[] => [
  'What the card gives you above what its mana already buys, per mana.',
  'Body — a creature’s power plus toughness, above what a creature of that cost normally has. The going rate is measured from the only cards whose whole contribution is their body: the ones with no rules text at all. It is lower than the old “a 2/2 for two” rule predicts, and the gap widens as cards get expensive.',
  'A body below that rate counts as nothing rather than as a debt. A card is not improved by doing less.',
  'Text — the impact above, converted into body at the rate the format itself trades the two: what the average creature at each cost gives up in stats to have rules text at all. Measured from the corpus, not chosen.',
  'Both halves are surpluses, which is the whole of what this gets right. A vanilla creature gives you exactly the going rate and nothing else, so it correctly scores zero.',
  'Divided by the mana cost plus one, and the plus one is the card itself — a spell costs you a card as well as its mana. It also keeps a nought-cost card from dividing by nothing.',
  'A noncreature has no body term at all. It is not a creature missing one, so it gets neither the surplus nor a penalty.',
]

/** Accessible names for the two triggers. */
export const IMPACT_ALGORITHM_LABEL = 'How impact is worked out'
export const EFFICIENCY_ALGORITHM_LABEL = 'How efficiency is worked out'
