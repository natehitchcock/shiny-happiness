import { err, ok, type Result } from '../result.js'
import {
  CANONICAL_FIELD,
  FIELD_ALIASES,
  IS_PREDICATES,
  NUMERIC_FIELDS,
  ROLE_VALUES,
  SYNERGY_TAG_VALUES,
  normaliseTag,
  type ComparisonOp,
  type QueryField,
  type QueryNode,
  type QueryParseError,
} from './ast.js'

/**
 * Lexer and recursive-descent parser for the candidate query (doc 13 §13.3).
 *
 * Two behaviours that matter more than the grammar:
 *
 *   - An UNKNOWN FIELD IS AN ERROR, never ignored. `typ:creature` reports a
 *     position and suggests `t:`. Silently matching everything gives the user a
 *     wrong answer that looks right, which is the worst failure this app has.
 *   - A TRAILING INCOMPLETE TERM parses the complete prefix and reports only the
 *     tail. Without that, results flicker to empty on every keystroke.
 */

interface Token {
  readonly type: 'word' | 'quoted' | 'lparen' | 'rparen' | 'minus' | 'or'
  readonly value: string
  readonly position: number
  readonly length: number
}

const isSpace = (ch: string) => ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r'

const tokenize = (input: string): { tokens: Token[]; errors: QueryParseError[] } => {
  const tokens: Token[] = []
  const errors: QueryParseError[] = []
  let i = 0

  while (i < input.length) {
    const ch = input[i]!
    if (isSpace(ch)) {
      i += 1
      continue
    }
    if (ch === '(') {
      tokens.push({ type: 'lparen', value: '(', position: i, length: 1 })
      i += 1
      continue
    }
    if (ch === ')') {
      tokens.push({ type: 'rparen', value: ')', position: i, length: 1 })
      i += 1
      continue
    }
    if (ch === '-' && i + 1 < input.length && !isSpace(input[i + 1]!)) {
      tokens.push({ type: 'minus', value: '-', position: i, length: 1 })
      i += 1
      continue
    }

    // A word runs to whitespace or a paren, but a quoted section inside it is
    // taken whole — so `o:"draw a card"` is one token, spaces and all.
    const start = i
    let value = ''
    let sawQuote = false
    while (i < input.length && !isSpace(input[i]!) && input[i] !== ')') {
      if (input[i] === '"') {
        sawQuote = true
        i += 1
        const quoteStart = i
        while (i < input.length && input[i] !== '"') {
          value += input[i]
          i += 1
        }
        if (i >= input.length) {
          errors.push({
            position: quoteStart - 1,
            length: input.length - quoteStart + 1,
            message: 'unclosed quote',
            suggestion: 'add a closing "',
          })
        }
        i += 1
        continue
      }
      if (input[i] === '(' && value === '') break
      value += input[i]
      i += 1
    }

    if (value === '' && !sawQuote) {
      i += 1
      continue
    }
    const length = i - start
    if (!sawQuote && value.toLowerCase() === 'or') {
      tokens.push({ type: 'or', value: 'or', position: start, length })
    } else {
      tokens.push({ type: sawQuote ? 'quoted' : 'word', value, position: start, length })
    }
  }

  return { tokens, errors }
}

const OPS: readonly ComparisonOp[] = ['>=', '<=', '!=', '>', '<', '=', ':']

const suggestField = (unknown: string): string | null => {
  const lower = unknown.toLowerCase()
  let best: string | null = null
  let bestScore = 0
  for (const alias of FIELD_ALIASES.keys()) {
    // Cheap similarity: shared prefix length, plus a bonus for a prefix match.
    let shared = 0
    while (shared < alias.length && shared < lower.length && alias[shared] === lower[shared])
      shared += 1
    const score = shared + (lower.startsWith(alias) || alias.startsWith(lower) ? 1 : 0)
    if (score > bestScore) {
      bestScore = score
      best = alias
    }
  }
  return bestScore >= 2 ? best : null
}

const parseTerm = (token: Token, errors: QueryParseError[]): QueryNode | null => {
  const raw = token.value

  // A quoted token with no field is a name search for that literal phrase.
  if (token.type === 'quoted' && !raw.includes(':')) {
    return { kind: 'term', field: 'name', op: ':', value: raw, quoted: true }
  }

  let opIndex = -1
  let op: ComparisonOp = ':'
  for (const candidate of OPS) {
    const idx = raw.indexOf(candidate)
    if (idx > 0 && (opIndex === -1 || idx < opIndex)) {
      opIndex = idx
      op = candidate
    }
  }

  if (opIndex === -1) {
    // Bare word — a name substring search.
    return { kind: 'term', field: 'name', op: ':', value: raw, quoted: token.type === 'quoted' }
  }

  const fieldText = raw.slice(0, opIndex)
  const value = raw.slice(opIndex + op.length)
  const field = FIELD_ALIASES.get(fieldText.toLowerCase())

  if (field === undefined) {
    const suggestion = suggestField(fieldText)
    errors.push({
      position: token.position,
      length: fieldText.length,
      message: `unknown field "${fieldText}"`,
      suggestion: suggestion === null ? null : `did you mean "${suggestion}:"?`,
    })
    return null
  }

  if (value === '') {
    // Incomplete trailing term — the user is mid-keystroke. Report it, drop it,
    // and let the completed prefix still filter.
    errors.push({
      position: token.position,
      length: token.length,
      message: `"${fieldText}:" has no value yet`,
      suggestion: null,
    })
    return null
  }

  const problem = validateValue(field, op, value)
  if (problem !== null) {
    errors.push({
      position: token.position + opIndex + op.length,
      length: value.length,
      message: problem.message,
      suggestion: problem.suggestion,
    })
    return null
  }

  return { kind: 'term', field, op, value, quoted: token.type === 'quoted' }
}

/**
 * The candidates from `vocabulary` a typo could plausibly have meant, best first.
 *
 * Shared by the `role:` and the synergy-tag branches of `validateValue`. It was
 * written for tags and is now used by both, because the two boxes take the same
 * typos and two similarity functions that disagree is how the next one goes
 * wrong.
 *
 * Two signals. A vocabulary word that CONTAINS what was typed scores above every
 * prefix match, which is what makes `role:removal` find `spot-removal`; failing
 * that, the count of shared leading characters, which is what a transposition
 * leaves intact — "artifcat-etb" and "artifact-etb" agree for five, and an
 * exact `includes` finds nothing there at all.
 *
 * Three is the floor because two is noise: almost every role shares two letters
 * with something.
 */
const nearest = (typed: string, vocabulary: readonly string[]): readonly string[] => {
  const shared = (word: string): number => {
    let i = 0
    while (i < word.length && i < typed.length && word[i] === typed[i]) i += 1
    return i
  }
  return vocabulary
    .map((word) => ({ word, score: word.includes(typed) ? typed.length + 1 : shared(word) }))
    .filter((entry) => entry.score >= 3)
    .sort((a, b) => b.score - a.score || a.word.localeCompare(b.word))
    .map((entry) => entry.word)
}

const validateValue = (
  field: QueryField,
  op: ComparisonOp,
  value: string,
): { message: string; suggestion: string | null } | null => {
  if (NUMERIC_FIELDS.has(field)) {
    if (!/^-?\d+(\.\d+)?$/.test(value)) {
      return {
        message: `${CANONICAL_FIELD[field]} needs a number, got "${value}"`,
        suggestion: null,
      }
    }
    return null
  }
  if (field === 'is' && !IS_PREDICATES.has(value.toLowerCase())) {
    return {
      message: `unknown predicate "is:${value}"`,
      suggestion: `known: ${[...IS_PREDICATES].slice(0, 6).join(', ')}…`,
    }
  }
  if (field === 'role' && !ROLE_VALUES.has(value.toLowerCase())) {
    /*
     * `role:` was the one value field in the whole grammar with no suggestion.
     * Every other branch of this function offers something — `is:` lists its
     * predicates, a synergy tag gets a near-miss list, a colour is told to use
     * WUBRG — and a mistyped role got a bare rejection.
     *
     * It is also the field with the LEAST excuse: twenty closed words, against
     * the 608 tags the branch below has to truncate. The whole vocabulary would
     * fit, and is deliberately not printed anyway — a wall of twenty roles
     * under a search box is the seven-kilobyte problem in miniature, so this
     * follows the same near-miss-then-truncate shape as its neighbour rather
     * than inventing a third style.
     *
     * Scoring is `nearest`, shared with the tag branch below: the same typo
     * classes turn up in both boxes and two similarity functions that disagree
     * is how the next one goes wrong.
     */
    const near = nearest(value.toLowerCase(), [...ROLE_VALUES])
    const shown = (near.length > 0 ? near : [...ROLE_VALUES]).slice(0, 5)
    return {
      message: `unknown role "${value}"`,
      suggestion: `${near.length > 0 ? 'did you mean' : 'known'}: ${shown.join(', ')}…`,
    }
  }
  if (
    (field === 'produces' || field === 'wants' || field === 'has' || field === 'tag') &&
    !SYNERGY_TAG_VALUES.has(normaliseTag(value))
  ) {
    /*
     * The suggestion used to be the WHOLE vocabulary, on the stated ground that
     * "the list is short and closed, so the whole of it is the suggestion …
     * showing all seventeen". ADR-0046 took it to 608, and 608 tags joined with
     * commas is a seven-kilobyte error string under a search box.
     *
     * So it is a near-miss list now: the tags that share the typed value's
     * prefix, then the tags that contain it, then — only if neither found
     * anything — the first few curated events, which are the ones a person is
     * most likely to have meant. `is:` already truncates this way one branch
     * up, and this follows it rather than inventing a second style.
     */
    const typed = normaliseTag(value)
    const all = [...SYNERGY_TAG_VALUES]
    const near = nearest(typed, all)
    const shown = (near.length > 0 ? near : all).slice(0, 6)
    const found = near.length > 0 ? near.length : all.length
    return {
      message: `unknown synergy tag "${value}"`,
      suggestion: `${near.length > 0 ? 'did you mean' : 'known'}: ${shown.join(', ')}${
        found > shown.length ? '…' : ''
      }`,
    }
  }
  if ((field === 'color' || field === 'identity') && !/^[wubrgc]+$/i.test(value)) {
    if (!['colorless', 'colourless', 'multicolor', 'multicolour'].includes(value.toLowerCase())) {
      return {
        message: `"${value}" is not a colour`,
        suggestion: 'use letters from WUBRG, or "colorless"',
      }
    }
  }
  if (
    op !== ':' &&
    op !== '=' &&
    op !== '!=' &&
    !NUMERIC_FIELDS.has(field) &&
    field !== 'color' &&
    field !== 'identity' &&
    field !== 'rarity'
  ) {
    return { message: `${CANONICAL_FIELD[field]} does not support "${op}"`, suggestion: 'use ":"' }
  }
  return null
}

/**
 * Parse a query.
 *
 * Returns an AST whenever any complete term parsed, alongside every error found.
 * The caller decides what to do: doc 10 §10.4 says a query with errors is NOT
 * applied at all — half a filter is a wrong answer that looks right — while the
 * UI still uses the errors to underline the bad token as you type.
 */
export const parseQuery = (
  input: string,
): Result<{ ast: QueryNode | null; errors: readonly QueryParseError[] }, QueryParseError[]> => {
  const { tokens, errors } = tokenize(input)
  let pos = 0

  const parseOr = (): QueryNode | null => {
    const children: QueryNode[] = []
    const first = parseAnd()
    if (first !== null) children.push(first)
    while (pos < tokens.length && tokens[pos]!.type === 'or') {
      pos += 1
      const next = parseAnd()
      if (next !== null) children.push(next)
    }
    if (children.length === 0) return null
    if (children.length === 1) return children[0]!
    return { kind: 'or', children }
  }

  const parseAnd = (): QueryNode | null => {
    const children: QueryNode[] = []
    while (pos < tokens.length) {
      const token = tokens[pos]!
      if (token.type === 'or' || token.type === 'rparen') break
      const node = parseUnary()
      if (node !== null) children.push(node)
    }
    if (children.length === 0) return null
    if (children.length === 1) return children[0]!
    return { kind: 'and', children }
  }

  const parseUnary = (): QueryNode | null => {
    const token = tokens[pos]!
    if (token.type === 'minus') {
      pos += 1
      if (pos >= tokens.length) {
        errors.push({
          position: token.position,
          length: 1,
          message: 'nothing to negate',
          suggestion: null,
        })
        return null
      }
      const child = parseUnary()
      return child === null ? null : { kind: 'not', child }
    }
    if (token.type === 'lparen') {
      pos += 1
      const inner = parseOr()
      if (pos < tokens.length && tokens[pos]!.type === 'rparen') {
        pos += 1
      } else {
        errors.push({
          position: token.position,
          length: 1,
          message: 'unclosed (',
          suggestion: 'add a closing )',
        })
      }
      return inner
    }
    if (token.type === 'rparen') {
      pos += 1
      errors.push({
        position: token.position,
        length: 1,
        message: 'unexpected )',
        suggestion: null,
      })
      return null
    }
    pos += 1
    return parseTerm(token, errors)
  }

  const ast = parseOr()

  /*
   * Whatever the grammar could not consume, said out loud.
   *
   * `parseAnd` breaks on an `rparen` and `parseOr` only continues on an `or`,
   * so a `)` with no `(` in front of it fell out of the bottom of the parser
   * and was DROPPED IN SILENCE — the `unexpected )` error inside `parseUnary`
   * is only reachable when a `)` opens a term, which the tokenizer makes
   * impossible. Every stray closer took the same path.
   *
   * Found while looking at `role:spot-removal(artifact)`, a qualifier spelling
   * the grammar does not support: `)` terminates a word token, so that input
   * became a bad `role:` term plus a lost `)`. The user saw one confusing
   * error and, because doc 10 §10.4 refuses to apply a query with errors, a
   * search box that filtered on nothing with no second reason given.
   *
   * A loop rather than one report, because `((` and `)))` are equally silent
   * and the position of each is what underlines the right character.
   */
  while (pos < tokens.length) {
    const token = tokens[pos]!
    pos += 1
    if (token.type !== 'rparen') continue
    errors.push({
      position: token.position,
      length: 1,
      message: 'unexpected )',
      suggestion: 'remove it, or add a ( to open the group',
    })
  }

  return ok({ ast, errors })
}

/** Convenience for callers that need a usable AST or nothing. */
export const parseQueryStrict = (
  input: string,
): Result<QueryNode | null, readonly QueryParseError[]> => {
  const parsed = parseQuery(input)
  if (!parsed.ok) return err(parsed.error)
  if (parsed.value.errors.length > 0) return err(parsed.value.errors)
  return ok(parsed.value.ast)
}
