# ADR-0015: Mana symbols are drawn, not fetched

- **Status:** Accepted
- **Date:** 2026-08-30
- **Relates to:** [ADR-0009](0009-scryfall-terms.md) Q4, and the `ING-04` gate it
  leaves open

## Context

Mana costs were rendered as Scryfall's brace shorthand — `{2}{R}`, `{X}{G}{G}` —
in the deck rows, the suggestion rows, the card preview, `CardFace` and `Detail`.
It is the wire format, not a reading format. `{2/B}` and `{W/U}` are the same
width and the same colour on screen, and a player scanning a hundred-card list
for "what is expensive and what colour is it" gets nothing from the column.

The obvious fix is the artwork every other Magic tool uses: Scryfall's symbol
SVGs, hotlinked or vendored. That is a terms question, so ADR-0009 was the place
to look, and **ADR-0009 does not settle it.** It establishes ownership:

> "The literal and graphical information presented on this site about Magic: The
> Gathering, including card images and mana symbols, is copyright Wizards of the
> Coast, LLC."

(emphasis ours: *and mana symbols*). And it explicitly *defers* the question of
this project re-serving Scryfall's image files:

> "Re-serving images from our CDN sits close to 'proxy Scryfall data', and
> resizing sits close to 'distort'. … `ING-04` should not ship a three-size
> pipeline without confirming this with Scryfall."

That paragraph is about card images. Symbol files are smaller, cheaper and more
obviously incidental — but they are the same grant, the same copyright holder,
and the same unanswered question, and the difference is one of degree that
nobody has actually asked Scryfall about. AGENTS.md §5 also forbids committing
card images to git, and a vendored symbol set is at minimum an argument about
where that line is.

So the choice was: block this on the `ING-04` conversation, or take the option
that needs no third-party asset at all.

## Decision

**Mana symbols are drawn by this project, from this project's own palette.** No
Scryfall asset is fetched, hotlinked, cached, vendored or committed. A symbol is
a disc, a fill, and a mark:

- `packages/ui/src/card/mana.ts` — pure. Parses a Scryfall cost string into
  `ManaSymbol[]`, and derives the disc colour and the mark colour.
- `packages/ui/src/card/ManaCost.tsx` — the DOM. One span per symbol.
- `.rt-mana` / `.rt-sym` / `.rt-sym-mark` / `.rt-sym-raw` in `card.css`.

Three properties are load-bearing rather than incidental:

**Nothing is silently dropped.** A fragment the parser cannot read becomes an
`unknown` symbol carrying its own source text, and the component prints that text
in a box flagged with the alarm colour. The worst case is that the reader sees
the shorthand, which is where we started. A cost that is *shorter* than the
card's would look correct and be wrong, and that is the failure this shape
exists to make impossible.

**Colour is never the only signal.** Every symbol carries a mark — a letter, a
digit, or a phi for Phyrexian. This is what `Badges.tsx` and `tokens.ts` mean by
"never colour alone", and it is what makes the next point safe.

**The disc palette is the pip palette, lightened 50% toward parchment.**
`IDENTITY_COLORS` were chosen for 8 px marks with nothing written on them; a
mana symbol has a letter on it, and blue at full strength gave that letter 3.8:1,
under the 4.5 floor for text. Lightening fixes the letter, and incidentally makes
the symbol look like the printed one — a pale disc with a dark glyph. It costs
chroma and therefore CVD separation, which is affordable *here and only here*
because of the mark. `mana.test.ts` asserts every disc/mark pair at 4.5:1 and
every disc at 3:1 against the table.

## Consequences

- Costs read as symbols in every place they appear, with no new dependency, no
  build step, no asset pipeline and no network request.
- The symbols are *ours*, and will not look exactly like the printed ones. A
  player will recognise them; a purist will notice. That is the price of not
  guessing at permission.
- `ING-04` is unaffected. It still owns the card-image question and still needs
  the Scryfall conversation ADR-0009 asks for. **If that conversation happens and
  the answer covers symbol files too, this ADR is worth revisiting** — swapping
  the fill for real artwork is a change to one component, because the parser and
  the accessible text are already separate from the drawing.
- Any new mana symbol Wizards prints that this parser does not know renders as
  flagged shorthand rather than as a hole. That is deliberate and is the signal
  to come and add it.

## Alternatives considered

**Hotlink `svgs.scryfall.io`.** Simplest, and what most tools do. Rejected on
two counts: R3 and doc 04 §4.1 say no client request ever hits a third-party
host, and ADR-0009 leaves the image question open rather than granting it.

**Vendor the SVG set into `packages/ui`.** Same terms question, plus AGENTS.md §5
on committing artwork, plus it goes stale silently.

**Serve them from our own object store.** This is exactly the `ING-04` shape
ADR-0009 gates. Would have made a symbol row block on a conversation with
Scryfall that has not happened.

**A web font (Mana, Keyrune).** A real option — but it is a third-party asset
with its own licence to verify, a network or vendoring decision, and a font that
fails to load leaves boxes where the cost was. The drawn version has no load
state at all.

**Leave the shorthand.** The status quo. Rejected: the column exists to be
scanned, and shorthand cannot be.
