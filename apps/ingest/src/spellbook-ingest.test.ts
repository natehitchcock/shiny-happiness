import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { insertCombos, upsertCards } from '@roundtable/db'
import { createTestDatabase, databaseUrl, type TestDatabase } from '@roundtable/db/testing'
import { comboId, oracleId, type Card, type Combo } from '@roundtable/domain'
import { ingestSpellbook } from './spellbook-ingest.js'

/**
 * The combo ingest end to end, with the Spellbook feed stubbed.
 *
 * What this pins is the WIRING, and it exists because the absence of a wiring
 * test is what shipped ADR-0038's first attempt. `variantSkipReason` was tested
 * and correct, the run reported 5,266 refusals, and the reported Moritte +
 * Ashnod's Altar combo was still in the table afterwards — because the only
 * write this path had was an UPSERT, so refusing a variant did nothing about the
 * row an earlier run had already written for it. Every unit involved passed the
 * whole time; nothing looked at the line between them.
 *
 * Real Postgres (AGENTS.md §4); SKIP loudly without one. No network:
 * `fetchImpl` answers from a string held here.
 */
const hasDatabase = databaseUrl() !== null
const describeDb = hasDatabase ? describe : describe.skip

if (!hasDatabase) {
  console.warn('[ingest] DATABASE_URL not set — skipping combo ingest tests (AGENTS.md §4)')
}

const MORITTE = '78699161-fc14-4a44-8a15-0f7c08be0343'
const ALTAR = '4d18bcba-a346-445e-a182-6cc30b7e066d'
const KELPIE = '11111111-2222-4333-8444-555555555555'

const card = (id: string, name: string): Card => ({
  oracleId: oracleId(id),
  name,
  manaCost: '{2}',
  manaValue: 2,
  colorIdentity: [],
  colors: [],
  typeLine: 'Artifact',
  types: ['artifact'],
  oracleText: '',
  power: null,
  toughness: null,
  loyalty: null,
  keywords: [],
  legalities: { commander: 'legal' },
  edhrecRank: 100,
  defaultPrinting: null,
  roles: ['synergy'],
  primaryRole: 'synergy',
  universesBeyond: false,
  gameChanger: false,
  synergyProduces: [],
  synergyWants: [],
})

const use = (id: string, name: string) => ({ card: { oracleId: id, name } })

/**
 * The reported variant, verbatim in shape from the live feed.
 *
 * `2034-3388--5` names two cards in `uses` and its third piece in `requires`:
 * template 5, "Persist Creature", `keyword:persist t:creature`. Moritte has no
 * persist of her own — she has to copy a creature that does — which is why the
 * user was right that these two cards are not a combo.
 */
const MORITTE_ALTAR_TEMPLATE = {
  id: '2034-3388--5',
  status: 'OK',
  identity: 'C',
  uses: [use(MORITTE, 'Moritte of the Frost'), use(ALTAR, "Ashnod's Altar")],
  requires: [{ template: { name: 'Persist Creature' } }],
  produces: [{ feature: { name: 'Infinite colorless mana' } }],
  description: "Activate Ashnod's Altar by sacrificing Moritte of the Frost, adding {C}{C}.",
}

/** The three-card sibling, which is a real combo and must survive. */
const MORITTE_ALTAR_KELPIE = {
  id: '2034-3388-3607',
  status: 'OK',
  identity: 'C',
  uses: [
    use(MORITTE, 'Moritte of the Frost'),
    use(ALTAR, "Ashnod's Altar"),
    use(KELPIE, 'River Kelpie'),
  ],
  requires: [],
  produces: [{ feature: { name: 'Infinite draw' } }],
  description: "Activate Ashnod's Altar by sacrificing Moritte, adding {C}{C}.",
}

/** A variant Spellbook's own editors have since withdrawn. */
const WITHDRAWN = {
  id: 'withdrawn-1',
  status: 'D',
  uses: [use(MORITTE, 'Moritte of the Frost'), use(ALTAR, "Ashnod's Altar")],
  requires: [],
  produces: [{ feature: { name: 'Infinite colorless mana' } }],
}

const stubFetch = (variants: readonly unknown[]): typeof fetch =>
  (() =>
    Promise.resolve(
      new Response(JSON.stringify({ variants }), {
        headers: { 'content-type': 'application/json' },
      }),
    )) as unknown as typeof fetch

const staleRow = (id: string, pieces: string[]): Combo => ({
  id: comboId(id),
  pieces: pieces.map((p) => oracleId(p)),
  prerequisites: '',
  steps: [],
  produces: ['infinite-mana'],
  colorIdentity: [],
})

describeDb('the combo ingest, wired end to end', () => {
  let db: TestDatabase

  beforeAll(async () => {
    db = await createTestDatabase('combo_ingest')
    await upsertCards(db.pool, [
      card(MORITTE, 'Moritte of the Frost'),
      card(ALTAR, "Ashnod's Altar"),
      card(KELPIE, 'River Kelpie'),
    ])
  }, 60_000)

  afterAll(async () => {
    await db?.drop()
  }, 60_000)

  const countRow = async (id: string): Promise<number> => {
    const { rows } = await db.pool.query<{ n: string }>(
      'SELECT count(*) AS n FROM combos WHERE combo_id = $1',
      [id],
    )
    return Number(rows[0]?.n ?? 0)
  }

  it('removes the row an earlier run wrote for a variant it now refuses', async () => {
    // The reported bug, reproduced: the row is here because an ingest from
    // before the refusal existed put it here, two pieces long.
    await insertCombos(db.pool, [staleRow('2034-3388--5', [MORITTE, ALTAR])])
    expect(await countRow('2034-3388--5')).toBe(1)

    const report = await ingestSpellbook(db.pool, {
      fetchImpl: stubFetch([MORITTE_ALTAR_TEMPLATE, MORITTE_ALTAR_KELPIE]),
    })

    expect(report.templateRequired.map((t) => t.comboId)).toEqual(['2034-3388--5'])
    expect(report.removed).toBe(1)
    expect(await countRow('2034-3388--5')).toBe(0)
  })

  it('leaves the three-card sibling alone, which is a real combo', async () => {
    // The guard on over-skipping. Moritte and Ashnod's Altar DO combo with
    // River Kelpie; only the two-card claim was false, and a fix that took both
    // would have traded one wrong answer for another.
    expect(await countRow('2034-3388-3607')).toBe(1)
  })

  it('removes a row for a variant Spellbook has withdrawn', async () => {
    await insertCombos(db.pool, [staleRow('withdrawn-1', [MORITTE, ALTAR])])

    const report = await ingestSpellbook(db.pool, {
      fetchImpl: stubFetch([WITHDRAWN, MORITTE_ALTAR_KELPIE]),
    })

    expect(report.skippedNotOk).toBe(1)
    expect(report.removed).toBe(1)
    expect(await countRow('withdrawn-1')).toBe(0)
  })

  it('does NOT remove a row for a combo naming a card the corpus lacks', async () => {
    /*
     * The line this fix deliberately does not cross.
     *
     * `unmapped` is a statement about OUR corpus being older than Spellbook's,
     * not about the variant. Pruning on it would delete real combos every time
     * the card ingest lags the combo ingest and restore them on the next run,
     * churning the table on our own staleness — so the row stays and the
     * operator is told instead.
     */
    const UNKNOWN = '99999999-9999-4999-8999-999999999999'
    await insertCombos(db.pool, [staleRow('names-a-missing-card', [MORITTE, UNKNOWN])])

    const report = await ingestSpellbook(db.pool, {
      fetchImpl: stubFetch([
        {
          id: 'names-a-missing-card',
          status: 'OK',
          uses: [use(MORITTE, 'Moritte of the Frost'), use(UNKNOWN, 'Some Card We Lack')],
          requires: [],
          produces: [],
        },
      ]),
    })

    expect(report.unmapped.map((u) => u.comboId)).toEqual(['names-a-missing-card'])
    expect(report.removed).toBe(0)
    expect(await countRow('names-a-missing-card')).toBe(1)
  })

  /*
   * The rows the id-by-id prune above cannot reach (ADR-0049).
   *
   * ADR-0038 left 41 of them and recorded them as unreachable, correctly: they
   * are rows for variants Spellbook has withdrawn from the FEED, so no run ever
   * reads them and no run can positively reject them. On the playtest deck that
   * reported this, 5 of 12 "assembled" combos were these.
   */
  describe('rows for variants that are no longer in the feed at all', () => {
    it('removes a stale template row the run never saw', async () => {
      /*
       * The distinguishing case, and the one `report.removed` cannot cover:
       * `1957-4050-6273--129` is NOT in the stubbed feed, so nothing reads it,
       * nothing rejects it, and the id-by-id prune has no id to pass.
       */
      await insertCombos(db.pool, [staleRow('1957-4050-6273--129', [MORITTE, ALTAR])])
      expect(await countRow('1957-4050-6273--129')).toBe(1)

      const report = await ingestSpellbook(db.pool, {
        fetchImpl: stubFetch([MORITTE_ALTAR_KELPIE]),
      })

      expect(report.removed).toBe(0)
      expect(report.removedTemplateVariants).toBe(1)
      expect(await countRow('1957-4050-6273--129')).toBe(0)
      // And the real three-card combo the run DID write is untouched.
      expect(await countRow('2034-3388-3607')).toBe(1)
    })

    it('cannot empty the table on a run that read almost nothing', async () => {
      /*
       * The property that makes this prune safe where the sweep ADR-0038
       * refused is not.
       *
       * "Delete everything this run did not write" empties the table on a
       * truncated download or a `--limit` run. This one reads no feed and
       * counts no variants, so a run that saw ONE variant removes exactly the
       * rows a complete run would — and the rows it leaves are every row that
       * is not a template variant.
       */
      const total = async (): Promise<number> => {
        const { rows } = await db.pool.query<{ n: string }>('SELECT count(*) AS n FROM combos')
        return Number(rows[0]?.n ?? 0)
      }
      const before = await total()
      expect(before).toBeGreaterThan(0)

      const report = await ingestSpellbook(db.pool, {
        fetchImpl: stubFetch([MORITTE_ALTAR_KELPIE]),
        limit: 1,
      })

      expect(report.removedTemplateVariants).toBe(0)
      expect(await total()).toBe(before)
    })

    it('never writes a row the prune would then delete', async () => {
      /*
       * The two halves held against each other.
       *
       * The prune deletes on the id alone with no reference to the feed, so it
       * is only ever a cleanup while the ingest refuses to write such an id. A
       * feed variant carrying a `--` id and an EMPTY `requires[]` is the case
       * that would otherwise be written and then deleted every single run,
       * losing a real combo quietly — `variantSkipReason` refuses it on the id
       * for exactly this reason, and this is where the two meet.
       */
      const report = await ingestSpellbook(db.pool, {
        fetchImpl: stubFetch([
          {
            id: '2105-3337--140',
            status: 'OK',
            uses: [use(MORITTE, 'Moritte of the Frost'), use(ALTAR, "Ashnod's Altar")],
            requires: [],
            produces: [{ feature: { name: 'Infinite colorless mana' } }],
          },
        ]),
      })

      expect(report.combos).toBe(0)
      expect(report.templateRequired.map((t) => t.comboId)).toEqual(['2105-3337--140'])
      expect(await countRow('2105-3337--140')).toBe(0)
    })
  })
})
