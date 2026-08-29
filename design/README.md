# Design canvas sources

Artboards for the UI mockup, authored as Design Component (`.dc.html`) files and
laid out by `canvas.json`.

**Live canvas:** https://claude.ai/code/artifact/b25672ce-131d-427b-8fc6-d52b14dc9349

| Artboard | Shows |
| --- | --- |
| `Main.dc.html` | Desktop workspace at zoom L2 (card) — the primary screen |
| `ZoomGrid.dc.html` | Same workspace at L1 (art-crop grid) |
| `ZoomConstellation.dc.html` | Same workspace at L0, every card a pip coloured by combo degree |
| `Filter.dc.html` | Active candidate query — chips, autocomplete, withheld-by-filter footers |
| `Inspect.dc.html` | L3 detail panel with generated reasons and combo lines |
| `Library.dc.html` | Deck library (doc 12 §12.4) |
| `Switcher.dc.html` | Command-bar deck switcher (doc 12 §12.3) |
| `MobilePeek.dc.html` | Phone, deck sheet at peek detent |
| `MobileHalf.dc.html` | Phone, deck sheet at half detent — both regions visible |
| `MobileInspect.dc.html` | Phone inspect sheet, plus swipe accept/reject affordances |
| `MobileFilter.dc.html` | Phone faceted filter sheet (doc 13 §13.5) |

The seeded canvas file (`commander-deck-builder-ui.html`) is build output and is
gitignored — it is ~2 MB of embedded editor. Regenerate it from these sources.

## Direction

Warm-dark "workshop" palette: chrome is desaturated so card art carries the only
saturation, with a single amber accent chosen not to collide with the five mana
colours. Space Grotesk for display, Archivo for UI text, IBM Plex Mono for every
number — this interface is mostly counts.

**Card art is placeholder.** The gradients stand in for real Scryfall imagery,
keyed to colour identity. Card names, mana costs, type lines and combo lines are
real and colour-identity-correct for a mono-red Krenko deck.
