# ADR-0003: Stack selection

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

The stack must support: a canvas-heavy, highly interactive single workspace;
identical recommendation logic on client and server; full touch and keyboard
accessibility for drag interactions; and — the constraint that shaped this most —
many agents working in parallel without collisions.

## Decision

TypeScript monorepo (pnpm workspaces + Turborepo). React 18 + Vite SPA, Fastify
API, PostgreSQL, Redis. `dnd-kit` for drag and drop, TanStack Virtual for
virtualisation, hand-written 2D canvas for the L0 constellation view. Full table
in doc 09 §9.3.

The load-bearing choice is `packages/domain`: pure, IO-free, shared by web and
api.

## Consequences

- Client and server cannot drift in recommendation results, because they run the
  same functions.
- Domain work needs no infrastructure to build or test, so it parallelises freely
  and can start on day one.
- The purity rule must be enforced (lint rule banning imports of IO modules from
  `packages/domain`), or it will erode within weeks.
- SPA means no SEO surface. Fine for an authenticated workspace; would need
  revisiting if public deck sharing is ever added.

## Alternatives considered

- **Next.js.** SSR and API routes in one framework, but the app has no content
  pages and essentially no SEO surface, and the framework adds friction around the
  canvas and virtualisation work. Revisit if a public sharing surface appears.
- **`react-beautiful-dnd`.** Deprecated, and its touch support is weaker than
  dnd-kit's. Rejected.
- **HTML5 drag-and-drop API.** No touch support at all. Fails pillar P1 outright.
- **WebGL for L0.** Faster than 2D canvas at very high pip counts, but a large
  dependency and a worse accessibility story for a view that tops out around 5,000
  elements. 2D canvas is sufficient; revisit if `PERF-01` says otherwise.
- **Python/FastAPI backend.** Would break the shared-domain property, which is the
  main thing making parallel agent work safe here.
