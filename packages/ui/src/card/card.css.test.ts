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
    // R4 again, for the flip control (ADR-0027). It is a real <button>, so the
    // UA would draw something — but the UA ring on a dark panel is the thing
    // this project already decided was not enough for the other two.
    expect(rule('.rt-flip:focus-visible')).toMatch(/outline:\s*2px solid/)
  })

  it('leaves the flip control its own height rather than fixing one here', () => {
    // The 44 px touch minimum is `HIT_TARGET_MIN` in presentation.ts and is set
    // inline from it. A `min-height: 44px` here would be a second copy of doc
    // 08 §8.3 that no test could tie back to the rule.
    expect(rule('.rt-flip')).not.toMatch(/min-height:/)
  })

  it('lets the flip label wrap instead of hiding half of it', () => {
    // The label names the face you are going to, which is the whole point of it
    // under R4. Truncating it in a 150 px popover would truncate the name.
    expect(rule('.rt-flip')).not.toMatch(/text-overflow:\s*ellipsis/)
    expect(rule('.rt-flip')).not.toMatch(/white-space:\s*nowrap/)
  })

  it('offers a pointer cursor only on a face that can actually be activated', () => {
    // `CardFace` drops the button role when it is given no `onActivate` — in the
    // preview panel and on the start screen it SHOWS a card rather than
    // offering one. A cursor that still says "click me" is the same false
    // promise the role was removed to stop making.
    expect(rule('.rt-face-image')).not.toMatch(/cursor:/)
    expect(rule(".rt-face-image[role='button']")).toMatch(/cursor:\s*pointer/)
  })

  it('paints the reserved image box, so a card that is loading is not a hole', () => {
    // The component sizes this frame inline; what CSS owes it is a ground
    // colour, or the space held open for the art reads as a rendering fault.
    expect(rule('.rt-face-image')).toMatch(/background:\s*var\(--/)
  })

  it('scrolls the detail body, not the panel, so the actions stay put', () => {
    // doc 06 §6.5. The DOM half of this is asserted in Detail.test.tsx; this is
    // the half that makes it true on screen.
    expect(rule('.rt-detail-body')).toMatch(/overflow-y:\s*auto/)
  })

  it('keeps the impact meter inside its track however the fill is sized', () => {
    // The fill's width is an inline percentage from `impactFraction`. If the
    // track ever stops clipping, a score at the ceiling paints past the edge of
    // a 21rem panel — and the panel is 21rem at every width the app uses.
    expect(rule('.rt-metric-meter')).toMatch(/overflow:\s*hidden/)
    expect(rule('.rt-metric-meter')).toMatch(/inline-size:\s*100%/)
  })

  it('gives the metrics no fixed widths, so 21rem and a phone both fit', () => {
    // The two mounts are a 21rem column and a full-width bottom sheet. A `px`
    // or `ch` width anywhere in this group would be measured for one of them
    // and wrong in the other. `100%` and the 4px track height are the only
    // absolute lengths that may appear.
    for (const selector of [
      '.rt-metrics',
      '.rt-metric',
      '.rt-metric-head',
      '.rt-metric-rows',
      '.rt-metric-note',
    ]) {
      expect(rule(selector)).not.toMatch(/(?:^|[^-])(?:inline-size|width):\s*\d/)
    }
    // The label column is content-sized, so the longest label sets the gutter
    // rather than a number someone measured once.
    expect(rule('.rt-metric-rows')).toMatch(/grid-template-columns:\s*max-content 1fr/)
  })

  it('lets the head row wrap rather than pushing the value out of the panel', () => {
    expect(rule('.rt-metric-head')).toMatch(/flex-wrap:\s*wrap/)
  })

  it('truncates a long card name rather than reflowing the tile', () => {
    const strip = rule('.rt-tile-name')
    expect(strip).toMatch(/text-overflow:\s*ellipsis/)
    expect(strip).toMatch(/white-space:\s*nowrap/)
    // Without a min-width a flex child refuses to shrink below its content,
    // which is what makes ellipsis silently do nothing.
    expect(strip).toMatch(/min-width:\s*0/)
  })

  it('puts space between two abilities of the same face', () => {
    // The DOM half is asserted in OracleText.test.tsx: each ability is its own
    // block. This is the half that makes them read as separate paragraphs
    // rather than as adjacent lines, which was the complaint.
    expect(rule('.rt-oracle-ability')).toMatch(/display:\s*block/)
    expect(rule('.rt-oracle-ability + .rt-oracle-ability')).toMatch(
      /margin-block-start:\s*0?\.\d+em/,
    )
  })

  it('draws a visible line between two faces', () => {
    // A face break with no border is an invisible separator, which is the
    // no-op this whole change exists to avoid.
    const face = rule('.rt-oracle-facebreak')
    expect(face).toMatch(/border-top:\s*1px solid/)
    expect(face).toMatch(/display:\s*block/)
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
