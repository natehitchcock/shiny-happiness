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
 * The top of the impact scale: 18.48.
 *
 * MIRRORS `IMPACT_MAX` in `packages/domain/src/impact.ts`, where it is derived
 * from the three tier tables rather than written down. The duplication is the
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
export const IMPACT_MAX = 18.48

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

const REPEATS: Readonly<Record<ImpactView['persistence'], string>> = {
  'one-shot': 'once, then it is done',
  activated: 'each time you pay for it',
  triggered: 'each time it triggers',
  upkeep: 'every upkeep',
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

/** The three tier rows. Empty for a card with no rules text — see `impactNotes`. */
export const impactRows = (impact: ImpactView): readonly MetricRow[] => {
  if (impact.score === 0) return []
  return [
    { label: 'Reach', value: REACH[impact.breadth] },
    { label: 'Repeats', value: REPEATS[impact.persistence] },
    {
      label: 'Falls on',
      value: FALLS_ON[impact.stakes] + qualifier(impact.stakes, impact.symmetry),
    },
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
