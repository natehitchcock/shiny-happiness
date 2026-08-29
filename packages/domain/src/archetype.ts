/** Deck archetypes (doc 14 §14.1, ADR-0005). */
export type ArchetypeKey =
  | 'aggro'
  | 'midrange'
  | 'control'
  | 'combo'
  | 'ramp'
  | 'aristocrats'
  | 'voltron'
  | 'tokens'
  | 'stax'

export const ARCHETYPES: readonly ArchetypeKey[] = [
  'aggro',
  'midrange',
  'control',
  'combo',
  'ramp',
  'aristocrats',
  'voltron',
  'tokens',
  'stax',
]

/**
 * The least-wrong default when no statistics exist for a commander, because its
 * targets are the base table (doc 14 §14.3). The UI must say the suggestion is a
 * fallback rather than implying data backing.
 */
export const DEFAULT_ARCHETYPE: ArchetypeKey = 'midrange'
