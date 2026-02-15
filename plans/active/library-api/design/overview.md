# library-api — SAP as a Library

Last updated: 2026-02-15

## What

Extract the SAP CLI's business logic into a clean, importable library API so that
an Electron app (or any Node.js consumer) can do everything the CLI does without
shelling out to `sap` commands.

## Why

The current architecture is CLI-first: every capability is accessed by running
`sap <command>` as a subprocess. An Electron app that needs to poll session
status, record events, run analytics, or ingest transcripts would have to:

1. Spawn `sap` as a child process for every operation
2. Parse stdout JSON
3. Handle process lifecycle errors

This is fragile, slow, and prevents the Electron app from participating in the
same database connection (e.g., holding a persistent `Database` handle with WAL
mode). A library API lets the Electron app call functions directly, get typed
return values, and manage the database lifecycle itself.

## Current State Analysis

The codebase already has a natural seam between business logic and CLI concerns.
Every command file follows the same pattern:

```
// Pure business logic — takes db, returns typed data
export function fooQuery(db, options): FooResult { ... }

// CLI glue — parses argv, calls query, formats output
export function fooCli(db, options): void { console.log(...) }
```

The library API formalizes this split: export the query/command layer, types,
database helpers, and utilities. Drop the CLI formatting layer.

## What Changes

**Nothing breaks.** The CLI continues to work exactly as before. We're adding
a second entry point (`src/index.ts`) that re-exports the library surface. The
build gains a second output (`dist/index.js` for library consumers) alongside
the existing `dist/sap.cjs` CLI binary.

## Architecture

```
src/index.ts              ← NEW: library entry point (re-exports)
  ├── src/db.ts           ← already exists (openDb, CRUD operations)
  ├── src/types.ts         ← already exists (Session, Turn, etc.)
  ├── src/workspace.ts     ← already exists (resolveWorkspace)
  ├── src/transcript.ts    ← already exists (parse, groupIntoTurns)
  ├── src/tool-detail.ts   ← already exists (extractToolDetail)
  ├── src/commands/record.ts      ← recordEvent, parsePayload
  ├── src/commands/status.ts      ← statusQuery, statusQueryGrouped
  ├── src/commands/latest.ts      ← latestQuery
  ├── src/commands/sessions.ts    ← sessionsQuery
  ├── src/commands/gc.ts          ← gcCommand
  ├── src/commands/sweep.ts       ← sweepCommand
  ├── src/commands/ingest.ts      ← ingestSession, ingestBatch
  ├── src/commands/query.ts       ← executeQuery
  ├── src/commands/analytics-common.ts   ← parseDuration, buildWhereClause
  ├── src/commands/analytics-summary.ts  ← summaryQuery
  ├── src/commands/analytics-tools.ts    ← toolsQuery
  ├── src/commands/analytics-sessions.ts ← sessionsAnalyticsQuery
  └── src/commands/analytics-patterns.ts ← patternsQuery

src/cli.ts                ← unchanged: CLI entry point
```

The Electron app imports like:

```typescript
import { openDb, recordEvent, statusQuery, summaryQuery } from '@twiglylabs/sap';
```

## API Surface — Full Parity Matrix

| CLI Command                  | Library Function              | Return Type              |
|------------------------------|-------------------------------|--------------------------|
| `sap record --event <type>`  | `recordEvent(db, type, data)` | `void`                   |
| `sap status`                 | `statusQuery(db, workspace?)` | `StatusResult`           |
| `sap status --group`         | `statusQueryGrouped(db, ws?)` | `GroupedStatusResult`    |
| `sap latest --workspace X`   | `latestQuery(db, workspace)`  | `Session \| null`        |
| `sap sessions`               | `sessionsQuery(db, options)`  | `Session[]`              |
| `sap gc --older-than 30d`    | `gcCommand(db, olderThanMs)`  | `number`                 |
| `sap sweep --threshold 10m`  | `sweepCommand(db, thresholdMs)`| `number`                |
| `sap ingest`                 | `ingestBatch(db, options)`    | `BatchResult`            |
| `sap ingest --session X`     | `ingestSession(db, id, opts)` | `IngestResult`           |
| `sap query "SQL"`            | `executeQuery(db, sql)`       | `QueryResult`            |
| `sap analytics summary`      | `summaryQuery(db, filters)`   | `SummaryResult`          |
| `sap analytics tools`        | `toolsQuery(db, filters)`     | `ToolsResult`            |
| `sap analytics sessions`     | `sessionsAnalyticsQuery(...)`  | `SessionsAnalyticsResult`|
| `sap analytics patterns`     | `patternsQuery(db, filters)`  | `PatternsResult`         |

Plus utilities:
- `openDb(path?)` — database lifecycle
- `parsePayload(raw)` — validate hook JSON
- `resolveWorkspace(db, cwd, force)` — git workspace resolution
- `resolveWorkspaceFromGit(cwd)` — git resolution without db
- `parseTranscriptLine(raw)` — parse one JSONL line
- `groupIntoTurns(lines)` — aggregate transcript lines into turns
- `extractToolDetail(name, input)` — tool input summary
- `parseDuration(s)` — parse "7d", "24h", "30m" strings
- `buildWhereClause(filters, col)` — analytics filter builder
- `parseSweepThreshold(s)` — parse "10m" threshold strings

Plus all types:
- `SessionState`, `EventType`, `SessionStartSource`
- `HookPayload`, `Session`, `SessionStatus`, `Turn`, `ToolCall`, `WorkspaceEntry`
- `SummaryResult`, `ToolsResult`, `SessionsAnalyticsResult`, `PatternsResult`
- `QueryResult`, `IngestResult`, `BatchResult`, `BatchOptions`, `IngestOptions`
- `FilterOptions`, `WhereClause`
- `TranscriptLine`, `TranscriptToolUse`, `TranscriptToolResult`, `TranscriptUsage`, `ParsedTurn`

## Design Principles

1. **Additive only** — no existing behavior changes, no breaking the CLI
2. **Re-export, don't rewrite** — the functions already exist and are tested
3. **Types are the API docs** — every public function has typed params and returns
4. **Database handle is caller's responsibility** — library doesn't manage lifecycle
5. **No CLI dependencies in library path** — library imports never pull in commander/chalk
6. **ESM-only** — no CJS entry point; primary consumer is Electron (ESM)
7. **Minimal runtime dependencies** — only `better-sqlite3`; chalk/commander are devDependencies (bundled into CLI binary by esbuild)

## Test Strategy

Tests are organized by responsibility:

- **Phase 1** (`src/index.test.ts`): Contract test — verifies every function and
  type is importable from the barrel file. Catches missing/broken re-exports.
- **Phase 3** (`src/library-analytics.test.ts`, `src/library-lifecycle.test.ts`):
  Behavioral parity tests — exercises the library API against the same scenarios
  as the existing CLI tests to verify identical results.
- **Phase 3** (`src/library-e2e.test.ts`): End-to-end artifact test — imports from
  the built `dist/index.js` (not source), runs a full workflow, and verifies the
  bundle doesn't contain CLI dependencies, has declarations, and has a sourcemap.
  Run via `npm run test:e2e` (chains build + test) to avoid stale artifacts.

## Related

- [approach.md](./approach.md) — packaging and build strategy
- [../implementation/phase-1.md](../implementation/phase-1.md) — core library exports
- [../implementation/phase-2.md](../implementation/phase-2.md) — build and packaging
- [../implementation/phase-3.md](../implementation/phase-3.md) — integration and e2e tests
