# SAP — Session Awareness Protocol

> Last verified: 2026-02-20

Session tracking and analytics for Claude Code. Records hook events, manages session lifecycle, parses transcripts, and runs usage analytics. SQLite-backed, ships as both a CLI (`sap`) and a library (`@twiglylabs/sap`).

## Architecture

```
src/
  index.ts              # Public API barrel — createSap + types only
  sap.ts                # Factory: createSap() wires repos → services
  cli.ts                # Commander.js entry point
  core/
    types.ts            # Domain types (Session, Turn, ToolCall, etc.)
    storage.ts          # SQLite schema, openDb(), DEFAULT_DB_PATH
    config.ts           # Constants (STALE_THRESHOLD_MS = 10 min)
    utils.ts            # ok/err Result constructors, parseDuration
  features/
    sessions/           # Session lifecycle (status, history, gc, sweep)
    recording/          # Hook event recording (stdin JSON → DB)
    workspace/          # Git workspace resolution & caching
    ingestion/          # Transcript JSONL parsing → turns/tool_calls
    analytics/          # Usage queries (summary, tools, sessions, patterns)
```

## Feature Folder Convention

Every feature follows the same 3-layer pattern:

```
features/{name}/
  {name}.repository.ts        # Abstract interface (data contract)
  {name}.service.ts            # Business logic (depends on repository)
  {name}.cli.ts                # CLI command handlers (optional)
  {name}.types.ts              # Feature-specific types (optional)
  index.ts                     # Public exports for subpath
  sqlite/
    {name}.repository.sqlite.ts  # SQLite implementation of repository
  __tests__/
    {name}.service.test.ts       # Unit tests
    {name}.repository.test.ts    # Repository tests
```

**Key rule:** Services depend on repository interfaces, never on SQLite implementations. The factory (`sap.ts`) is the only place that instantiates SQLite adapters.

## Repository Pattern & Storage Abstraction

Each feature defines a repository interface (e.g., `SessionRepository`) with pure data-access methods. The SQLite adapter class implements this interface using `better-sqlite3` prepared statements.

```
Interface (session.repository.ts)
  → defines getSession(), getActiveSessions(), etc.

SQLite adapter (sqlite/session.repository.sqlite.ts)
  → implements interface with SQL queries

Service (session.service.ts)
  → constructor(private repo: SessionRepository)
  → business logic only, no SQL knowledge
```

This means storage is fully decoupled — services can be tested with in-memory implementations and the storage backend could be swapped without touching business logic.

## createSap() Factory

`createSap(options?)` is the single entry point. It:
1. Opens the SQLite database (`options.dbPath` or `~/.sap/sap.db`)
2. Creates all repository SQLite adapters
3. Creates all services with injected repositories
4. Returns `{ sessions, workspace, recording, ingestion, analytics, close }`

The `Sap` interface exposes five services and a `close()` method. Consumers never touch repositories directly.

## Public API Surface

All public exports live in `src/index.ts`:
- `createSap` — factory function
- `Sap`, `SapOptions` — factory types
- `Result`, `ok`, `err` — discriminated union for fallible operations
- Domain types: `Session`, `SessionStatus`, `Turn`, `ToolCall`, `WorkspaceEntry`
- Union types: `SessionState`, `EventType`, `SessionStartSource`
- Payload interface: `HookPayload`
- Feature types: `StatusResult`, `GroupedStatusResult`, `SessionsQueryOptions`, `IngestResult`, `IngestOptions`, `BatchResult`, `BatchOptions`, `FilterOptions`, `SummaryResult`, `ToolsResult`, `SessionAnalytics`, `SessionsAnalyticsResult`, `PatternsResult`, `QueryResult`

Subpath exports (`@twiglylabs/sap/sessions`, etc.) expose service classes, repository interfaces, and feature-specific types for advanced consumers.

## Adding a New Feature

1. Create `src/features/{name}/`
2. Define `{name}.repository.ts` with an interface
3. Implement `sqlite/{name}.repository.sqlite.ts`
4. Create `{name}.service.ts` taking the repository in its constructor
5. Create `index.ts` exporting the service, repository type, and any feature types
6. Wire it in `sap.ts`: instantiate repo → service → add to return object
7. Add types to `src/index.ts` if they're part of the public API
8. Add subpath export to `package.json` `"exports"` field
9. Add CLI commands in `{name}.cli.ts` and register in `cli.ts`
10. Add tests in `__tests__/`

## Testing

- **Framework:** Vitest (v4)
- **Unit tests:** `src/features/*/__tests__/` — co-located with features
- **Integration tests:** `test/` — cross-feature lifecycle, CLI, e2e
- **Pattern:** `createSap({ dbPath: ':memory:' })` for isolated test databases

Key test files:
- `test/index.test.ts` — verifies public API exports
- `test/integration.test.ts` — full session lifecycle
- `test/cli.test.ts` — CLI contract tests (JSON envelopes, exit codes)
- `test/library-e2e.test.ts` — tests against built artifacts

## Commands

```bash
npm run build        # Dev build (esbuild → dist/)
npm run build:prod   # Minified production build
npm run test         # vitest run
npm run test:e2e     # Build + run e2e tests
npm run dev          # vitest watch mode
npm run lint         # tsc --noEmit (type check only)
```

## CLI Output Contract

All CLI commands that accept `--json` produce JSON envelopes to stdout. Errors go to stderr as `{ "error": "..." }` with exit code 2. The `query` command always outputs JSON.

## Database

SQLite via `better-sqlite3`. Default path: `~/.sap/sap.db` (override with `SAP_DB_PATH`).

Tables: `sessions`, `events`, `workspaces`, `turns`, `tool_calls`.

WAL mode, 3s busy timeout, foreign keys enabled. Schema auto-creates on `openDb()`.

## Dependencies

- **Runtime:** `better-sqlite3` only
- **Dev:** `commander`, `chalk`, `esbuild`, `typescript`, `vitest`
- **Node:** >=20
