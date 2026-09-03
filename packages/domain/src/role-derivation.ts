import type { Card } from './card.js'
import type { OracleId } from './ids.js'
import { primaryRole, type Role } from './role.js'
import { CREATES_FOR_YOU } from './token-subject.js'

/**
 * Role derivation (doc 02 §2.4, DOM-04).
 *
 * Precedence, highest first:
 *   1. The user's per-deck override — always wins, handled by the caller.
 *   2. The curated override table — cards the heuristics get wrong.
 *   3. Oracle-text heuristics.
 *
 * Rule 3 is wrong often enough to matter, and that is expected rather than a
 * defect to be engineered away: "does this card ramp" is a judgement about how a
 * card plays, not a property of its text. The curated table is therefore a
 * first-class, growing artifact, and the UI exposes a one-tap correction that
 * both fixes the deck and files a data issue.
 */

/** A heuristic: if `test` matches the card, it holds `role`. */
interface Heuristic {
  readonly role: Role
  readonly test: RegExp
  /** Applied to the type line rather than the oracle text. */
  readonly onTypeLine?: boolean
}

/**
 * Patterns are written against Scryfall oracle text conventions: `~` is not used
 * (Scryfall spells the card's own name out), reminder text is present, and
 * ability words are capitalised.
 */
const HEURISTICS: readonly Heuristic[] = [
  { role: 'land', test: /\bLand\b/, onTypeLine: true },

  // Ramp: produces mana, or fetches lands onto the battlefield.
  { role: 'ramp', test: /^\s*(\{[^}]*\}: )?Add \{/m },
  {
    role: 'ramp',
    test: /\bAdd (\{[WUBRGC0-9X/]+\}|one mana|two mana|.{0,20}mana of any colour|.{0,20}mana of any color)/,
  },
  {
    role: 'ramp',
    test: /search your library for (a|up to \w+) basic land card[^.]*onto the battlefield/i,
  },
  /*
   * THE WORD "BASIC" WAS THE WHOLE GAP (ADR-0058).
   *
   * The rule above demands the literal phrase "basic land card", and the
   * format's best ramp spells say neither word — they name a Forest. Nature's
   * Lore, Three Visits, Farseek, Skyshroud Claim, Wood Elves, Knight of the
   * White Orchid, Ranger's Path and Nissa, Who Shakes the World all derived to
   * the `synergy` catch-all, which means the app told a builder it could not
   * tell what Three Visits does.
   *
   * Measured: 145 non-land cards search out a land, put it onto the
   * battlefield or into hand, and hold no `ramp` role. This rule and the one
   * below reach 54 of them, and EVERY ONE OF THE 54 WAS READ BY HAND. There is
   * no false positive to report, which is why they are admitted as written and
   * why neither carries a guard it does not need.
   *
   * NO `i` FLAG on the land types, and the capital carries the whole
   * distinction — the same rule `semantic-tokens.ts` relies on and the same one
   * the tribal sacrifice rule below relies on. Magic capitalises a land type
   * whenever it names one, so "a Mountain card" is a land and "a mountain of
   * cards" is not. `[Ss]earch` covers the two ways the clause starts, since a
   * triggered ability puts it mid-sentence.
   *
   * ONTO THE BATTLEFIELD ONLY, and the refusal is the larger half of the
   * decision. Admitting "into your hand" for a named type is 84 further cards
   * and 51 of them are LANDCYCLING — "Plainscycling {2} ({2}, Discard this
   * card: search your library for a Plains card…)" — which is a discard ability
   * on a Dragon. Timeless Dragon counted as ramp would be ADR-0031's defect
   * pointed the other way: a card counted under a job it does not do. The
   * existing "land card … into your hand" rule below is untouched; it was
   * argued in this file for Traveler's Amulet and this changes nothing about it.
   */
  {
    role: 'ramp',
    test: /[Ss]earch(?:es)? your library for [^.]{0,60}\b(?:Plains|Island|Swamp|Mountain|Forest)\b[^.]{0,100}?onto the battlefield/,
  },
  /*
   * The same gap, one wording over: "a land card" onto the battlefield.
   *
   * The rule at the top of this block wanted "BASIC land card", and 16 cards
   * say only "a land card" — Crop Rotation, Knight of the Reliquary, Ulvenwald
   * Hydra, Hour of Promise, Reshape the Earth, Tempt with Discovery. All
   * hand-checked, all ramp.
   *
   * A SEPARATE RULE rather than making `basic` optional in the one above,
   * because the two claims are different and a reader should be able to see
   * which one a card matched: that rule is about fetching a basic, this is
   * about fetching any land, and folding them would hide the second behind an
   * `?` nobody would notice.
   *
   * `\bland card` rather than `land card`, so "nonland card" is not a land
   * search — the same guard the hand rule below carries, for the same reason.
   */
  {
    role: 'ramp',
    test: /search your library for (a|up to \w+) \bland card[^.]*onto the battlefield/i,
  },
  /*
   * A land tutor is ramp (report 4). The rule above only caught a land put ONTO
   * THE BATTLEFIELD, so Sylvan Scrying and Expedition Map were tutors while
   * Traveler's Amulet and Renegade Map — the same card, one turn slower — were
   * neither, and fell to `synergy`. Both are fixing the same problem a Rampant
   * Growth fixes, one turn later.
   *
   * `\bland card` so "nonland card" is not a land search. This deliberately
   * overlaps the rule above for Cultivate, which puts one land on the
   * battlefield and one in hand; both derive `ramp`, and a Set dedupes them.
   */
  {
    role: 'ramp',
    test: /search your library for [^.]{0,60}\bland card[^.]{0,100}?into your hand/i,
  },
  { role: 'ramp', test: /\bTreasure token/ },

  // Card advantage.
  { role: 'draw', test: /\bdraws? (a|two|three|four|X|that many) cards?\b/i },
  { role: 'draw', test: /\bdraw a card\b/i },

  /*
   * A tutor finds a THREAT, not a land. The product owner's ruling: "land tutors
   * are the worst kind of tutors. Usually people want tutors that enforce their
   * combos or wincons... land tutors are really ramp cards, not tutors."
   *
   * The lookahead rejects any search whose object is a land card, where the old
   * `(?!basic land)` only rejected the word "basic". `\bland card` rather than
   * `land card` so "nonland card" (Night Dealings) is still a tutor.
   */
  {
    role: 'tutor',
    test: /search your library for (a|any) (?![^.]{0,60}\bland card)[^.]*(card|creature|artifact|enchantment|instant|sorcery)[^.]*(your hand|the top of your library)/i,
  },

  /*
   * BOARD WIPES (report 1). "Board wipes are cards that destroy all creatures
   * typically... Also, doing a lot of damage to all creatures could also be
   * considered a board wipe. Ending the turn is not a board wipe."
   *
   * The zone guard is the whole fix for the false positives. `destroy all` and
   * `exile all` were bare, and "all" is a quantifier over whatever noun follows
   * — which in 83 of the 134 `exile all` matches was a card in a NON-battlefield
   * zone: a hand, a library, a graveyard, or the stack. All eight cards in the
   * corpus that end the turn were classified board-wipe, and board-wipe was
   * their only role, because "Exile all spells and abilities" is the REMINDER
   * text of "end the turn". That is the Colossal-Dreadmaw failure again: a rule
   * matched flavour rather than effect.
   *
   * Scoped to the sentence (`[^.\n]`) rather than the card, so Settle the
   * Wreckage — which exiles a board and then talks about a library — still wipes.
   * Rejected: a whitelist of permanent nouns, which dropped "Destroy all
   * Goblins" and "Destroy all Islands", both real wipes.
   *
   * `spells` is deliberately NOT in the guard list even though the stack is not
   * the battlefield. A mutation test showed it excluded exactly one card in the
   * corpus that "abilities" did not already exclude, and that card — Celestial
   * Kirin, "destroy all permanents with that spell's mana value" — is a real
   * wipe. The token bought nothing and cost a card.
   *
   * THE SECOND GUARD is a card cleaning up after ITSELF (ADR-0054). Saproling
   * Burst "destroys all tokens created with this enchantment"; Sengir Autocrat
   * exiles all Serf tokens, which are the three Serfs it just made; Tombstone
   * Stairwell, Drudge Spell, Dual Nature, Faerie Artisans, Arcane Artisan,
   * Abyssal Harvester and Shaun all say the same thing about their own. 9
   * cards, and every one of them is a token MAKER whose own tokens leaving is
   * the price of the engine, not a reset of the board.
   *
   * This was latent rather than new: `token-maker` used to outrank
   * `board-wipe`, so all nine were counted as token makers anyway and nothing
   * could see the wrong role underneath. Moving the answer block above the
   * engine roles is what made it visible, which is why it is fixed here rather
   * than left for later — the precedence change would otherwise have shipped
   * nine cards counted as board wipes.
   *
   * QUALIFIED tokens only. Aether Snap's bare "exile all tokens" is a genuine
   * sweep — it takes everyone's — and it is the one card the guard is written
   * to keep. So the refusal asks for a token clause that names a TYPE (the
   * capital marks one, as the tribal rule below already relies on) or names
   * this card as the tokens' source.
   */
  {
    role: 'board-wipe',
    test: /\b(destroy|exile) all\b(?![^.\n]{0,60}\b(graveyards?|hands?|library|libraries|stack|abilities|revealed)\b)(?! (?:other )?(?:[A-Z][A-Za-z'-]* tokens?\b|tokens? (?:created with|with the same name|you control)\b))/i,
  },
  /*
   * Mass damage — report 1's false negative. There was no rule at all, so
   * Blasphemous Act and Fiery Cannonade both derived to `synergy`.
   *
   * THE THRESHOLD IS 2, AND IT IS MEASURED, NOT CHOSEN. Over the corpus's 19,232
   * creature printings with a printed toughness: 1 damage kills 21.1% of them,
   * 2 kills 45.9%, 3 kills 68.5%. The 1→2 step is the largest single jump in
   * that table (+24.8 points), which is the natural place to cut, and it is
   * where the product owner's own example of a mass-damage wipe sits — Fiery
   * Cannonade deals exactly 2. Below it, a 1-damage ping clears a fifth of the
   * format's creatures and is a token-sweeper, not a reset. X is included
   * because it has no cap.
   *
   * `(?!target)` in the adjective run keeps "each of up to two target creatures"
   * out; the run is bounded at three words so it cannot wander into the next
   * clause. The trailing lookahead keeps combat tricks out — Trailblazer's Torch
   * deals 2 damage to "each creature blocking it", which is a blocker punisher
   * and not a sweeper. Both were found by diffing the corpus, not by inspection.
   */
  {
    role: 'board-wipe',
    test: /deals? (X|[2-9]|\d{2,}) damage to each (?:(?!target)[a-z-]+ ){0,3}creature\b(?! (blocking|blocked|that blocked))/i,
  },
  /*
   * The same line, for the same reason: a mass -X/-X is a number against
   * toughness exactly as damage is, so it cannot have a different threshold. The
   * old `-\d+` also matched `-0` — five cards that reduce power only and kill
   * nothing at all.
   */
  { role: 'board-wipe', test: /all creatures get -\d+\/-([2-9]|\d{2,})/i },
  /*
   * "Making each opponent sac one creature is not a board wipe." The old rule
   * was `sacrifices (all|\w+) creatures?` and `\w+` matched "a", so 70 of its 86
   * matches were single-target edicts. Only effects with no fixed cap remain:
   * "all", or an X the card scales. A fixed count is a tax the board pays and
   * chooses — the creature that matters survives — rather than a reset.
   *
   * Knowingly excluded: Blasphemous Edict ("thirteen creatures"), which is a
   * wipe in practice. A hard-coded number for one card belongs in
   * CURATED_OVERRIDES, which exists for exactly this, not in the regex.
   */
  { role: 'board-wipe', test: /each (player|opponent) sacrifices (all|X) creatures?/i },

  /*
   * COUNTERING IS NOT REMOVAL (report 2). `counter target` used to live here,
   * and it was 459 cards — 429 of them counted as spot-removal, which told a
   * control deck it was full of removal when it was full of counterspells.
   */
  { role: 'counterspell', test: /counter target\b/i },

  /*
   * BOUNCE (report 3). See ADR-0037 for why this is a leaf role and not an
   * "interaction" umbrella.
   *
   * "you control" is excluded because self-bounce is a blink/value effect, not
   * an answer. The lookahead is safe against "you don't control", which does not
   * contain "you control" as a substring — Cyclonic Rift depends on that.
   */
  {
    role: 'bounce',
    test: /return target (?![^.\n]{0,60}you control\b)[^.\n]{0,60}?to (its|their) owner's hand/i,
  },
  { role: 'bounce', test: /return all [^.\n]{0,60}?to (its|their) owners'? hands?/i },

  { role: 'spot-removal', test: /destroy target\b/i },
  /*
   * The graveyard guard is report 5: `exile target` matched "exile target
   * player's graveyard" and "exile target card from a graveyard", which is how
   * spot-removal came to own 71 of the 107 graveyard-hate cards.
   *
   * The SECOND guard is the reported card: Teferi's Time Twist reads "Exile
   * target permanent you control" and was called spot removal, when it is a
   * blink. So is Cloudshift, so is Ephemerate, so is Ruin Ghost — 33 cards in
   * the corpus, every one of which exiles something of YOURS.
   *
   * This is not a new judgement. The `bounce` rule ten lines up already carries
   * exactly this exclusion, with exactly this reason written beside it —
   * "self-bounce is a blink/value effect, not an answer" — and the same
   * sentence is true one verb over. Removal is something you point at an
   * opponent; exiling your own permanent to make it come back is the opposite
   * kind of card, and a deck told it holds 33 answers it does not have will cut
   * real ones to make room.
   *
   * The SYMMETRIC flickers are deliberately left. "Exile target creature. At
   * the beginning of the next end step, return that card" (Long Road Home,
   * Otherworldly Journey, Turn to Mist) names no controller, and a guard wide
   * enough to reach them — one that looks for the card coming back, across a
   * sentence boundary — also swallows the removal HALF of every modal card that
   * offers both: Settle Beyond Reality's "exile target creature you don't
   * control" and Eldrazi Confluence's. 28 more cards for the loss of a real
   * mode on several, and the clause is the unit rather than the card
   * (`synergy.ts` makes the same ruling twice). Measured and refused, not
   * missed.
   */
  {
    role: 'spot-removal',
    test: /exile target\b(?![^.\n]{0,50}\bgraveyard\b)(?![^.\n]{0,60}\byou control\b)/i,
  },
  { role: 'spot-removal', test: /deals? \d+ damage to (target|any target)/i },
  { role: 'spot-removal', test: /target (player|opponent) sacrifices a creature/i },

  /*
   * GRAVEYARD REMOVAL IS ITS OWN SEMANTIC (report 5). The role already existed
   * and already meant this; what was missing was that anything could ever be
   * counted as it. Two additions here, both measured: "exile all graveyards" and
   * "exiles a card from their graveyard" were caught by no rule, and the second
   * rule below matched ZERO cards in the corpus as written — the effect is
   * worded as a replacement on the card being put into the graveyard, not on the
   * graveyard.
   */
  /*
   * `all cards from` was bare, so "exile all cards from your hand" and "...from
   * your library" were graveyard hate — latent while the role had no primaries
   * and visible the moment it got them. It now has to reach a graveyard.
   */
  {
    role: 'graveyard-hate',
    test: /exiles? (all cards from [^.]{0,40}graveyard|all graveyards|target player's graveyard|target card from a graveyard|a card from (their|target player's) graveyard)/i,
  },
  /*
   * Rest in Peace / Leyline of the Void. "a card ... from anywhere" is the whole
   * rule and not decoration: without both halves this also matched the flashback
   * and disturb rider — "If THAT SPELL would be put into a graveyard, exile it
   * instead" — which is a card exiling ITSELF after being cast from the
   * graveyard, the opposite of hating on one. That misread 60-odd cards
   * (Wrexial, Toshiro Umezawa, every Disturb creature) and was invisible in the
   * unit tests, which had the right phrasing in them.
   *
   * The subject has to be GENERIC — "a card", "a card or token", "a creature
   * card", "an instant or sorcery card". Requiring the literal words "a card"
   * was too narrow and dropped those last three; allowing any subject let the
   * Disturb backs in, since they name themselves ("If Spectral Binding would be
   * put into a graveyard from anywhere, exile it instead"). `if an? ` is what
   * separates the two, and a mutation test is what found it.
   */
  {
    role: 'graveyard-hate',
    test: /if an? [^.]{0,30}(card|token|permanent) would be put into (a|an opponent's|their|your) graveyard from anywhere, exile it instead/i,
  },

  { role: 'protection', test: /\b(hexproof|shroud|indestructible|protection from)\b/i },
  { role: 'protection', test: /gains? (hexproof|indestructible|protection)/i },
  { role: 'protection', test: /counter target spell that targets/i },

  { role: 'recursion', test: /return .{0,40}from your graveyard to (your hand|the battlefield)/i },

  /*
   * `an` was missing from the article list, and "artifact" is the one noun here
   * that takes it (ADR-0047). 81 cards, every one a real outlet: Arcbound
   * Ravager, Atog, Bosh, Krark-Clan Ironworks, Defiant Salvager. Found by a
   * test assertion that turned out to be wrong about the code rather than the
   * other way round — the same closed-list defect as the tribal rule below,
   * one article wide instead of one noun wide.
   */
  { role: 'sac-outlet', test: /sacrifice (a|an|another) (creature|permanent|artifact)[^.]*:/i },
  { role: 'sac-outlet', test: /\bSacrifice a creature:/i },
  /*
   * The outlet that names a creature TYPE (ADR-0047).
   *
   * Both rules above demand the literal word "creature", so every tribal outlet
   * in the format fell through to the `synergy` catch-all: Ambush Commander
   * ("Sacrifice an Elf:"), Skirk Prospector, Cabal Archon, Marrow-Gnawer,
   * Siege-Gang Commander. This is ADR-0038's `creature-death` gap one file over,
   * found by the same report, and it matters more here — a role feeds the
   * composition meters and Quickbuild's gap selection, so a deck full of
   * sacrifice outlets was being told it had none.
   *
   * 95 cards match and 92 change role; the three that do not are lands, which
   * the short-circuit below keeps as `land` so the land count stays honest.
   * Every one of the 95 was read by hand and every one is a real outlet.
   *
   * The COLON is what separates this from ADR-0038's tag, and the difference is
   * deliberate. `creature-death` asks only whether a creature dies, so it reads
   * Goblin Grenade's "as an additional cost to cast this spell, sacrifice a
   * Goblin". A sac OUTLET is a repeatable engine you can feed on demand, and the
   * colon is what says the sacrifice is a cost of an activated ability.
   *
   * The deny list and the missing `i` flag are ADR-0038's, for its reasons: an
   * allow list of creature subtypes admits Food (Gingerbrute is an Artifact
   * Creature — Food) and refuses Servo and Pentavite (creature types no card
   * carries, only tokens), and read case-insensitively this rule would match
   * "Sacrifice an artifact:" — which the first heuristic above already owns.
   */
  {
    role: 'sac-outlet',
    test: /\b[Ss]acrifices? (?:a|an|another|two|three|X|\d+) (?!(?:Clue|Food|Blood|Treasure|Powerstone|Junk|Map|Gold|Incubator|Equipment|Plains|Island|Swamp|Mountain|Forest|Desert|Aura|Room)s?\b)[A-Z][A-Za-z'-]*[^.\n]{0,40}:/,
  },

  /*
   * WHOSE tokens (ADR-0054). The role feeds the composition meters, so
   * `token-maker` is a claim about how many token makers THIS DECK holds —
   * and "target opponent creates two 3/3 Centaurs" makes none of them. Same
   * subject test as `synergy.ts` and `semantic-tokens.ts`, shared from
   * `token-subject.ts` so the three cannot drift.
   */
  {
    role: 'token-maker',
    test: new RegExp(
      `${CREATES_FOR_YOU} (a|an|two|three|X|that many|\\w+) .{0,60}creature tokens?`,
      'i',
    ),
  },
  { role: 'token-maker', test: new RegExp(`${CREATES_FOR_YOU} .{0,40}token that's a copy`, 'i') },

  { role: 'anthem', test: /creatures you control get \+\d+\/\+\d+/i },
  { role: 'anthem', test: /other .{0,30}creatures you control get \+\d+\/\+\d+/i },

  { role: 'equipment', test: /\bEquipment\b/, onTypeLine: true },
  { role: 'aura', test: /\bAura\b/, onTypeLine: true },

  { role: 'evasion', test: /\b(flying|menace|trample|shadow|fear|intimidate|horsemanship)\b/i },
  { role: 'evasion', test: /can't be blocked\b/i },
  { role: 'evasion', test: /gains? (flying|menace|trample)/i },

  { role: 'stax', test: /\b(spells? cost|abilities? cost) \{\d+\} more to (cast|activate)/i },
  { role: 'stax', test: /don't untap during (their|your) untap step/i },
  { role: 'stax', test: /players can't\b/i },
  { role: 'stax', test: /each player can('t| not) cast/i },

  { role: 'wincon', test: /wins? the game\b/i },
  { role: 'wincon', test: /loses? the game\b/i },
]

export type RoleOverrides = ReadonlyMap<OracleId, readonly Role[]>

/**
 * Cards the heuristics get wrong, keyed by oracle id.
 *
 * Empty until real card data exists (DATA-01, ING-01) — populating it from
 * remembered oracle ids would be inventing data. Task `DOM-04` owns growing it
 * once the ingest lands, and the UI's "this role is wrong" correction feeds it.
 */
export const CURATED_OVERRIDES: RoleOverrides = new Map()

export interface DerivedRoles {
  readonly roles: readonly Role[]
  readonly primary: Role
  readonly source: 'override' | 'curated' | 'heuristic'
}

/** Roles for a card. `userOverride` is the per-deck `DeckEntry.roleOverride`. */
export const deriveRoles = (
  card: Pick<Card, 'oracleId' | 'typeLine' | 'oracleText'>,
  options: {
    readonly userOverride?: readonly Role[] | null
    readonly curated?: RoleOverrides
  } = {},
): DerivedRoles => {
  const userOverride = options.userOverride
  if (userOverride !== null && userOverride !== undefined && userOverride.length > 0) {
    return { roles: userOverride, primary: primaryRole(userOverride), source: 'override' }
  }

  const curated = (options.curated ?? CURATED_OVERRIDES).get(card.oracleId)
  if (curated !== undefined && curated.length > 0) {
    return { roles: curated, primary: primaryRole(curated), source: 'curated' }
  }

  const roles = new Set<Role>()
  for (const heuristic of HEURISTICS) {
    const subject = heuristic.onTypeLine === true ? card.typeLine : card.oracleText
    if (heuristic.test.test(subject)) roles.add(heuristic.role)
  }

  // A land is a land. Without this, a manland or a land that draws a card gets
  // counted under `draw` and the land count — the number people check first —
  // silently comes up short.
  if (/\bLand\b/.test(card.typeLine)) {
    const list: readonly Role[] = ['land']
    return { roles: list, primary: 'land', source: 'heuristic' }
  }

  // Nothing matched. `synergy` is the honest catch-all: it means "this card does
  // something for the deck we could not classify", not "this card does nothing".
  const list = roles.size === 0 ? (['synergy'] as const) : ([...roles] as const)
  return { roles: list, primary: primaryRole(list), source: 'heuristic' }
}
