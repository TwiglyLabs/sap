---
title: Documentation
status: done
description: Root CLAUDE.md for agent context and README for human consumers
depends_on:
  - architecture-restructure
tags:
  - documentation
not_started_at: '2026-02-21T01:03:04.206Z'
started_at: '2026-02-21T03:09:00.509Z'
completed_at: '2026-02-21T03:18:50.872Z'
---

## Problem
SAP has zero documentation. No README, no CLAUDE.md, no JSDoc on public API. An agent opening this repo has no context on architecture, conventions, or contracts. A human consumer has no getting-started guide or API reference.

This blocks both:
- **Agent productivity** — Claude Code working in this repo (or in `canopy` consuming it) has to infer architecture from file reads
- **Human usability** — Even the author has to read source to remember CLI flags and library API
## Approach
Write two documents, each serving a distinct audience:

1. **CLAUDE.md** (agent-facing) — Architecture overview, feature folder contracts, naming conventions, testing patterns, build commands. This is what an agent reads to orient itself before making changes.

2. **README.md** (human-facing) — What SAP is, installation, CLI usage with examples, library API overview with code snippets, configuration options.

Both documents are written *after* the architecture restructure lands so they describe the final state, not the current state. JSDoc is added to the public API surface in `index.ts` and on repository interfaces.

## Steps
### Chunk 1: CLAUDE.md

**Depends on:** architecture-restructure only (describes structure, not API details)

Write root-level `CLAUDE.md` covering:
- Project purpose and architecture overview
- Feature folder structure and the repository pattern convention
- How to add a new feature (template)
- How storage abstraction works (interface → sqlite/ adapter)
- `createSap()` factory and dependency injection pattern
- Testing conventions (vitest, co-located feature tests, top-level cross-feature tests)
- Build and development commands
- Key file locations
- Freshness date

### Chunk 2: README.md

**Depends on:** architecture-restructure only (documents usage patterns, not internal API)

Write root-level `README.md` covering:
- One-paragraph description of SAP
- Installation (`npm install @twiglylabs/sap`)
- Quick start with `createSap()` factory pattern
- CLI quick start with common command examples
- Library API usage with code snippets (create instance, record events, query sessions, run analytics)
- Subpath imports for advanced usage
- Configuration (SAP_DB_PATH, thresholds)
- Feature overview table mapping features to CLI commands and library exports

### Chunk 3: JSDoc on Public API

**Depends on:** interface-cleanup (API surface must be finalized before documenting it)

This chunk cannot start until interface-cleanup is complete. While the documentation plan's trellis `depends_on` is set to architecture-restructure (so Chunks 1-2 can start immediately after it), this chunk has an additional implicit dependency on interface-cleanup.

- Add JSDoc comments to `createSap()`, `Sap` interface, `SapOptions`
- Add JSDoc to all type exports in `index.ts`
- Add JSDoc to repository interfaces (these are the contracts)
- Add JSDoc to service public methods
- Keep it terse — one line per function, @param only when non-obvious
