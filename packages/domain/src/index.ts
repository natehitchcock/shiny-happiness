/**
 * @roundtable/domain — pure types and deterministic functions.
 *
 * No IO. No fetch, database, filesystem, Date.now() or Math.random(). This is
 * enforced by lint rules in eslint.config.js; see AGENTS.md R1 and doc 09 §9.2
 * for why the purity matters (web and api both run this code and must agree).
 *
 * Entity types land here with DOM-01; combo degree with DOM-02.
 */
export * from './result.js'
