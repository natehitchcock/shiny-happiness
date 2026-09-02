import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  parseIdentity,
  piecesOf,
  templatesOf,
  toCombo,
  toComboResult,
  variantSkipReason,
  type SpellbookVariant,
} from './spellbook.js'

/** Recorded fixture, never the live API (AGENTS.md §4). */
const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'fixtures',
  'spellbook-variants-sample.json',
)

const { variants } = JSON.parse(readFileSync(FIXTURE, 'utf8')) as {
  variants: SpellbookVariant[]
}

describe('toComboResult', () => {
  it('maps the mana features that actually appear in the feed', () => {
    // The vocabulary is open-ended: "colored", "red", "green" are all separate
    // features. Substring matching is why a new colour needs no code change.
    expect(toComboResult('Infinite colorless mana')).toBe('infinite-mana')
    expect(toComboResult('Infinite colored mana')).toBe('infinite-mana')
    expect(toComboResult('Infinite red mana')).toBe('infinite-mana')
  })

  it('prefers tokens over creatures when a feature says both', () => {
    // "Infinite creature tokens with haste" is a token engine, not a creature
    // count; the pattern order encodes that.
    expect(toComboResult('Infinite creature tokens with haste')).toBe('infinite-tokens')
    expect(toComboResult('Infinite Treasure tokens')).toBe('infinite-tokens')
  })

  it('maps a win condition stated from the other side', () => {
    // "Each opponent loses the game" is a win, and must not fall through to
    // `value` just because it does not contain the word "win".
    expect(toComboResult('Each opponent loses the game')).toBe('win-the-game')
    expect(toComboResult('Win the game')).toBe('win-the-game')
  })

  it('maps a lock', () => {
    expect(toComboResult('Opponents cannot cast spells')).toBe('lock')
  })

  it('treats infinite combat phases as extra turns, the closest the union has', () => {
    // Brackets restrict extra-turn chaining (doc 03 §3.2), and infinite combats
    // is the same kind of thing. `value` would understate it.
    expect(toComboResult('Infinite combat phases')).toBe('infinite-turns')
  })

  it('falls back to value rather than guessing at an unknown feature', () => {
    expect(toComboResult('Infinite death triggers')).toBe('value')
    expect(toComboResult('Something nobody has written yet')).toBe('value')
  })
})

describe('parseIdentity', () => {
  it('reads a multicolour identity', () => {
    expect(parseIdentity('WUB')).toEqual(['W', 'U', 'B'])
  })

  it('treats Spellbook colourless "C" as the domain\'s empty identity', () => {
    // "C" is not a Color. Left in, it would fail the char(1)[] column check and
    // break every colour-identity comparison.
    expect(parseIdentity('C')).toEqual([])
  })

  it('handles an absent identity', () => {
    expect(parseIdentity(undefined)).toEqual([])
  })
})

/** The fixture's one variant that needs no card class. */
const CARDS_ONLY = variants.find((v) => (v.requires ?? []).length === 0)!
/** `2105-3337--140` — two named cards plus template 140, "Mana Dork or Mana Dork Creator". */
const NEEDS_TEMPLATE = variants.find((v) => (v.requires ?? []).length > 0)!

describe('variantSkipReason', () => {
  it('accepts an OK variant whose every piece is a named card', () => {
    expect(variantSkipReason(CARDS_ONLY)).toBeNull()
  })

  it('skips a variant their own editors have not accepted', () => {
    // Publishing a draft as fact would put combos in front of users that
    // Spellbook itself has not signed off.
    expect(variantSkipReason({ ...CARDS_ONLY, status: 'D' })).toBe('not-ok-status')
  })

  it('skips a variant with no card pieces', () => {
    expect(variantSkipReason({ id: 'x', status: 'OK', uses: [] })).toBe('no-pieces')
  })

  it('skips a variant one of whose pieces is a card CLASS (ADR-0038)', () => {
    // The reported bug. This assertion used to read `toBeNull()` on the same
    // fixture variant, which is why the defect shipped: the fixture always
    // carried the case and the test asserted the wrong answer about it.
    //
    // `2105-3337--140` is Combat Celebrant + Fable of the Mirror-Breaker + "a
    // mana dork". Stored from `uses[]` alone it is a TWO-CARD infinite, which
    // is the shape brackets 1-3 restrict — so a deck holding those two cards
    // was told it had assembled a combo it cannot execute.
    expect(NEEDS_TEMPLATE.id).toBe('2105-3337--140')
    expect(variantSkipReason(NEEDS_TEMPLATE)).toBe('template-piece')
  })

  it('reports the missing class by name rather than as a count', () => {
    // The operator has to be able to tell a persist creature from a mana dork;
    // "4,813 combos dropped" on its own is not something anyone can act on.
    expect(templatesOf(NEEDS_TEMPLATE)).toEqual(['Mana Dork or Mana Dork Creator'])
    expect(templatesOf(CARDS_ONLY)).toEqual([])
  })

  it('still says "no pieces" when there are neither cards nor a usable class', () => {
    // The stronger fact about the variant wins. A template alone is not a combo
    // this app could ever store, with or without the new reason.
    expect(
      variantSkipReason({ id: 'y', status: 'OK', uses: [], requires: [{ template: {} }] }),
    ).toBe('no-pieces')
  })

  /*
   * THE GUARD ON THE `--` PRUNE (ADR-0049).
   *
   * `pruneTemplateVariantCombos` deletes every row whose `combo_id` holds a
   * `--`, with no reference to the feed at all, and it is exact for exactly one
   * reason: this function refuses to let such an id be written. The moment that
   * stops being true the prune stops being a cleanup and becomes silent data
   * loss on every ingest, so the two are pinned together here.
   *
   * If you are here because one of these three failed, the prune in
   * `apps/ingest/src/spellbook-ingest.ts` is now unsafe and must be changed in
   * the same commit. Do not "fix" the test.
   */
  describe('the invariant the `--` prune depends on', () => {
    it('refuses every variant that names a card class', () => {
      expect(variantSkipReason(NEEDS_TEMPLATE)).toBe('template-piece')
      expect(
        variantSkipReason({
          id: '1-2',
          status: 'OK',
          uses: CARDS_ONLY.uses ?? [],
          requires: [{ template: { name: 'Creature with Persist' } }],
        }),
      ).toBe('template-piece')
    })

    it('refuses a variant whose ID carries a template segment, even with an empty requires[]', () => {
      /*
       * The residual the `requires[]` check alone cannot close.
       *
       * Spellbook writes a template piece into the id as an EMPTY card segment
       * — `2105-3337--140` is two cards and template 140 — so the `--` is the
       * source's own statement that a piece is a card class. Refusing on
       * `requires[]` alone left the prune resting on a promise about the FEED:
       * that Spellbook never publishes a `--` id with the `requires[]` array
       * missing or empty. Nothing in this repository can hold the feed to that.
       *
       * Refusing on the id as well makes the two populations identical by
       * construction: what the prune deletes is exactly what this refuses. It
       * is also the safer reading on its own merits — an id that says there is
       * a template and a body that does not is a variant we cannot represent
       * either way, and ADR-0038 already ruled that such a variant is skipped
       * rather than stored short.
       */
      expect(
        variantSkipReason({
          id: '2105-3337--140',
          status: 'OK',
          uses: CARDS_ONLY.uses ?? [],
          requires: [],
        }),
      ).toBe('template-piece')
      expect(
        variantSkipReason({ id: '2105-3337--140', status: 'OK', uses: CARDS_ONLY.uses ?? [] }),
      ).toBe('template-piece')
    })

    it('does not read a single hyphen as a template segment', () => {
      // Every ordinary variant id is hyphen-separated card ids, and `104,616`
      // of them are in the table. Matching `-` rather than `--` here would
      // refuse the whole feed, and the prune that mirrors it would empty the
      // table — the exact failure ADR-0038 refused a bare sweep over.
      expect(variantSkipReason(CARDS_ONLY)).toBeNull()
      expect(
        variantSkipReason({ id: '2034-3388-3607', status: 'OK', uses: CARDS_ONLY.uses ?? [] }),
      ).toBeNull()
    })
  })
})

describe('toCombo', () => {
  it('maps every fixture variant whose pieces are all named cards', () => {
    for (const variant of variants) {
      if (variantSkipReason(variant) !== null) continue
      const combo = toCombo(variant)
      expect(combo).not.toBeNull()
      // The DB CHECK refuses a combo with no pieces; so does the domain.
      expect(combo!.pieces.length).toBeGreaterThan(0)
      expect(combo!.id).toBe(variant.id)
    }
  })

  it('refuses to map a combo one of whose pieces is a card class (ADR-0038)', () => {
    // A shorter combo is not a smaller truth, it is a different and false one:
    // `pieces.length === 2` is what `isTwoCardInfinite` reads for the bracket
    // check, and what `annotateCombos` reads to say "adding this completes it".
    expect(toCombo(NEEDS_TEMPLATE)).toBeNull()
  })

  it('maps pieces on oracle id, with no name matching anywhere', () => {
    const variant = CARDS_ONLY
    const combo = toCombo(variant)!

    for (const piece of combo.pieces) {
      // Every piece is a uuid taken straight from `uses[].card.oracleId`.
      expect(piece).toMatch(/^[0-9a-f-]{36}$/)
    }
    expect(combo.pieces.length).toBe(new Set(piecesOf(variant)).size)
  })

  it('de-duplicates a card used twice in one combo', () => {
    const twice: SpellbookVariant = {
      id: 'dup-1',
      status: 'OK',
      uses: [
        { card: { oracleId: '11111111-1111-1111-1111-111111111111' } },
        { card: { oracleId: '11111111-1111-1111-1111-111111111111' } },
      ],
    }

    // A combo's pieces are a set; two copies is still one required card, and a
    // duplicate would double-count in comboDegree.
    expect(toCombo(twice)!.pieces).toHaveLength(1)
  })

  it('de-duplicates results that map to the same domain outcome', () => {
    const manyMana: SpellbookVariant = {
      id: 'mana-1',
      status: 'OK',
      uses: [{ card: { oracleId: '22222222-2222-2222-2222-222222222222' } }],
      produces: [
        { feature: { name: 'Infinite red mana' } },
        { feature: { name: 'Infinite green mana' } },
      ],
    }

    expect(toCombo(manyMana)!.produces).toEqual(['infinite-mana'])
  })

  it('returns null rather than a pieceless combo', () => {
    expect(toCombo({ id: 'empty', status: 'OK', uses: [] })).toBeNull()
  })
})
