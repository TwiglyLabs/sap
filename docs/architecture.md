# Architecture

SAP is organized around a feature-folder convention with a consistent three-layer pattern inside each feature. A single factory function (`createSap`) wires everything together.

## Source layout

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

## Feature folder convention

Every feature follows the same three-layer pattern:

```
features/{name}/
  {name}.repository.ts           # Abstract interface (data contract)
  {name}.service.ts              # Business logic (depends on repository)
  {name}.cli.ts                  # CLI command handlers (optional)
  {name}.types.ts                # Feature-specific types (optional)
  index.ts                       # Public exports for subpath
  sqlite/
    {name}.repository.sqlite.ts  # SQLite implementation of repository
  __tests__/
    {name}.service.test.ts       # Unit tests
    {name}.repository.test.ts    # Repository tests
```

## Repository pattern

Each feature defines a repository interface (e.g., `SessionRepository`) that describes pure data-access methods. The SQLite adapter class implements this interface using `better-sqlite3` prepared statements.

```
Interface (session.repository.ts)
  → defines getSession(), getActiveSessions(), etc.

SQLite adapter (sqlite/session.repository.sqlite.ts)
  → implements interface with SQL queries

Service (session.service.ts)
  → constructor(private repo: SessionRepository)
  → business logic only, no SQL knowledge
```

**Key rule:** Services depend on repository interfaces, never on SQLite implementations. The factory (`sap.ts`) is the only place that instantiates SQLite adapters. This means storage is fully decoupled — services can be tested with in-memory implementations and the storage backend can be swapped without touching business logic.

## createSap() factory

`createSap(options?)` is the single entry point for library consumers. It:

1. Opens the SQLite database (`options.dbPath` or `~/.sap/sap.db`)
2. Creates all repository SQLite adapters
3. Creates all services with injected repositories
4. Returns `{ sessions, workspace, recording, ingestion, analytics, close }`

The `Sap` interface exposes five services and a `close()` method. Consumers never touch repositories directly.

```typescript
import { createSap } from '@twiglylabs/sap';

const sap = createSap({ dbPath: ':memory:' }); // ':memory:' for tests
sap.sessions.status();
sap.analytics.summary({ sinceMs: 7 * 86400 * 1000 });
sap.close();
```

## The five services

| Service | Responsibility |
|---------|----------------|
| `sessions` | Session lifecycle: status queries, history, gc, sweep |
| `workspace` | Git workspace resolution (`cwd` → `"repo:branch"`) with caching |
| `recording` | Receives Claude Code hook events and writes session/event records |
| `ingestion` | Parses JSONL transcript files into `turns` and `tool_calls` records |
| `analytics` | Aggregated usage queries: summary, tools, per-session metrics, patterns |

## Public API surface

All public exports live in `src/index.ts`:

- `createSap` — factory function
- `Sap`, `SapOptions` — factory types
- `Result`, `ok`, `err` — discriminated union for fallible operations
- Domain types: `Session`, `SessionStatus`, `Turn`, `ToolCall`, `WorkspaceEntry`
- Union types: `SessionState`, `EventType`, `SessionStartSource`
- Payload interface: `HookPayload`
- Feature types: `StatusResult`, `GroupedStatusResult`, `SessionsQueryOptions`, `IngestResult`, `IngestOptions`, `BatchResult`, `BatchOptions`, `FilterOptions`, `SummaryResult`, `ToolsResult`, `SessionAnalytics`, `SessionsAnalyticsResult`, `PatternsResult`, `QueryResult`

Subpath exports (`@twiglylabs/sap/sessions`, etc.) expose service classes, repository interfaces, and feature-specific types for advanced consumers.

## Result type

Fallible operations return `Result<T>`, a discriminated union:

```typescript
type Result<T> = { ok: true; data: T } | { ok: false; error: string }
```

Check `.ok` before accessing `.data` or `.error`. Constructor helpers `ok(data)` and `err(message)` are exported from `src/core/utils.ts`.
