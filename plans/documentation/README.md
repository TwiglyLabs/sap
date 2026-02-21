---
title: Documentation
status: draft
description: Root CLAUDE.md for agent context and README for human consumers
depends_on:
  - architecture-restructure
tags:
  - documentation
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

Write root-level `CLAUDE.md` covering:
- Project purpose and architecture overview
- Feature folder structure and the repository pattern convention
- How to add a new feature (template)
- How storage abstraction works (interface → sqlite/ adapter)
- Testing conventions (vitest, co-located tests, e2e)
- Build and development commands
- Key file locations
- Freshness date

### Chunk 2: README.md

Write root-level `README.md` covering:
- One-paragraph description of SAP
- Installation (`npm install @twiglylabs/sap`)
- CLI quick start with common command examples
- Library API usage with code snippets (open db, record events, query sessions, run analytics)
- Configuration (SAP_DB_PATH, thresholds)
- Feature overview table mapping features to CLI commands and library exports

### Chunk 3: JSDoc on Public API

- Add JSDoc comments to all exports in `index.ts`
- Add JSDoc to repository interfaces (these are the contracts)
- Add JSDoc to service public methods
- Keep it terse — one line per function, @param only when non-obvious
