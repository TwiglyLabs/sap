# Database Schema

SAP uses a single SQLite database (default: `~/.sap/sap.db`, override with `SAP_DB_PATH`). The schema is created automatically on first use via `openDb()`. WAL mode is enabled for concurrent reads; foreign keys are enforced with cascading deletes.

## Tables

### sessions

The primary record for each Claude Code session.

| Column | Type | Description |
|--------|------|-------------|
| `session_id` | `TEXT PRIMARY KEY` | Claude Code session identifier |
| `workspace` | `TEXT NOT NULL` | Resolved workspace string, e.g. `"repo:branch"` |
| `cwd` | `TEXT NOT NULL` | Working directory when the session started |
| `transcript_path` | `TEXT` | Path to the JSONL transcript file (nullable) |
| `state` | `TEXT NOT NULL` | Lifecycle state: `active`, `idle`, `attention`, or `stopped` |
| `started_at` | `INTEGER NOT NULL` | Unix timestamp (ms) when the session started |
| `ended_at` | `INTEGER` | Unix timestamp (ms) when the session ended (nullable) |
| `last_event_at` | `INTEGER NOT NULL` | Unix timestamp (ms) of the most recent event |
| `last_tool` | `TEXT` | Name of the most recently invoked tool (nullable) |
| `last_tool_detail` | `TEXT` | Summary of the most recent tool invocation (nullable) |
| `ingested_at` | `INTEGER` | Unix timestamp (ms) when the transcript was last ingested (nullable) |

**Indexes:** `idx_sessions_workspace`, `idx_sessions_state`

### events

Raw hook events linked to sessions.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Row identifier |
| `session_id` | `TEXT NOT NULL` | References `sessions(session_id)` (cascades on delete) |
| `event_type` | `TEXT NOT NULL` | One of the seven event types (see CLI reference) |
| `data` | `TEXT` | JSON blob with event-specific fields (nullable) |
| `created_at` | `INTEGER NOT NULL` | Unix timestamp (ms) |

**Indexes:** `idx_events_session`, `idx_events_type`

### workspaces

Cache for git workspace resolution (`cwd` → `"repo:branch"`).

| Column | Type | Description |
|--------|------|-------------|
| `cwd` | `TEXT PRIMARY KEY` | Working directory path |
| `repo_name` | `TEXT NOT NULL` | Git repository name (basename of repo root) |
| `branch` | `TEXT NOT NULL` | Current branch name, or `"detached"` / `"unknown"` |
| `workspace` | `TEXT NOT NULL` | Computed string `"repo_name:branch"` |
| `resolved_at` | `INTEGER NOT NULL` | Unix timestamp (ms) of last resolution |

### turns

Parsed turn data extracted from JSONL transcripts by `sap ingest`.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Row identifier |
| `session_id` | `TEXT NOT NULL` | References `sessions(session_id)` (cascades on delete) |
| `turn_number` | `INTEGER NOT NULL` | Sequential turn index within the session |
| `prompt_text` | `TEXT` | User prompt text for this turn (nullable) |
| `input_tokens` | `INTEGER` | Input token count (nullable) |
| `output_tokens` | `INTEGER` | Output token count (nullable) |
| `cache_read_tokens` | `INTEGER` | Cache read token count (nullable) |
| `cache_write_tokens` | `INTEGER` | Cache write token count (nullable) |
| `model` | `TEXT` | Model identifier used for this turn (nullable) |
| `tool_call_count` | `INTEGER NOT NULL` | Number of tool invocations in this turn |
| `started_at` | `INTEGER` | Unix timestamp (ms) when the turn started (nullable) |
| `ended_at` | `INTEGER` | Unix timestamp (ms) when the turn ended (nullable) |
| `duration_ms` | `INTEGER` | Turn duration in milliseconds (nullable) |

**Indexes:** `idx_turns_session`, `idx_turns_started`

### tool_calls

Individual tool invocations within turns.

| Column | Type | Description |
|--------|------|-------------|
| `id` | `INTEGER PRIMARY KEY AUTOINCREMENT` | Row identifier |
| `session_id` | `TEXT NOT NULL` | References `sessions(session_id)` (cascades on delete) |
| `turn_id` | `INTEGER NOT NULL` | References `turns(id)` (cascades on delete) |
| `tool_use_id` | `TEXT` | Claude's tool use identifier for correlating with results (nullable) |
| `tool_name` | `TEXT NOT NULL` | Name of the tool invoked |
| `tool_input_summary` | `TEXT` | Human-readable summary of key input fields (nullable) |
| `success` | `INTEGER` | `1` = succeeded, `0` = error, `NULL` = unknown |
| `error_message` | `TEXT` | First 500 characters of error output if failed (nullable) |
| `created_at` | `INTEGER NOT NULL` | Unix timestamp (ms) |

**Indexes:** `idx_tool_calls_session`, `idx_tool_calls_turn`, `idx_tool_calls_name`

## Database settings

```
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 3000;
PRAGMA foreign_keys = ON;
```

WAL mode allows concurrent readers while a writer is active. The 3-second busy timeout prevents immediate failures when the database is locked. Foreign key enforcement with `ON DELETE CASCADE` ensures that deleting a session removes all associated events, turns, and tool calls.

## Querying directly

Use `sap query` for ad-hoc read-only SQL against any of the above tables:

```bash
sap query "SELECT tool_name, count(*) as n, avg(success) as success_rate FROM tool_calls GROUP BY tool_name ORDER BY n DESC"

sap query "SELECT s.workspace, sum(t.output_tokens) as total_output FROM turns t JOIN sessions s ON t.session_id = s.session_id GROUP BY s.workspace ORDER BY total_output DESC"
```
