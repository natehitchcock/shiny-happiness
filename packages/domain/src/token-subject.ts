/**
 * WHOSE EVENT IS IT — the one place the question gets answered (ADR-0054,
 * ADR-0059).
 *
 * This file started as the token family's subject test and is now the subject
 * test, full stop. ADR-0059 found the same defect in four more families and the
 * lesson of the first four applies to them exactly: a rule table that answers
 * "whose" for itself is a rule table that will answer it differently from the
 * next one. The two halves are:
 *
 *   1. `OPPONENT_SUBJECT` / `CREATES_FOR_YOU` / `CREATES_ANYONE` — the token
 *      verb and the WINDOWED subject list it needs, below.
 *   2. `forYou` / `addressedToYou` — the general subject refusal, at the foot
 *      of this file, composable in front of ANY verb.
 *
 * The two lists of determiners are deliberately NOT shared, which is the one
 * place this file breaks its own rule and the reason is measured. See the
 * paragraph below.
 *
 * THE TWO HALVES HAVE DIFFERENT WINDOWS AND THAT IS THE INTERESTING PART.
 * `creates` can afford a fifty-character reach back to the word "opponent"
 * because a trigger CONDITION about an opponent creating something is rare.
 * `draws` cannot: "Whenever an opponent draws a card, YOU may draw two cards"
 * is Consecrated Sphinx, and the same fifty characters took `card-draw` off 118
 * cards, most of them the payoffs that are the reason the deck exists. Measured,
 * card by card. So the general refusal below asks for the subject to be
 * ADJACENT to the verb, and the reach that `creates` needs is not shared with
 * it. Two windows, one file, and the reason each is what it is written down
 * beside it — which is the whole point of them being in the same file.
 *
 * ADR-0022 established that a synergy event has a SUBJECT — "you discard a
 * card" and "each opponent discards a card" are two different events — and it
 * split `discard` and `sacrifice-fodder` accordingly. The token family never
 * got the treatment, so every rule in this codebase that reads a creation
 * clause read the verb and not the subject:
 *
 *   Forbidden Orchard   "target opponent creates a 1/1 Spirit"
 *     → produces `token`, `sacrifice-fodder`, `subtype:spirit`, role `token-maker`
 *
 * Four rule tables in three files made that mistake independently
 * (`synergy.ts`'s `token` and `sacrifice-fodder`, `semantic-tokens.ts`'s
 * subtype and keyword clauses, `role-derivation.ts`'s `token-maker`), which is
 * why the subject test lives HERE, once, rather than being written out four
 * times. `role-derivation.ts` already carries the warning in another voice:
 * "two lists of the same nouns that disagree is how the next one goes wrong."
 *
 * THE RULE ASKS WHO CREATES, NOT WHETHER SOMETHING IS CREATED. Scryfall
 * templating makes that readable exactly as ADR-0022 found for discard: the
 * bare imperative "Create a 1/1 Soldier token" is addressed to you, and
 * "<somebody> creates a 1/1 Soldier token" names its subject and inflects the
 * verb. So the imperative always counts, and the third person counts unless the
 * subject is somebody else.
 *
 * A DENY LIST, and it is narrow on purpose. Measured over the 31,782
 * commander-legal cards, 3,445 produce `token` today; requiring the subject to
 * be one of a closed list of yours-phrases ("you", "each player", …) removes
 * 117 of them, and most of those removals are wrong. Denying only the subjects
 * that NAME AN OPPONENT removes 31, and all 31 were read by hand and all 31 are
 * cards that hand the bodies across the table — Forbidden Orchard, the six
 * Hunted creatures, Clackbridge Troll, Phelddagrif, Akroan Horse, Captive
 * Audience.
 *
 * "ITS CONTROLLER CREATES" WAS TRIED AND REFUSED, and the refusal is the
 * interesting half. It is the removal shell — "Destroy target permanent. Its
 * controller creates a 3/3 Beast" — and it looks like the same defect: Beast
 * Within, Pongify, Rapid Hybridization, Swan Song and Generous Gift all claim
 * to make you a token they in fact give to the player you just answered.
 * Adding it costs 54 further cards and AT LEAST 14 of those 54 hand the token
 * to you: a symmetric wipe's controller is also you (March of Souls, Rampage of
 * the Clans, The Phasing of Zhalfir), Descent of the Dragons and Terastodon are
 * pointed at your own board on purpose, and Bramble Sovereign, Genesis Chamber,
 * Dual Nature, Parallel Evolution, Seed the Land, Saw in Half, Fractured
 * Identity and Yes Man are token engines outright. That is ~74% precision,
 * below the bar this codebase sets, and it is the same refusal ADR-0022 already
 * made one verb over: "'its controller sacrifices' was tried and rejected at
 * ~53%". The card cannot say who the controller is, and a producer rule has to
 * promise.
 *
 * The clause is the unit, never the card — the ruling `synergy.ts` and
 * `role-derivation.ts` each already make twice. A card that creates its own
 * tokens and also donates one is still a token maker.
 */

/**
 * Refuses a `creates` whose subject names an opponent.
 *
 * Zero-width, so it composes in front of the verb.
 *
 * The window is 50 characters and inside one sentence, because the subject and
 * the verb are not always adjacent: "At the beginning of each opponent's end
 * step, that player creates a 1/1 Goblin" (Goblin Spymaster) puts 24 characters
 * between them, and "each opponent who voted for a choice you voted for
 * creates" (Erestor of the Council) puts 45. `[^.\n]` keeps the reach inside
 * one sentence and inside one face, which is what stops a card that merely
 * MENTIONS an opponent in a previous sentence from losing its own tokens.
 *
 * THE DETERMINER IS LOAD-BEARING and was found by diffing the corpus, not by
 * inspection. A bare `\bopponents?\b` in this window reads three cards wrong,
 * and all three are the same sentence: "Whenever a player attacks ONE OF YOUR
 * OPPONENTS, that attacking player creates…" (Combat Calligrapher, Ellie Brick
 * Master, Jolene the Plunder Queen). There the opponent is the OBJECT of the
 * attack and the creator is whoever attacked — which is usually you, and is the
 * reason those cards are played. Requiring a determiner that makes the opponent
 * a SUBJECT keeps all 34 real clauses and admits those three back.
 *
 * The determiner list is a closed grammatical class rather than a speculative
 * vocabulary, which is why it holds entries no card exercises today. That is
 * the opposite call from `role-derivation.ts`'s "a deny entry no card exercises
 * is machinery", and deliberately so: ADR-0047's defect was an ARTICLE missing
 * from a list of articles, and articles do not grow the way noun vocabularies
 * do.
 *
 * The two extra clauses name the players the game names without the word
 * "opponent": a defending player is by definition not you on your own attack,
 * and "each other player" is everyone but the one the sentence just named.
 */
/**
 * The subject clauses that name somebody who is not you, as a POSITIVE
 * fragment.
 *
 * Exported because `role-derivation.ts` needs the same question asked about a
 * different verb, and asking it from a second list of the same determiners is
 * exactly the failure this file was created to end. ADR-0054 found four rule
 * tables in three files that had each written the token-subject test out
 * privately; ADR-0060 found a fifth, on `protection`:
 *
 *   Hunted Horror  "target opponent creates two 3/3 green Centaur creature
 *                   tokens WITH PROTECTION FROM BLACK"
 *     → roles [protection, evasion], primary `protection`
 *
 * and it was offered to a mono-black deck under "fills protection gap". The
 * protection belongs to the two Centaurs the opponent just got.
 *
 * `NOT_AN_OPPONENT` below is this same fragment as a refusal, so the two can
 * never drift: a determiner added here is added to both at once.
 */
export const OPPONENT_SUBJECT =
  String.raw`(?:\b(?:target|each|an|another|enchanted|that|the) opponents?\b[^.\n]{0,50}` +
  String.raw`|\bdefending player ` +
  String.raw`|\beach other player )`

const NOT_AN_OPPONENT = `(?<!${OPPONENT_SUBJECT})`

/**
 * The creation verb, restricted to clauses whose tokens are yours.
 *
 * A source fragment rather than a `RegExp`, because its three consumers each
 * need it in the middle of a longer pattern with their own window and their own
 * object. Use it case-insensitively; the imperative is capitalised at the start
 * of a sentence and lower-case after "may".
 */
export const CREATES_FOR_YOU = String.raw`(?:\bcreate\b|${NOT_AN_OPPONENT}\bcreates\b)`

/**
 * The same verb with no subject test at all.
 *
 * `semantic-tokens.ts` needs both: it PRODUCES from the clauses that are yours,
 * and it STRIPS every clause — including a donated one — before reading what
 * the card wants. Stripping only your own clauses would leave "target opponent
 * creates two 3/3 green Centaur creature tokens" in the text the payoff rules
 * read, and Hunted Horror would ask to be put in a Centaur deck. A direction
 * inversion is the worst error this model can make (ADR-0016), so the refusal
 * has to be a refusal to CLAIM, not a refusal to LOOK.
 */
export const CREATES_ANYONE = String.raw`\bcreates?\b`

/**
 * THE PERMANENT THIS CARD JUST ANSWERED (ADR-0059).
 *
 * "Its controller" is the phrase four more families were losing their subject
 * to, and the reason ADR-0054 refused it for `creates` is that it does not mean
 * one thing. Read the antecedent and it means two:
 *
 *   Swords to Plowshares  "Exile TARGET creature. Its controller gains life…"
 *   Essence Sliver        "Whenever a Sliver deals damage, its controller
 *                          gains that much life."
 *
 * The first "it" is a permanent you answered — somebody else's, because that is
 * what removal is pointed at. The second is a creature that TRIGGERED
 * something, which in your own deck is yours. One phrase, opposite owners, and
 * a rule that reads the phrase without the antecedent gets one of them wrong.
 *
 * `target` IS THE ANTECEDENT TEST, and it is the game's own word for "the thing
 * this card is answering". It was chosen over a list of answer verbs (destroy,
 * exile, counter, return, put) after both were measured, and it is better in
 * the way that matters: it refuses the SYMMETRIC shells for free. "Destroy ALL
 * nonbasic lands. For each land destroyed this way, its controller may search…"
 * is From the Ashes, where the controller is also you — and a verb list catches
 * it while `target` does not, because a wipe names no target. Wave of Vitriol,
 * March of Souls and Martyr's Cry are the same sentence.
 *
 * Measured over the commander-legal corpus, this refusal removes 24 `lifegain`,
 * 37 `card-draw` and 14 `landfall` claims, and ALL 75 were read by hand and all
 * 75 are cards that hand the life, the card or the land across the table. The
 * cards it deliberately keeps are the other reading: Essence Sliver, Genju of
 * the Fields, Edric, Spymaster of Trest, Selvala, Kavu Lair, Synapse Sliver,
 * Horn of Greed, Glademuse, Ludevic and Nekusar all say "its controller" or
 * "that player" about somebody who is usually you.
 *
 * The window is 100 characters and stops at the newline rather than the full
 * stop, because the antecedent is normally in the PREVIOUS sentence — "Exile
 * target creature. Its controller…" — which is what makes this one of the few
 * gaps in this codebase that has to cross a sentence. It stays inside one face
 * for the reason every other gap here does. The cost is one card, named:
 * Dire-Strain Rampage puts its second "its controller" clause 200 characters
 * past the target and keeps its `landfall`.
 *
 * `token` IS STILL REFUSED, and re-measured rather than assumed. Restricting
 * ADR-0054's rejected "its controller creates" to a targeted antecedent does
 * NOT rescue its precision: the cards that broke it — March of Souls, Rampage
 * of the Clans, Descent of the Dragons, Terastodon, Saw in Half — are removal
 * shells whose controller is you on purpose, and Descent, Terastodon and Saw in
 * Half all name a target. That refusal stands exactly where ADR-0054 left it.
 */
const ANSWERED = String.raw`\btarget\b[^\n]{0,100}`

/**
 * Refuses a verb whose subject is somebody else. Zero-width, so it composes in
 * front of the verb the rule is really about.
 *
 * `between` is whatever the rule's own pattern puts between the subject and the
 * word it anchors on, and it is a parameter rather than a window because a
 * window is how the `creates` half above got a reach it can afford and this
 * half cannot. `landfall` is the only caller that passes one: its rule is
 * anchored on the noun "land card" and not on a verb, so the search phrase in
 * "its controller may SEARCH THEIR LIBRARY FOR A BASIC land card" has to be
 * spelled out rather than covered by a gap that would also cover a sentence.
 *
 * "THAT PLAYER" IS ONLY REFUSED AFTER AN OPPONENT, and that is the narrowest
 * entry here and the one that took the most measuring. Bare, it costs nine real
 * cards — Horn of Greed, Glademuse, Nekusar, Ludevic, Fevered Visions, Walking
 * Archive, Ghirapur Orrery, Archivist of Gondor and Super Intelligence — every
 * one of them a card where "that player" refers back to "each player" and
 * therefore includes you. That is ADR-0022's ruling about "each player
 * discards" in a pronoun. Requiring an opponent in the same sentence keeps all
 * nine and still refuses Forced Fruition, whose sentence names one.
 *
 * The cost of that narrowness is stated rather than hidden: Teferi's Puzzle Box
 * keeps `card-draw`, because "each player shuffles their hand into their
 * library, then draws that many cards" genuinely draws you cards. It is a
 * prison piece that happens to draw, which is a judgement about the card and
 * not about its subject, and this file only answers the second question.
 */
export const forYou = (between = ''): string =>
  String.raw`(?<!\b(?:target|each|an|any|another|that|the) opponents? (?:may )?${between})` +
  String.raw`(?<!\bdefending player (?:may )?${between})` +
  String.raw`(?<!\beach other player (?:may )?${between})` +
  String.raw`(?<!\bopponents?\b[^.\n]{0,50}\bthat player (?:may )?${between})` +
  String.raw`(?<!${ANSWERED}\bits controller (?:may )?${between})`

/**
 * The same refusal for a verb in the BARE INFINITIVE, where having no named
 * subject at all is what makes the clause yours (ADR-0059).
 *
 * ADR-0022's device, one verb over. "Sacrifice a creature:" is an outlet you
 * feed with your own board and is addressed to you; "any opponent may sacrifice
 * a creature of their choice" is an edict, and the producer side has called
 * that `opponent-sacrifice` since ADR-0022 while the WANT side went on reading
 * it as a payoff for your own tokens. Clackbridge Troll was offered to an
 * aristocrats deck as "benefits from your expendable bodies"; your bodies are
 * the one thing that does not turn it on.
 *
 * Wider than `forYou` by the players a card names WITHOUT the word "opponent",
 * and that widening is safe here for a reason it is not safe on `draws`: an
 * infinitive after "may" always has its subject spelled out immediately before
 * it, so there is no symmetric "each player draws" shape to protect. Measured:
 * nine cards, all nine read by hand, all nine edicts or punishers — Clackbridge
 * Troll, Desecration Demon, Predatory Nightstalker, Pillar Tombs of Aku, Brain
 * Gorgers, Innocent Traveler, Mogis, Tomb Blade, Unnatural Hunger.
 *
 * The punisher clause is the same one ADR-0022 found on `discard`: "loses 3
 * life UNLESS THEY sacrifice a permanent" puts the infinitive in the sentence
 * because its subject is "they", and an adjacency test reads right past it.
 *
 * `OPPONENT_SUBJECT` is deliberately NOT reused by either of these two, and
 * that is the one exception this file makes to its own rule against a second
 * list of the same determiners. That fragment carries a fifty-character window
 * because `creates` needs one and can afford one; sharing it would put the same
 * reach in front of `draws`, which is the 118-card mistake the module comment
 * opens with. Two lists in one file with the measurement beside each is still
 * the thing ADR-0054 was asking for — what it forbade was two lists in two
 * files, where nobody can see them disagree.
 */
export const addressedToYou = (between = ''): string =>
  forYou(between) +
  String.raw`(?<!\b(?:target|each|an|any|another|that|the) players? (?:may )?${between})` +
  String.raw`(?<!\bunless (?:they|that player|its controller|an opponent) ${between})`
