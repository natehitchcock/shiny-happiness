import { CANONICAL_FIELD, type QueryNode } from './ast.js'

/**
 * Canonical text for an AST (doc 13 §13.3).
 *
 * `formatQuery(parseQuery(s))` must be idempotent — the chips↔text round-trip in
 * doc 13 §13.4 depends on it, and a formatter that drifts turns every chip edit
 * into a slowly corrupting query.
 */

const needsQuotes = (value: string): boolean => /[\s()"]/.test(value)

const quote = (value: string): string => `"${value.replace(/"/g, '\\"')}"`

export const formatQuery = (node: QueryNode | null): string => {
  if (node === null) return ''
  switch (node.kind) {
    case 'term': {
      const prefix = node.field === 'name' ? '' : `${CANONICAL_FIELD[node.field]}${node.op}`
      const value = node.quoted || needsQuotes(node.value) ? quote(node.value) : node.value
      return `${prefix}${value}`
    }
    case 'not': {
      const inner = formatQuery(node.child)
      // Parenthesise anything that is not a single term, so `-` binds correctly.
      return node.child.kind === 'term' ? `-${inner}` : `-(${inner})`
    }
    case 'and':
      return node.children
        .map((child) => (child.kind === 'or' ? `(${formatQuery(child)})` : formatQuery(child)))
        .join(' ')
    case 'or':
      return node.children.map((child) => formatQuery(child)).join(' or ')
  }
}

const FIELD_PROSE: Readonly<Record<string, string>> = {
  type: 'type',
  oracle: 'text containing',
  keyword: 'keyword',
  color: 'colour',
  identity: 'colour identity',
  manaValue: 'mana value',
  power: 'power',
  toughness: 'toughness',
  rarity: 'rarity',
  set: 'set',
  is: '',
  price: 'price',
  role: 'role',
  combo: 'combos completed',
  near: 'combos one card away',
  flag: 'flagged',
  group: 'group',
  name: 'name containing',
}

const OP_PROSE: Readonly<Record<string, string>> = {
  ':': '',
  '=': 'exactly ',
  '!=': 'not ',
  '<': 'under ',
  '<=': 'at most ',
  '>': 'over ',
  '>=': 'at least ',
}

/** Plain-English summary, for the filter chip row and screen readers. */
export const describeQuery = (node: QueryNode | null): string => {
  if (node === null) return 'no filter'
  switch (node.kind) {
    case 'term': {
      const field = FIELD_PROSE[node.field] ?? node.field
      const op = OP_PROSE[node.op] ?? ''
      if (node.field === 'is') return node.value
      return `${field} ${op}${node.value}`.replace(/\s+/g, ' ').trim()
    }
    case 'not':
      return `not (${describeQuery(node.child)})`
    case 'and':
      return node.children.map(describeQuery).join(', ')
    case 'or':
      return node.children.map(describeQuery).join(' or ')
  }
}

/**
 * The flat conjunction of terms a chip row can represent, or null when the query
 * nests beyond it (doc 13 §13.4).
 *
 * Returning null is the honest answer: faking a chip for `(a or b)` and losing
 * the structure on the next edit is worse than telling the user the bar has
 * dropped to raw text.
 */
export const toChips = (node: QueryNode | null): readonly QueryNode[] | null => {
  if (node === null) return []
  if (node.kind === 'term') return [node]
  if (node.kind === 'not' && node.child.kind === 'term') return [node]
  if (node.kind === 'and') {
    const chips: QueryNode[] = []
    for (const child of node.children) {
      if (child.kind === 'term' || (child.kind === 'not' && child.child.kind === 'term')) {
        chips.push(child)
      } else {
        return null
      }
    }
    return chips
  }
  return null
}
