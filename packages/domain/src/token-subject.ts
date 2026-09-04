/**
 * Whose tokens are these? (ADR-0054)
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
