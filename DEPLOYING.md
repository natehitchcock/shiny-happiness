# Deploying to Vercel + Neon

The SPA is static; the API is one serverless function; the data lives in a
hosted Postgres. Nothing in the code changes between local and deployed — only
`DATABASE_URL`.

**Not yet deployed.** Everything below is written and typechecked, and the build
runs locally, but it has not been run against a real Vercel project. Treat the
first deploy as a thing to watch rather than a formality.

## What goes where

| Piece | Where | Why |
| --- | --- | --- |
| `apps/web` | Vercel static output | A Vite SPA. No server rendering. |
| `apps/api` | One Vercel Node function, `api/[...path].ts` | Fastify does its own routing; the routes share a pool, a schema compiler and an error handler, and splitting them would rebuild all three per endpoint per cold start. |
| Cards, printings, combos | Neon Postgres (~211 MB) | Read-only reference data (ADR-0009, ADR-0010). |
| Decks | The same Neon database | Scoped by device id, not by account (ADR-0014). |

## First deploy

**1. Create the Neon database** and copy its pooled connection string.

**2. Create the Vercel project** from `natehitchcock/shiny-happiness`. Vercel
reads `vercel.json`, so the build command, output directory and function
runtime are already set — do not fill them in by hand.

**3. Set the environment variables** (Production and Preview both):

| Variable | Value | Notes |
| --- | --- | --- |
| `DATABASE_URL` | the Neon **pooled** string | The Vercel↔Neon integration sets this for you. |
| `DATABASE_POOL_MAX` | `3` | **Not optional.** See below. |
| `SCRYFALL_USER_AGENT` | `LotusWizard/0.1 (your-contact)` | Only used by ingest, which runs locally — but set it so a one-off run from the dashboard is compliant with ADR-0009 Q2. |

`DATABASE_POOL_MAX` matters more than it looks. Every warm serverless instance
holds its own pool, so live connections are (instances × max). The default of 10
is right for one long-running server and wrong here: Neon's free tier allows far
fewer than Vercel will happily scale to, and exhausting them does not fail for
the request that did it — it fails for somebody else's.

**4. Migrate and load the corpus.** Both run from your machine against Neon;
neither belongs in the Vercel build, which has a time limit and would re-run
them on every deploy.

```bash
export DATABASE_URL='postgres://…neon…'

pnpm build
pnpm --filter @roundtable/db migrate up      # 0001 … 0004

# ~35k cards, ~110k printings. Tens of minutes over the network.
pnpm --filter @roundtable/ingest start cards

# ~108k combos from Commander Spellbook (ADR-0010).
pnpm --filter @roundtable/ingest start combos
```

Load the corpus **before** the first request. An API pointed at an empty schema
returns empty suggestion groups with no error, which looks like a scoring bug
rather than a missing database.

**5. Check it.** `GET /api/v1/decks` should return `{"items":[]}` — that
exercises the function, the pool, the schema and the device-id fallback in one
call. Then open the site and build a deck.

## Things to know before the first deploy

**Cold starts.** A cold invocation builds the Fastify instance and opens a
connection. Neon's free tier also suspends an idle database, adding a second or
two on top. The first request after a quiet period will feel slow; the pipeline's
progress bar covers it honestly, which is one reason it exists.

**`maxDuration` is 30s.** The recommendation endpoint scores the whole candidate
pool. It is well inside that locally, but locally the database is on the same
machine — watch the first production timing before assuming.

**There is no login, so there is no recovery.** Decks are keyed to a device id in
`localStorage` (ADR-0014). Clearing site data loses every deck on that device and
nothing can get them back. Export is the only backup.

**Migrations are not automatic.** Nothing runs them on deploy, deliberately: a
migration racing several cold-starting functions is a bad way to find out that
two of them ran it. Run `migrate up` yourself, before the deploy that needs it.

## Local development is unchanged

```bash
pnpm --filter @roundtable/api start     # :3111
pnpm --filter @roundtable/web dev       # :5173, proxies /api to 3111
```
