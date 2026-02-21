---
title: Architecture Restructure
status: draft
description: >-
  Reorganize SAP into feature folders with repository pattern and storage
  abstraction
tags:
  - architecture
  - breaking-change
---

## Problem
SAP has a flat module structure where all 44 functions and 20 types export from a single barrel file. The database layer (SQLite via better-sqlite3) is called directly by every command module with no abstraction boundary. This makes it impossible to swap storage backends (e.g., OTEL export) without rewriting every consumer.

Specific issues:
- **No domain boundaries** — all source files sit in `src/` with commands in `src/commands/`. You can't look at the directory structure and understand what the system does.
- **SQLite is hardwired** — every command imports `db.ts` and calls `db.prepare()` directly. The `Database` type from better-sqlite3 leaks into every module signature.
- **Mixed abstraction levels in exports** — low-level operations (`insertSession`, `upsertWorkspace`) sit alongside high-level commands (`sweepCommand`, `gcCommand`) and utilities (`parseDuration`, `buildWhereClause`) in the same public API.
- **CLI and library concerns are entangled** — command modules export both query functions (library API) and CLI handlers (formatting/output logic) from the same files.
## Approach
Reorganize into **feature folders** with the **repository pattern** for storage abstraction. Each feature owns its types, repository interface, service logic, and CLI handler. A `core/` directory holds true shared infrastructure.

### Target Directory Structure

```
src/
├── core/
│   ├── storage.ts              # Database connection management (openDb, close)
│   ├── types.ts                # Shared types (Session, Turn, ToolCall, etc.)
│   └── config.ts               # Constants (DEFAULT_DB_PATH, thresholds)
│
├── features/
│   ├── sessions/
│   │   ├── session.repository.ts       # SessionRepository interface
│   │   ├── session.service.ts          # Business logic (status, latest, history, sweep, gc)
│   │   ├── session.types.ts            # Feature-specific types (StatusResult, etc.)
│   │   ├── session.cli.ts              # Commander command registration
│   │   └── sqlite/
│   │       └── session.repository.sqlite.ts  # SQLite implementation
│   │
│   ├── recording/
│   │   ├── recording.repository.ts     # RecordingRepository interface
│   │   ├── recording.service.ts        # Event recording, payload parsing
│   │   ├── recording.types.ts          # HookPayload, EventType, etc.
│   │   ├── recording.cli.ts            # `record` command
│   │   └── sqlite/
│   │       └── recording.repository.sqlite.ts
│   │
│   ├── ingestion/
│   │   ├── ingestion.repository.ts     # IngestionRepository interface
│   │   ├── ingestion.service.ts        # Transcript parsing, turn grouping, ingest
│   │   ├── ingestion.types.ts          # TranscriptLine, ParsedTurn, IngestResult
│   │   ├── ingestion.cli.ts            # `ingest` command
│   │   ├── transcript.ts               # JSONL parser (pure function, no DB)
│   │   ├── tool-detail.ts              # Tool metadata extraction (pure function)
│   │   └── sqlite/
│   │       └── ingestion.repository.sqlite.ts
│   │
│   ├── analytics/
│   │   ├── analytics.repository.ts     # AnalyticsRepository interface
│   │   ├── analytics.service.ts        # Query orchestration
│   │   ├── analytics.types.ts          # SummaryResult, ToolsResult, etc.
│   │   ├── analytics.cli.ts            # `analytics` subcommands
│   │   └── sqlite/
│   │       └── analytics.repository.sqlite.ts
│   │
│   └── workspace/
│       ├── workspace.repository.ts     # WorkspaceRepository interface
│       ├── workspace.service.ts        # Git resolution, caching
│       ├── workspace.types.ts          # WorkspaceEntry
│       └── sqlite/
│           └── workspace.repository.sqlite.ts
│
├── cli.ts                      # Commander root, registers all feature CLIs
└── index.ts                    # Public API barrel (intentional, curated exports)
```

### Repository Pattern

Each feature defines an interface that describes its storage needs:

```typescript
// features/sessions/session.repository.ts
export interface SessionRepository {
  insert(params: InsertSessionParams): void;
  upsert(params: UpsertSessionParams): void;
  get(sessionId: string): Session | null;
  updateState(sessionId: string, state: SessionState, eventTime: string, tool?: ToolContext): void;
  getActive(workspace?: string): Session[];
  getLatest(workspace: string): Session | null;
  getHistory(params: HistoryParams): Session[];
  markStale(thresholdMs: number): number;
  deleteStale(olderThanMs: number): number;
}
```

The SQLite implementation lives in the `sqlite/` subdirectory. Services depend only on the interface. This means adding OTEL export later requires only writing new repository implementations — no service or CLI changes.

### Migration Strategy

This is a restructure, not a rewrite. The logic stays the same; it moves into the right containers:

1. Create the directory structure
2. Extract repository interfaces from current `db.ts` function signatures
3. Move existing `db.ts` functions into SQLite repository implementations
4. Create services that wrap repository calls with business logic (currently in command modules)
5. Move CLI handlers into feature-level `.cli.ts` files
6. Rewire `cli.ts` to compose feature CLIs
7. Write new `index.ts` with curated public API
8. Migrate tests to match new structure
9. Verify all tests pass, build succeeds

## Steps
### Chunk 1: Core + Sessions Feature

Establish the pattern with the most central feature. Once sessions works, the remaining features follow the same template.

1. Create `src/core/` with `types.ts` (move from `src/types.ts`), `storage.ts` (extract `openDb` + connection management from `db.ts`), `config.ts` (constants)
2. Create `src/features/sessions/` directory structure
3. Define `SessionRepository` interface from existing `db.ts` session functions
4. Implement `SessionRepositorySqlite` — move logic from `db.ts` session/event functions
5. Create `session.service.ts` — extract business logic from `status.ts`, `latest.ts`, `sessions.ts`, `gc.ts`, `sweep.ts`
6. Create `session.cli.ts` — move CLI handlers from the command files
7. Create `session.types.ts` — move `StatusResult`, `GroupedStatusResult`, `SessionsQueryOptions` etc.
8. Wire into `cli.ts` and update `index.ts`
9. Migrate session-related tests
10. Verify: `npm test` and `npm run build` pass

### Chunk 2: Recording Feature

1. Create `src/features/recording/` directory structure
2. Define `RecordingRepository` interface (event insertion, session state updates)
3. Implement `RecordingRepositorySqlite` — move event + session mutation logic
4. Create `recording.service.ts` — move `recordEvent`, `parsePayload`, handler logic from `record.ts`
5. Create `recording.cli.ts` — move CLI handler
6. Move `recording.types.ts` — `HookPayload`, `EventType`, `SessionStartSource`
7. Migrate recording tests
8. Verify: all tests pass

### Chunk 3: Workspace Feature

1. Create `src/features/workspace/` directory structure
2. Define `WorkspaceRepository` interface (cache read/write)
3. Implement `WorkspaceRepositorySqlite` — move from `db.ts` workspace functions
4. Create `workspace.service.ts` — move git resolution logic from `workspace.ts`
5. Move `workspace.types.ts` — `WorkspaceEntry`
6. Update recording service to depend on workspace service (not raw db calls)
7. Migrate workspace tests
8. Verify: all tests pass

### Chunk 4: Ingestion Feature

1. Create `src/features/ingestion/` directory structure
2. Define `IngestionRepository` interface (turn/tool_call writes, session reads)
3. Implement `IngestionRepositorySqlite` — move turn/tool_call insert logic
4. Create `ingestion.service.ts` — move `ingestSession`, `ingestBatch` logic from `ingest.ts`
5. Move `transcript.ts` and `tool-detail.ts` into ingestion feature (pure functions, no repo dependency)
6. Create `ingestion.cli.ts`
7. Move ingestion types
8. Migrate ingestion tests
9. Verify: all tests pass

### Chunk 5: Analytics Feature

1. Create `src/features/analytics/` directory structure
2. Define `AnalyticsRepository` interface (read-only queries for summary, tools, sessions, patterns)
3. Implement `AnalyticsRepositorySqlite` — move query logic from all 4 analytics command files
4. Create `analytics.service.ts` — thin orchestration layer
5. Create `analytics.cli.ts` — consolidate the 4 analytics CLI handlers
6. Move analytics types and shared utilities (`parseDuration`, `buildWhereClause`)
7. Move `executeQuery` (raw SQL) into analytics or core depending on fit
8. Migrate analytics tests
9. Verify: all tests pass

### Chunk 6: Cleanup + Integration

1. Delete old `src/commands/` directory
2. Delete old `src/db.ts`, `src/workspace.ts`, `src/transcript.ts`, `src/tool-detail.ts`, `src/types.ts`
3. Write final curated `index.ts` barrel export
4. Update `build.mjs` if entry points changed
5. Run full test suite including e2e
6. Run `npm run build:prod` and verify dist output
7. Verify CLI binary works end-to-end
