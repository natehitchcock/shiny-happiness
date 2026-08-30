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
| `DATABASE_URL` | the Neon **pooled** string (hostname contains `-pooler`) | Serverless opens a connection per instance, so the app must go through PgBouncer. |
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

**Migrations and ingest use the DIRECT string, not the pooled one.** Neon gives
you both; `neon env pull` writes them as `DATABASE_URL` (pooled) and
`DATABASE_URL_UNPOOLED` (direct, no `-pooler` in the hostname).

This is not a nicety. The pooled endpoint is PgBouncer in *transaction* mode,
which does not carry session state across statements, and our migration runner
executes DDL inside `withTransaction`. When it breaks it never says "pooling" —
it says `prepared statement "s0" already exists`, or a `SET` silently fails to
persist so the next statement reports a relation that does not exist, or a write
lands on a backend that inherited a read-only transaction (`SQLSTATE 25006`).

```bash
export DATABASE_URL="$DATABASE_URL_UNPOOLED"   # direct, for schema + bulk load

pnpm build
pnpm --filter @roundtable/db migrate up      # `migrate status` first, to see what is pending

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

## Two notes on `vercel.json`

JSON has no comments, so the two non-obvious bits live here.

**The function runtime is deliberately not pinned.** An earlier version pinned
`@vercel/node@5.3.28`, which does not exist — the deploy failed with `ETARGET`
before it built anything. Vercel already selects the Node runtime for a `.ts`
file under `/api`, so pinning it buys nothing and adds a version that has to
stay real and stay compatible. Leave it unset.

**The `functions` key is `api/*.ts`, not `api/[...path].ts`.** That key is a
glob, and `[...path]` in a glob is a character class — it would match one
character from the set `.path` rather than the file we mean. `api/*.ts` has no
brackets in the pattern, so it matches the file by its literal name.

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

This has already gone wrong once. Production sat four migrations behind for
weeks, and the symptom was not an error — it was creatures with no printed
power or toughness, because `0006` adds the columns and nothing had added them.
A schema that is merely OLD serves nulls, and nulls render as absent rather than
as broken. **Run `migrate status` against production whenever something is
missing rather than wrong**; it is a five-second check that names the cause
directly.

**A migration that adds a column does not fill it.** `0006` is the example:
after `migrate up`, every card has `power = NULL` until the cards ingest runs
again. Adding a column to `cards` therefore means step 4 as well as step 3.

## Diagnosing a broken deployment

`FUNCTION_INVOCATION_FAILED` is what the platform reports when the function
fails to *load*. It carries no message, so the first thing to establish is
whether the code or the environment is at fault:

```bash
curl -H "x-vercel-protection-bypass: <secret>"      "https://<deployment>/api/v1/decks"
```

- **`{"title":"API unavailable","detail":"DATABASE_URL is not set…"}`** — the
  function loaded and told you what is missing. Set it and redeploy.
- **`FUNCTION_INVOCATION_FAILED` still** — the module itself failed to load,
  which the handler cannot catch because the imports are static. That is a
  bundling problem, not a configuration one: check that the build ran
  `pnpm build` before the web build, so `apps/api/dist` and `packages/*/dist`
  exist for the function to import.
- **`{"items":[]}`** — everything works; the database is simply empty. Run the
  ingest (step 4).

**A field that is missing rather than wrong** — every creature's power blank,
every fuzzy name search finding nothing — is almost always a migration that was
never applied, not a bug in the code that reads it:

```bash
DATABASE_URL="$DATABASE_URL_UNPOOLED" pnpm --filter @roundtable/db migrate status
```

`api/handler.test.ts` runs the same handler locally, so "the imports resolve and
the env-missing path answers" is checked on every `pnpm test` rather than only
in production.

## Custom domain

Adding a domain is not just a DNS change. Two other things bite:

- **Deployment Protection must be off** for the domain to be publicly usable. A
  site behind Vercel Authentication is not public, whatever its address.
- **Vercel issues the certificate itself**, once the domain resolves to it. Until
  then a browser reaching the old host over HTTPS gets
  `ERR_SSL_UNRECOGNIZED_NAME_ALERT` — a TLS handshake to a server holding no
  certificate for that name. That error means "pointing at the wrong place",
  never "certificate not issued yet".

Take the exact records from Vercel's Domains page when you add the domain. They
change, and a value copied from anywhere else is a value that will be wrong
eventually.

## Local development is unchanged

```bash
pnpm --filter @roundtable/api start     # :3111
pnpm --filter @roundtable/web dev       # :5173, proxies /api to 3111
```
