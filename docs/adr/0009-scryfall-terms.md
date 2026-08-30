# ADR-0009: Scryfall terms, answered (DATA-01)

- **Status:** Accepted
- **Date:** 2026-08-29
- **Supersedes:** the Scryfall questions in [ADR-0006](0006-data-source-terms-verification.md)

All quotations retrieved **2026-08-29** from `https://scryfall.com/docs/api`,
`/docs/api/rate-limits` and `/docs/api/bulk-data`.

## The decision

**Scryfall is used, in full, for card data.** Their stated purpose covers exactly
what this project is:

> "As part of the Wizards of the Coast Fan Content Policy, Scryfall provides our
> card data and image database free of charge for the primary purpose of creating
> additional Magic software, performing research, or creating community content
> … about Magic and related products."

With one binding condition that shapes the product, not just the adapter:

> "Do not simply repackage, republish, or proxy Scryfall data. Your software must
> create additional value for end-users."

A deck-building tool that computes combo degree, composition deficits and bracket
assessment is additional value. A page that lists Scryfall's card data would not
be. This is worth re-reading before adding any "browse all cards" surface.

## The seven questions

**Q1 — Rate limits.** Per-endpoint, not global:

> "/cards/search — 2/second (500ms) · /cards/named — 2/second (500ms) ·
> /cards/random — 2/second (500ms) · /cards/collection — 2/second (500ms) ·
> /cards/manifest — 10/minute (6,000ms) · All other methods — 10/second (100ms)"

> "The direct file origins located at *.scryfall.io do not have rate limits."

**Doc 04 §4.1 was wrong.** It guessed a single "10/s, 50–100 ms" limit; search is
four times stricter at 2/s, and the bulk file origin is unlimited. The limiter
must be configured per endpoint, not once.

> "Recieving an HTTP 429 response will result in your access being limited for 30
> seconds. Continuing to overload the API after this point may result in a
> temporary or permanent ban of your application." … "It is not acceptable to
> ignore HTTP 429 responses."

**Q2 — Headers.** Both are mandatory:

> "All HTTP requests to api.scryfall.com must include a User-Agent header and an
> Accept header. Your User-Agent header must be accurate to your usage context.
> If you are running a script or app, the header should be the name of your
> application, such as MTGExampleApp/1.0 … Do not allow HTTP libraries to choose
> the header for you."

No contact address is demanded, unlike some sources. `Accept` may be generic.

**Q3 — Bulk data, and it is mandatory rather than merely allowed:**

> "If you need to rapidly look up card names, prices, or resolve a large number of
> card images, you must use the bulk data files."

> "Bulk data is only collected once every 12-24 hours."

> "We encourage you to cache the data you download from Scryfall or process it
> locally in your own system, at least for 24 hours."

The Oracle Cards export was 23.4 MB compressed on 2026-08-29. Crawling `/cards/*`
to build a corpus is therefore not just rude, it is against the documented
instruction. `ING-01` uses bulk. Refresh weekly for gameplay data:

> "Updates to gameplay data … are much less frequent. If you only need gameplay
> information, downloading card data once per week or right after set releases
> would most likely be sufficient."

**Q4 — Data versus images.** They are covered by the same grant, and both are
Wizards' copyright, not Scryfall's:

> "The literal and graphical information presented on this site about Magic: The
> Gathering, including card images and mana symbols, is copyright Wizards of the
> Coast, LLC."

Caching is explicitly encouraged and image files come from the unlimited
`*.scryfall.io` origins. Image *presentation* is constrained:

> "Do not cover, crop, or clip off the copyright or artist name on card images. Do
> not distort, skew, or stretch card images. Do not blur, sharpen, desaturate, or
> color-shift card images. Do not add your own watermarks, stamps, or logos to
> card images."

**Open point for `ING-04`, flagged rather than assumed:** doc 07 §7.3 wants three
image sizes served from our own object store, and doc 04 §4.1 wants "no client
request ever hits a third-party image host". Re-serving images from our CDN sits
close to "proxy Scryfall data", and resizing sits close to "distort". The safe
reading is: cache for performance, serve at the aspect ratio Scryfall provides,
never re-encode in a way that alters the art, and keep the artist and copyright
line legible at every size that shows them. **`ING-04` should not ship a
three-size pipeline without confirming this with Scryfall.** That is a smaller
question than the one ADR-0006 posed, and it gates only `ING-04`.

**Q5 — Attribution.** No specific wording is mandated for data use, but the Fan
Content Policy framing is, and Scryfall's own footer is the model:

> "Portions of Scryfall are unofficial Fan Content permitted under the Wizards of
> the Coast Fan Content Policy. The literal and graphical information presented on
> this site about Magic: The Gathering … is copyright Wizards of the Coast, LLC.
> Scryfall is not produced by or endorsed by Wizards of the Coast."

`LEGAL-01` carries an equivalent notice, naming Scryfall as the data source and
disclaiming Wizards' endorsement.

**Q6 — Redistribution.** "Do not simply repackage, republish, or proxy Scryfall
data" settles it. AGENTS.md §5's rule stands: bulk card data is never committed to
git and never re-served as a bulk download.

**Q7 — Prices carry their own warning**, and it is strong enough to be a product
constraint:

> "Card objects in bulk data include price information, but prices should be
> considered dangerously stale after 24 hours. Only use bulk price information to
> track trends or provide a general estimate of card value. Prices are not updated
> frequently enough to power a storefront or sales system. You consume price
> information at your own risk."

> "Absolutely no guarantee is made for any price information."

Budget filtering (doc 05, doc 13 `price:`) may use these as **estimates only**.
Any price shown must be labelled as an estimate with its retrieval date. The app
must never present a total as what a deck costs to buy.

## Consequences

- `ING-01` is unblocked and uses bulk data on a weekly cadence.
- `packages/clients` needs a **per-endpoint** limiter, not one global bucket, and
  must treat 429 as a hard back-off rather than a retry-immediately.
- Doc 04 §4.1's rate-limit figures are corrected in the same change as this ADR.
- `ING-04` remains gated on the narrower image-serving question above.
- Prices are estimates, labelled as such, everywhere they appear.
