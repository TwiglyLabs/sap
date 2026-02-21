---
title: Architecture Restructure
status: done
description: >-
  Reorganize SAP into feature folders with repository pattern and storage
  abstraction
tags:
  - architecture
  - breaking-change
not_started_at: '2026-02-21T01:03:03.031Z'
completed_at: '2026-02-21T02:00:14.117Z'
---

## Problem
SAP has a flat module structure where all 43 functions/values and 31 types (74 exports total) ship from a single barrel file. The database layer (SQLite via better-sqlite3) is called directly by every command module with no abstraction boundary. This makes it impossible to swap storage backends (e.g., OTEL export) without rewriting every consumer.

Specific issues:
- **No domain boundaries** — all source files sit in `src/` with commands in `src/commands/`. You can't look at the directory structure and understand what the system does.
- **SQLite is hardwired** — every command imports `db.ts` and calls `db.prepare()` directly. The `Database` type from better-sqlite3 leaks into every module signature.
- **Mixed abstraction levels in exports** — low-level operations (`insertSession`, `upsertWorkspace`) sit alongside high-level commands (`sweepCommand`, `gcCommand`) and utilities (`parseDuration`, `buildWhereClause`) in the same public API.
- **CLI and library concerns are entangled** — command modules export both query functions (library API) and CLI handlers (formatting/output logic) from the same files.
- **Duplicated duration parsing** — 4 separate implementations: `analytics-common.ts:parseDuration()` (d/h/m), `gc.ts:parseDuration()` (days only), `sweep.ts:parseSweepThreshold()` (minutes only), `ingest.ts:parseSinceDuration()` (d/h/m duplicate).
## Approach
Reorganize into **feature folders** with the **repository pattern** for storage abstraction. Each feature owns its types, repository interface, service logic, and CLI handler. A `core/` directory holds true shared infrastructure. A `createSap()` factory (moved here from the interface-cleanup plan) wires repositories into services and provides the public entry point.

### Target Directory Structure

```
src/
├── core/
│   ├── storage.ts              # Database connection management (openDb, close)
│   ├── types.ts                # Shared types (Session, Turn, ToolCall, etc.)
│   ├── config.ts               # Constants (DEFAULT_DB_PATH, thresholds)
│   └── utils.ts                # Shared utilities (parseDuration)
│
├── features/
│   ├── sessions/
│   │   ├── session.repository.ts       # SessionRepository interface
│   │   ├── session.service.ts          # Business logic (status, latest, history, sweep, gc)
│   │   ├── session.types.ts            # Feature-specific types (StatusResult, etc.)
│   │   ├── session.cli.ts              # Commander command registration
│   │   ├── __tests__/
│   │   │   ├── session.service.test.ts
│   │   │   └── session.repository.test.ts
│   │   └── sqlite/
│   │       └── session.repository.sqlite.ts  # SQLite implementation
│   │
│   ├── recording/
│   │   ├── recording.repository.ts
│   │   ├── recording.service.ts
│   │   ├── recording.types.ts
│   │   ├── recording.cli.ts
│   │   ├── __tests__/
│   │   └── sqlite/
│   │       └── recording.repository.sqlite.ts
│   │
│   ├── ingestion/
│   │   ├── ingestion.repository.ts
│   │   ├── ingestion.service.ts
│   │   ├── ingestion.types.ts
│   │   ├── ingestion.cli.ts
│   │   ├── transcript.ts               # JSONL parser (pure function, no DB)
│   │   ├── tool-detail.ts              # Tool metadata extraction (pure function)
│   │   ├── __tests__/
│   │   └── sqlite/
│   │       └── ingestion.repository.sqlite.ts
│   │
│   ├── analytics/
│   │   ├── analytics.repository.ts
│   │   ├── analytics.service.ts
│   │   ├── analytics.types.ts
│   │   ├── analytics.cli.ts
│   │   ├── analytics.utils.ts          # buildWhereClause (analytics-only utility)
│   │   ├── __tests__/
│   │   └── sqlite/
│   │       └── analytics.repository.sqlite.ts
│   │
│   └── workspace/
│       ├── workspace.repository.ts
│       ├── workspace.service.ts
│       ├── workspace.types.ts
│       ├── __tests__/
│       └── sqlite/
│           └── workspace.repository.sqlite.ts
│
├── sap.ts                      # createSap() factory, Sap interface, SapOptions
├── cli.ts                      # Commander root, registers all feature CLIs
└── index.ts                    # Public API barrel (re-exports createSap + types)
```

### Dependency Injection

Services are classes that take repository interfaces in their constructor. The `createSap()` factory instantiates SQLite repositories, injects them into service constructors, and returns a namespaced API object:

```typescript
export interface Sap {
  sessions: SessionService;
  recording: RecordingService;
  ingestion: IngestionService;
  analytics: AnalyticsService;
  workspace: WorkspaceService;
  close(): void;
}

export function createSap(options?: SapOptions): Sap {
  const db = openDb(options?.dbPath);
  const sessionRepo = new SessionRepositorySqlite(db);
  const workspaceRepo = new WorkspaceRepositorySqlite(db);
  const sessionService = new SessionService(sessionRepo);
  const workspaceService = new WorkspaceService(workspaceRepo);
  const recordingRepo = new RecordingRepositorySqlite(db);
  const recordingService = new RecordingService(recordingRepo, sessionRepo, workspaceService);
  // ... remaining features
  return { sessions: sessionService, recording: recordingService, /* ... */, close: () => db.close() };
}
```

This means adding OTEL export later requires only writing new repository implementations — no service or CLI changes.

### CLI Database Lifecycle

The CLI entry point (`cli.ts`) opens the db once and constructs a shared app context (the `Sap` instance via `createSap()`). Feature CLI modules receive this context — they never open the db themselves. This keeps db lifecycle in one place and ensures CLI commands use the same wiring as library consumers.

### Duration Parsing Consolidation

There are currently 4 separate duration parsers:
- `analytics-common.ts:parseDuration()` — handles d/h/m (exported in library API)
- `gc.ts:parseDuration()` — local function, handles only days (`Nd`)
- `sweep.ts:parseSweepThreshold()` — exported, handles only minutes (`Nm`)
- `ingest.ts:parseSinceDuration()` — local function, handles d/h/m (duplicate of analytics-common)

Consolidate into one `parseDuration` in `core/utils.ts` that handles all units (d/h/m). Remove the 3 feature-local copies. The library already exports the analytics-common version; the consolidated one replaces it.

### Shared Utilities

- `parseDuration` → `core/utils.ts` (consolidation of 4 current implementations)
- `buildWhereClause` → `features/analytics/analytics.utils.ts` (only consumer is analytics)

### Cross-Feature Reads

The repository-per-feature pattern is a *write* boundary, not a read boundary. `AnalyticsRepository` needs read access across sessions, turns, and tool_calls tables — its SQLite implementation joins across tables directly. The interface defines what data analytics *needs*; the SQLite implementation knows how to query it. No feature owns a table exclusively for reads.

### --json Convention

Every CLI command already follows a clean pattern: query/service functions return structured data objects, CLI handlers check `options.json` and either `JSON.stringify()` the result or format with chalk. This separation is preserved in the restructure:
- **Services** return typed data objects (never format output)
- **CLI handlers** (`.cli.ts` files) own all formatting — both chalk for humans and `JSON.stringify(result, null, 2)` for `--json`
- Chalk remains a devDependency bundled only into the CLI binary, never into the library

### Build Continuity

`build.mjs` compiles two entry points: `src/cli.ts` → `dist/sap.cjs` and `src/index.ts` → `dist/index.js`. During migration (Chunks 1–5), both entry points must keep working:
- `src/index.ts` re-exports from old paths until Chunk 6 rewrites it to export from new paths
- `src/cli.ts` imports from old command files until each feature's CLI handler is migrated
- Old files remain in place until Chunk 6 cleanup — they are not deleted mid-migration
- Each chunk verifies: `npm test` passes AND `npm run build` succeeds

### Test Strategy

Current test files (26 files, 228 tests) fall into two categories:

**Feature tests** (migrate with their feature):
- `src/commands/record.test.ts` → `features/recording/__tests__/`
- `src/commands/status.test.ts` → `features/sessions/__tests__/`
- `src/commands/latest.test.ts` → `features/sessions/__tests__/`
- `src/commands/sessions.test.ts` → `features/sessions/__tests__/`
- `src/commands/gc.test.ts` → `features/sessions/__tests__/`
- `src/commands/sweep.test.ts` → `features/sessions/__tests__/`
- `src/commands/ingest.test.ts` → `features/ingestion/__tests__/`
- `src/commands/analytics-common.test.ts` → `features/analytics/__tests__/`
- `src/commands/analytics-summary.test.ts` → `features/analytics/__tests__/`
- `src/commands/analytics-tools.test.ts` → `features/analytics/__tests__/`
- `src/commands/analytics-sessions.test.ts` → `features/analytics/__tests__/`
- `src/commands/analytics-patterns.test.ts` → `features/analytics/__tests__/`
- `src/transcript.test.ts` → `features/ingestion/__tests__/`
- `src/tool-detail.test.ts` → `features/ingestion/__tests__/`
- `src/workspace.test.ts` → `features/workspace/__tests__/`
- `src/db.test.ts` → split across feature repository tests

**Cross-feature tests** (move to top-level `test/` in Chunk 6):
- `src/integration.test.ts`
- `src/library-e2e.test.ts`
- `src/library-data-access.test.ts`
- `src/library-analytics.test.ts`
- `src/library-lifecycle.test.ts`
- `src/concurrent.test.ts`
- `src/cli.test.ts`
- `src/index.test.ts` — **this test verifies all barrel exports and must be rewritten in Chunk 6 to match the new curated API surface**

### Migration Strategy

This is a restructure, not a rewrite. The logic stays the same; it moves into the right containers:

1. Create the directory structure
2. Extract repository interfaces from current `db.ts` function signatures
3. Move existing `db.ts` functions into SQLite repository implementations
4. Create service classes that wrap repository calls with business logic (currently in command modules)
5. Move CLI handlers into feature-level `.cli.ts` files
6. Implement `createSap()` factory to wire everything together
7. Rewire `cli.ts` to use factory and compose feature CLIs
8. Write new `index.ts` with curated public API
9. Migrate tests to match new structure
10. Verify all tests pass, build succeeds
## Steps
### Chunk 1a: Core Infrastructure

Establish the `core/` directory with shared modules. Purely mechanical moves — no new patterns yet.

1. Create `src/core/types.ts` — move all types from `src/types.ts` (SessionState, EventType, SessionStartSource, HookPayload, Session, SessionStatus, Turn, ToolCall, WorkspaceEntry)
2. Create `src/core/storage.ts` — extract `openDb()` and `DEFAULT_DB_PATH` from `db.ts`, plus the schema initialization. `db.ts` re-exports from `core/storage.ts` so existing imports don't break.
3. Create `src/core/config.ts` — extract constants (STALE_THRESHOLD_MS from status.ts, default durations)
4. Create `src/core/utils.ts` — consolidate `parseDuration` from the 4 current implementations into one function handling d/h/m units
5. Update `src/types.ts` to re-export from `core/types.ts` (backward compat shim)
6. Verify: `npm test` and `npm run build` pass — all old import paths still work

### Chunk 1b: Repository Pattern Proof

Prove the repository pattern with a single feature operation before migrating everything.

1. Create `src/features/sessions/` directory structure (including `sqlite/` and `__tests__/`)
2. Define `SessionRepository` interface from existing `db.ts` session function signatures (start with `getSession`, `getActiveSessions`, `getLatestSession`)
3. Implement `SessionRepositorySqlite` with constructor-injected `Database` — move the 3 operations from `db.ts`
4. Create minimal `SessionService` class that wraps `statusQuery` logic (delegates to repository, adds stale calculation)
5. Create `src/sap.ts` with `createSap()` factory wiring the session service
6. Add a test that creates a `Sap` instance via `createSap()` and calls `sap.sessions.status()`
7. `db.ts` keeps its functions and re-delegates to the SQLite repo internally — no breaking changes yet
8. Verify: `npm test` and `npm run build` pass

### Chunk 2: Sessions Feature (Full Migration)

Migrate all session operations into the established pattern.

1. Complete `SessionRepositorySqlite` — move all remaining session/event functions from `db.ts` (insert, upsert, updateState, getHistory, markStale, deleteStale, insertEvent, getSessionEvents)
2. Complete `SessionService` — extract business logic from `status.ts`, `latest.ts`, `sessions.ts`, `gc.ts`, `sweep.ts`. Replace local duration parsers in gc/sweep with `core/utils.ts:parseDuration`
3. Create `session.types.ts` — move `StatusResult`, `GroupedStatusResult`, `SessionsQueryOptions`, `EventRow`
4. Create `session.cli.ts` — move CLI handlers (statusCommand, latestCommand, sessionsCommand, gcCli, sweepCli)
5. Wire into `cli.ts` and update `createSap()` factory
6. Update `index.ts` to export from new locations
7. Migrate session-related tests into `features/sessions/__tests__/`
8. Verify: `npm test` and `npm run build` pass

### Chunk 3: Recording + Workspace Features

These are tightly coupled (recording uses workspace resolution), so migrate together.

1. Create `src/features/workspace/` directory structure
2. Define `WorkspaceRepository` interface, implement `WorkspaceRepositorySqlite` (upsertWorkspace, getCachedWorkspace)
3. Create `WorkspaceService` — move git resolution logic from `workspace.ts` (resolveWorkspace, resolveWorkspaceFromGit)
4. Create `src/features/recording/` directory structure
5. Define `RecordingRepository` interface, implement `RecordingRepositorySqlite`
6. Create `RecordingService` — move `recordEvent`, `parsePayload`, handler logic from `record.ts`; inject `WorkspaceService` for git resolution
7. Move types for both features
8. Create `recording.cli.ts` — absorb the stdin reading and event type validation currently in `cli.ts` action handler (lines 56-79: readFileSync from stdin, event type whitelist check, parsePayload call). This is unique to recording — other features have their CLI handlers in their command files, but recording's handler is inline in `cli.ts`.
9. Create `workspace.cli.ts` (if workspace has CLI commands) or skip (workspace is library-only, used by recording)
10. Wire into factory and CLI
11. Migrate tests: `workspace.test.ts` → `features/workspace/__tests__/`, `record.test.ts` → `features/recording/__tests__/`
12. Verify: `npm test` and `npm run build` pass

### Chunk 4: Ingestion Feature

1. Create `src/features/ingestion/` directory structure
2. Define `IngestionRepository` interface (turn/tool_call writes, session reads for transcript_path lookup)
3. Implement `IngestionRepositorySqlite` — move turn/tool_call insert logic from `db.ts`, plus the raw SQL in `ingestSession` (DELETE for force-reingest, UPDATE for ingested_at)
4. Create `IngestionService` — move `ingestSession`, `ingestBatch` logic from `ingest.ts`. Replace local `parseSinceDuration` with `core/utils.ts:parseDuration`
5. Move `transcript.ts` and `tool-detail.ts` into ingestion feature (pure functions, no repo dependency)
6. Create `ingestion.cli.ts`
7. Move ingestion types (IngestResult, IngestOptions, BatchResult, BatchOptions)
8. Migrate tests: `ingest.test.ts`, `transcript.test.ts`, `tool-detail.test.ts` → `features/ingestion/__tests__/`
9. Verify: `npm test` and `npm run build` pass

### Chunk 5: Analytics Feature

1. Create `src/features/analytics/` directory structure
2. Define `AnalyticsRepository` interface (read-only queries joining sessions, turns, tool_calls)
3. Implement `AnalyticsRepositorySqlite` — move query logic from all 4 analytics command files; this impl joins across tables directly (cross-feature reads are fine)
4. Move `buildWhereClause` and `parseAnalyticsOptions` into `analytics.utils.ts`
5. Create `AnalyticsService` — thin orchestration layer over repository
6. Create `analytics.cli.ts` — consolidate the 4 analytics CLI handlers (summaryCli, toolsCli, sessionsAnalyticsCli, patternsCli)
7. Move analytics types (FilterOptions, WhereClause, AnalyticsCliOptions, SummaryResult, ToolsResult, SessionAnalytics, SessionsAnalyticsResult, PatternsResult)
8. Move `executeQuery` (raw SQL) into analytics feature — its only use case is ad-hoc analytics queries. Move QueryResult type too.
9. Migrate tests: `analytics-common.test.ts`, `analytics-summary.test.ts`, `analytics-tools.test.ts`, `analytics-sessions.test.ts`, `analytics-patterns.test.ts` → `features/analytics/__tests__/`
10. Verify: `npm test` and `npm run build` pass

### Chunk 6: Cleanup + Integration

1. Delete old files: `src/commands/` directory, `src/db.ts`, `src/workspace.ts`, `src/transcript.ts`, `src/tool-detail.ts`, `src/types.ts`
2. Write final curated `index.ts` barrel export (re-exports `createSap`, `Sap`, `SapOptions`, and types — no raw DB functions)
3. Update `build.mjs` if entry points changed (likely unchanged — still `src/cli.ts` and `src/index.ts`)
4. Move cross-feature tests to top-level `test/` directory:
   - `integration.test.ts`, `library-e2e.test.ts`, `library-data-access.test.ts`
   - `library-analytics.test.ts`, `library-lifecycle.test.ts`, `concurrent.test.ts`
   - `cli.test.ts`
5. Update `vitest.config.ts` include to add `'test/**/*.test.ts'` (current config only matches `src/**/*.test.ts` — tests moved to `test/` would not be found)
6. Rewrite `index.test.ts` to verify the new curated export surface (currently checks all 74 exports — must match new API)
7. Run full test suite including e2e: `npm test` and `npm run test:e2e`
8. Run `npm run build:prod` and verify dist output
9. Verify CLI binary works end-to-end
