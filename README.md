# SAP — Session Awareness Protocol

Status tracking and analytics for Claude Code sessions. SAP records hook events from Claude Code, manages session lifecycle (active/idle/attention/stopped), parses JSONL transcripts for turn-level data, and provides usage analytics — all backed by a local SQLite database.

## Installation

```bash
npm install @twiglylabs/sap
```

Requires Node.js >= 20.

## Quick Start (Library)

```typescript
import { createSap } from '@twiglylabs/sap';

const sap = createSap();

// Check active sessions
const { sessions } = sap.sessions.status();
console.log(sessions); // [{ session_id, workspace, state, stale, ... }]

// Get session history
const history = sap.sessions.sessions({ limit: 10 });

// Run analytics
const summary = sap.analytics.summary({ sinceMs: 7 * 86400 * 1000 });
console.log(summary.tokens.total_output);

// Raw SQL queries
const { rows } = sap.analytics.executeQuery(
  'SELECT tool_name, count(*) as n FROM tool_calls GROUP BY tool_name ORDER BY n DESC'
);

sap.close();
```

## Quick Start (CLI)

```bash
# Record a hook event (reads JSON from stdin)
echo '{"session_id":"abc","cwd":"/repo"}' | sap record --event session-start

# Check active sessions
sap status --json
sap status --group --workspace myrepo:main

# Session history
sap sessions --limit 5 --json

# Ingest transcripts for analytics
sap ingest --since 7d
sap ingest --session abc123 --force

# Analytics
sap analytics summary --since 7d
sap analytics tools --workspace myrepo:main
sap analytics sessions --since 30d --limit 10
sap analytics patterns --since 7d

# Maintenance
sap sweep --threshold 30m    # Mark stale sessions as stopped
sap gc --older-than 7d       # Delete old sessions

# Raw SQL
sap query "SELECT workspace, count(*) FROM sessions GROUP BY workspace"
```

## CLI Reference

| Command | Description | Key Flags |
|---------|-------------|-----------|
| `record` | Record a hook event from stdin JSON | `--event <type>` (required) |
| `status` | Show active sessions | `--workspace`, `--group`, `--json` |
| `latest` | Most recent session in a workspace | `--workspace` (required), `--json` |
| `sessions` | Session history | `--workspace`, `--limit` (default: 20), `--json` |
| `gc` | Delete old sessions | `--older-than` (default: 30d), `--json` |
| `sweep` | Mark stale sessions as stopped | `--threshold` (default: 10m), `--json` |
| `ingest` | Parse transcripts into turns/tool_calls | `--session`, `--since`, `--force`, `--json` |
| `query` | Execute read-only SQL | takes SQL as argument |
| `analytics summary` | Usage summary | `--since` (default: 7d), `--workspace`, `--json` |
| `analytics tools` | Per-tool breakdown | `--since`, `--workspace`, `--json` |
| `analytics sessions` | Per-session metrics | `--since`, `--workspace`, `--limit`, `--json` |
| `analytics patterns` | Anti-patterns & outliers | `--since`, `--workspace`, `--json` |

Event types for `record`: `session-start`, `session-end`, `turn-complete`, `attention-permission`, `attention-idle`, `user-prompt`, `tool-use`.

Exit codes: `0` success, `2` invalid input or processing error.

## Library API

### `createSap(options?)`

Creates and returns a `Sap` instance with all services wired up.

```typescript
import { createSap, type Sap, type SapOptions } from '@twiglylabs/sap';

const sap: Sap = createSap({ dbPath: '/custom/path.db' });
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbPath` | `string` | `~/.sap/sap.db` | SQLite database path (`:memory:` for tests) |

### Services

The `Sap` object exposes five services:

**`sap.sessions`** — Session lifecycle and queries

```typescript
sap.sessions.status(workspace?)          // → StatusResult
sap.sessions.statusGrouped(workspace?)   // → GroupedStatusResult
sap.sessions.latest(workspace)           // → Session | null
sap.sessions.sessions({ workspace?, limit })  // → Session[]
sap.sessions.gc(olderThanMs)             // → number (deleted count)
sap.sessions.sweep(thresholdMs)          // → number (swept count)
```

**`sap.recording`** — Hook event recording

```typescript
sap.recording.recordEvent(eventType, data)  // → void
```

**`sap.workspace`** — Git workspace resolution

```typescript
sap.workspace.resolveWorkspace(cwd, forceResolve)  // → string ("repo:branch")
```

**`sap.ingestion`** — Transcript parsing

```typescript
sap.ingestion.ingestSession(sessionId, options?)  // → Result<IngestResult>
sap.ingestion.ingestBatch(options)                // → BatchResult
```

**`sap.analytics`** — Usage analytics

```typescript
sap.analytics.summary(filters)                     // → SummaryResult
sap.analytics.tools(filters)                       // → ToolsResult
sap.analytics.sessionsAnalytics(filters, limit?)   // → SessionsAnalyticsResult
sap.analytics.patterns(filters)                    // → PatternsResult
sap.analytics.executeQuery(sql)                    // → QueryResult
```

### Result Type

Fallible operations return `Result<T>`, a discriminated union:

```typescript
import { type Result } from '@twiglylabs/sap';

const result = sap.ingestion.ingestSession('abc');
if (result.ok) {
  console.log(result.data.turns);  // number of turns ingested
} else {
  console.error(result.error);     // error message string
}
```

## Subpath Imports

For advanced use cases, individual feature modules are available:

```typescript
import { SessionService } from '@twiglylabs/sap/sessions';
import { AnalyticsService } from '@twiglylabs/sap/analytics';
import { IngestionService } from '@twiglylabs/sap/ingestion';
import { RecordingService } from '@twiglylabs/sap/recording';
import { WorkspaceService } from '@twiglylabs/sap/workspace';
```

Each subpath also exports the repository interface and feature-specific types.

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `SAP_DB_PATH` | `~/.sap/sap.db` | SQLite database file path |

The database is created automatically on first use. SAP uses WAL mode for concurrent reads.

## Database Tables

| Table | Purpose |
|-------|---------|
| `sessions` | Session records with state, workspace, timestamps |
| `events` | Raw hook events linked to sessions |
| `workspaces` | Git workspace resolution cache |
| `turns` | Parsed turn data (tokens, model, duration) |
| `tool_calls` | Tool invocations per turn with success/error status |

## License

Private — @twiglylabs
