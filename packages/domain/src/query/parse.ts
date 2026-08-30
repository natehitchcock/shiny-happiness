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
    return { message: `unknown role "${value}"`, suggestion: null }
  }
  if (
    (field === 'produces' || field === 'wants' || field === 'tag') &&
    !SYNERGY_TAG_VALUES.has(normaliseTag(value))
  ) {
    // The list is short and closed, so the whole of it is the suggestion. A
    // near-miss on a name the user read off a chip is the likely mistake, and
    // guessing which one would be worse than showing all seventeen.
    return {
      message: `unknown synergy tag "${value}"`,
      suggestion: `known: ${[...SYNERGY_TAG_VALUES].join(', ')}`,
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
