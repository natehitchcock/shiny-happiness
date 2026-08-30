/**
 * @roundtable/domain — pure types and deterministic functions.
 *
 * No IO. No fetch, database, filesystem, Date.now() or Math.random(). This is
 * enforced by lint rules in eslint.config.js; see AGENTS.md R1 and doc 09 §9.2
 * for why the purity matters (web and api both run this code and must agree).
 */
export * from './result.js'
export * from './assert-never.js'
export * from './ids.js'
export * from './card.js'
export * from './role.js'
export * from './combo.js'
export * from './combo-index.js'
export * from './combo-patch.js'
export * from './role-derivation.js'
export * from './archetype-targets.js'
export * from './bracket-rules.js'
export * from './legality.js'
export * from './composition-analysis.js'
export * from './scoring.js'
export * from './recommend.js'
export * from './query/index.js'
export * from './decklist/index.js'
export * from './deck.js'
export * from './deck-command.js'
export * from './bracket.js'
export * from './archetype.js'
export * from './composition.js'
export * from './recommendation.js'
