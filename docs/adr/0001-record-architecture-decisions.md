# ADR-0001: Record architecture decisions

- **Status:** Accepted
- **Date:** 2026-08-29

## Context

This project is specified up front and implemented largely by parallel agents who
do not share context. The reasoning behind a decision is the first thing lost, and
its absence causes the same debate to be re-litigated by each new contributor.

## Decision

Record every consequential architectural decision as an ADR in `docs/adr/`,
numbered sequentially, using this format: Context, Decision, Consequences,
Alternatives considered.

An ADR is required for:
- Changing an exported type in `packages/domain` or a shape in the API contract
- Adding or removing a third-party data source
- Changing the stack, or a core library in a category listed in doc 09 §9.3
- Any deviation from a pillar in doc 01

ADRs are immutable once accepted. To reverse one, write a new ADR that supersedes
it and mark the old one `Superseded by ADR-NNNN`.

## Consequences

Small ongoing cost per decision. In exchange, an agent joining cold can read why
things are as they are instead of guessing, and reversals are deliberate rather
than accidental.
