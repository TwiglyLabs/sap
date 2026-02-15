# sap — Approach

Last updated: 2026-02-14

## CLI Commands

### `sap record --event <type>`

Called by Claude Code hooks. Reads hook JSON payload from stdin.

**Input (stdin):**
```json
{
  "session_id": "abc123",
  "cwd": "/Users/you/repos/dotfiles",
  "transcript_path": "/path/to/transcript.jsonl",
  "tool_name": "Edit",           // PostToolUse only
  "tool_input": {"file_path": "..."} // PostToolUse only
}
```

**Event types:**
- `session-start` — creates session row, sets state to `active`
- `session-stop` — sets state to `stopped`, records `ended_at`
- `attention-permission` — sets state to `attention`
- `attention-idle` — sets state to `attention`
- `user-prompt` — sets state to `active` (user responded, clears attention)
- `tool-use` — sets state to `active`, records tool name/detail

**Behavior:**
1. Parse stdin JSON
2. Resolve cwd → workspace (see [workspace-inference.md](./workspace-inference.md))
3. On `session-start`: insert session row
4. On other events: update session state, insert event row
5. Exit 0 on success, exit 2 on error (stderr fed back to Claude)

### `sap status [--workspace <name>] --json`

Returns current state of active/attention sessions.

**Output:**
```json
{
  "sessions": [
    {
      "session_id": "abc123",
      "workspace": "dotfiles:main",
      "state": "active",
      "started_at": 1707900000,
      "last_event_at": 1707900120,
      "last_tool": "Edit",
      "last_tool_detail": "src/app.ts"
    }
  ]
}
```

Without `--workspace`: returns all non-stopped sessions.
With `--workspace`: returns session for that workspace (or empty if none active).

### `sap latest --workspace <name> --json`

Returns the most recent session for a workspace, regardless of state. Primary use: resume capability.

**Output:**
```json
{
  "session_id": "abc123",
  "workspace": "dotfiles:main",
  "state": "stopped",
  "started_at": 1707900000,
  "ended_at": 1707900500,
  "transcript_path": "/path/to/transcript.jsonl"
}
```

### `sap sessions [--workspace <name>] [--limit N] --json`

Session history. Returns most recent N sessions (default 20).

### `sap gc [--older-than 30d]`

Prune old events and stopped sessions. Default: 30 days.

## SQLite Schema

Database location: `~/.sap/sap.db`

```sql
CREATE TABLE workspaces (
  cwd         TEXT PRIMARY KEY,
  repo_name   TEXT NOT NULL,
  branch      TEXT NOT NULL,
  workspace   TEXT NOT NULL,  -- "repo:branch"
  resolved_at INTEGER NOT NULL
);

CREATE TABLE sessions (
  session_id      TEXT PRIMARY KEY,
  workspace       TEXT NOT NULL,
  cwd             TEXT NOT NULL,
  transcript_path TEXT,
  state           TEXT NOT NULL DEFAULT 'active',
  started_at      INTEGER NOT NULL,
  ended_at        INTEGER,
  last_event_at   INTEGER NOT NULL
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(session_id),
  event_type  TEXT NOT NULL,
  data        TEXT,  -- JSON blob
  created_at  INTEGER NOT NULL
);

CREATE INDEX idx_sessions_workspace ON sessions(workspace);
CREATE INDEX idx_sessions_state ON sessions(state);
CREATE INDEX idx_events_session ON events(session_id);
CREATE INDEX idx_events_type ON events(event_type);
```

## State Machine

Session state transitions based on event type:

```
session-start        → active
tool-use             → active
user-prompt          → active
attention-permission → attention
attention-idle       → attention
session-stop         → stopped
```

Latest event wins. The state column on sessions is always the result of the most recent event.

## Technology

- **Runtime:** Node.js (consistent with grove, trellis)
- **Database:** better-sqlite3 (synchronous API, WAL mode for concurrent writes)
- **CLI framework:** yargs or commander (TBD based on grove/trellis patterns)
- **Output:** JSON to stdout (consistent with grove --json pattern)
- **Package:** @twiglylabs/sap (npm, consistent with grove)

## Concurrency

- SQLite WAL mode allows concurrent readers and writers
- Hook invocations are short-lived processes — write event, exit
- `sap record` acquires a write lock briefly; concurrent hooks may queue but won't fail
- `sap status` is read-only, never blocks
