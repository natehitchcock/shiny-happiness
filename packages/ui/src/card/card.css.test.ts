import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = dirname(fileURLToPath(import.meta.url))
const css = readFileSync(join(here, 'card.css'), 'utf8')

/** Read one rule body out of the stylesheet, by exact selector. */
const rule = (selector: string): string => {
  const at = css.indexOf(`\n${selector} {`)
  if (at < 0) throw new Error(`no rule for ${selector}`)
  return css.slice(at, css.indexOf('}', at))
}

describe('card.css', () => {
  it('does not position the combo badge absolutely by default', () => {
    // The regression: `.rt-combo` was absolute unconditionally. At L1 it has an
    // art frame to pin to; at L2 it sits in a flow row with the price and the
    // bracket flags, and the badge flew to the corner of the DOCUMENT — both
    // missing from the row and adding a page-wide horizontal scroll.
    expect(rule('.rt-combo')).not.toMatch(/position:\s*absolute/)
    expect(rule('.rt-combo')).toMatch(/position:\s*static/)
  })

  it('pins the badge only inside the art frame, which is positioned', () => {
    expect(rule('.rt-tile-art .rt-combo')).toMatch(/position:\s*absolute/)
    expect(rule('.rt-tile-art')).toMatch(/position:\s*relative/)
  })

  it('pins the role dot inside that same frame', () => {
    expect(rule('.rt-tile-art .rt-role')).toMatch(/position:\s*absolute/)
  })

  it('gives every focusable primitive a visible focus ring', () => {
    // Keyboard reachability (R4) is worth nothing if you cannot see where you
    // are. Both interactive surfaces, checked by name so adding a third forces
    // a decision rather than being forgotten.
    expect(rule('.rt-tile:focus-visible')).toMatch(/outline:\s*2px solid/)
    expect(rule('.rt-face-image:focus-visible')).toMatch(/outline:\s*2px solid/)
  })

  it('scrolls the detail body, not the panel, so the actions stay put', () => {
    // doc 06 §6.5. The DOM half of this is asserted in Detail.test.tsx; this is
    // the half that makes it true on screen.
    expect(rule('.rt-detail-body')).toMatch(/overflow-y:\s*auto/)
  })

  it('truncates a long card name rather than reflowing the tile', () => {
    const strip = rule('.rt-tile-name')
    expect(strip).toMatch(/text-overflow:\s*ellipsis/)
    expect(strip).toMatch(/white-space:\s*nowrap/)
    // Without a min-width a flex child refuses to shrink below its content,
    // which is what makes ellipsis silently do nothing.
    expect(strip).toMatch(/min-width:\s*0/)
  })

  it('reads its colours from the tokens rather than restating hexes', () => {
    // The contrast rules in tokens.ts only protect colours that came from
    // tokens.ts. A literal hex here would be a colour no test had looked at.
    const literals = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
    expect(literals).toEqual([])
  })
})

describe('card.css covers what the components ask for', () => {
  it('has a rule for every rt- class the primitives render', () => {
    // The failure this catches is silent: a className with no rule looks fine in
    // a test that queries by it, and wrong on screen. It found two — the detail
    // badge row and the detail role line ran their children together because
    // neither had a rule at all.
    const used = new Set<string>()
    for (const file of readdirSync(here).filter(
      (f) => f.endsWith('.tsx') && !f.includes('.test.'),
    )) {
      const source = readFileSync(join(here, file), 'utf8')
      for (const match of source.matchAll(/className="([^"]+)"/g)) {
        for (const name of match[1]!.split(/\s+/)) if (name.startsWith('rt-')) used.add(name)
      }
    }
    expect(used.size).toBeGreaterThan(20)

    const declared = new Set([...css.matchAll(/\.(rt-[a-z0-9-]+)/g)].map((m) => m[1]!))
    const missing = [...used].filter((name) => !declared.has(name)).sort()
    expect(missing).toEqual([])
  })
})
