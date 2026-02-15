# sap — Approach

Last updated: 2026-02-14

## CLI Commands

### `sap record --event <type>`

Called by Claude Code hooks. Reads hook JSON payload from stdin.

**Input (stdin):**
All hook events include these common fields:
```json
{
  "session_id": "abc123",
  "cwd": "/Users/you/repos/dotfiles",
  "transcript_path": "/path/to/transcript.jsonl",
  "permission_mode": "default",
  "hook_event_name": "PostToolUse"
}
```

Event-specific fields are documented in [hooks.md](./hooks.md).

**Event types:**
- `session-start` — creates or resumes session row (see source handling below)
- `session-end` — sets state to `stopped`, records `ended_at`
- `turn-complete` — sets state to `idle` (Claude finished responding, awaiting user)
- `attention-permission` — sets state to `attention`
- `attention-idle` — sets state to `attention`
- `user-prompt` — sets state to `active` (user responded, clears attention/idle)
- `tool-use` — sets state to `active`, records tool name/detail

**`session-start` source handling:**

The `SessionStart` hook includes a `source` field. Behavior varies:

| Source | Behavior |
|--------|----------|
| `startup` | Insert new session row, state → `active` |
| `resume` | Upsert: if session_id exists, set state → `active` and update `last_event_at`. If not, insert new row. |
| `compact` | Record as event only. Do not create a new session. Update `last_event_at` on existing session. |
| `clear` | Insert new session row (new conversation context, treated as new session). |

**Behavior:**
1. Parse stdin JSON
2. Resolve cwd → workspace (see [workspace-inference.md](./workspace-inference.md))
3. On `session-start`: insert or update session row based on `source`
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
      "last_tool_detail": "src/app.ts",
      "stale": false
    }
  ]
}
```

Without `--workspace`: returns all non-stopped sessions.
With `--workspace`: returns session for that workspace (or empty if none active).

**Staleness detection:** Sessions with `last_event_at` older than 10 minutes are annotated with `"stale": true` in the output. This catches orphaned sessions where Claude Code exited without firing `SessionEnd` (crash, kill -9, terminal closed). The Emacs client should treat stale sessions as likely dead.

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

Prune old data. Default: 30 days.

**What gets deleted:**
- Sessions with `ended_at` older than the threshold (and their events)
- Sessions in non-stopped state with `last_event_at` older than the threshold (orphaned — and their events)
- Events for deleted sessions are cascade-deleted
- The workspaces cache table is not pruned (entries are small and useful)

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
  session_id       TEXT PRIMARY KEY,
  workspace        TEXT NOT NULL,
  cwd              TEXT NOT NULL,
  transcript_path  TEXT,
  state            TEXT NOT NULL DEFAULT 'active',  -- active, idle, attention, stopped
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  last_event_at    INTEGER NOT NULL,
  last_tool        TEXT,     -- most recent tool name (e.g. "Edit")
  last_tool_detail TEXT      -- extracted detail (e.g. "app.ts"), see Tool Detail Extraction
);

CREATE TABLE events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
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

Session states: `active`, `idle`, `attention`, `stopped`

Transitions based on event type:

```
session-start        → active
tool-use             → active
user-prompt          → active
turn-complete        → idle
attention-permission → attention
attention-idle       → attention
session-end          → stopped
```

Latest event wins. The state column on sessions is always the result of the most recent event.

**`stale` is not a state.** It is a computed annotation added by `sap status` when `last_event_at` is older than 10 minutes. The underlying state remains unchanged.

**Typical lifecycle:**
```
session-start → [tool-use]* → turn-complete → [user-prompt → [tool-use]* → turn-complete]* → session-end
                                                              ↑
                                            attention-permission/idle can interrupt at any point
```

## Technology

- **Runtime:** Node.js (consistent with grove, trellis)
- **Database:** better-sqlite3 (synchronous API, WAL mode for concurrent writes)
- **CLI framework:** yargs or commander (TBD based on grove/trellis patterns)
- **Output:** JSON to stdout (consistent with grove --json pattern)
- **Package:** @twiglylabs/sap (npm, consistent with grove)

## Tool Detail Extraction

`last_tool_detail` is derived from `tool_input` based on `tool_name`:

| Tool | Extraction | Example |
|------|-----------|---------|
| Edit, Write, Read | `tool_input.file_path` (basename only) | `app.ts` |
| Glob | `tool_input.pattern` | `**/*.ts` |
| Grep | `tool_input.pattern` | `function\\s+\\w+` |
| Bash | `tool_input.command` (first 80 chars) | `npm test` |
| Task | `tool_input.description` | `Run tests` |
| WebFetch | URL hostname | `docs.example.com` |
| WebSearch | `tool_input.query` (first 80 chars) | `react hooks api` |
| Other / missing | `null` | |

Extraction is best-effort. If the field is missing or the tool is unrecognized, `last_tool_detail` is `null`.

## Concurrency

- SQLite WAL mode allows concurrent readers and writers
- Hook invocations are short-lived processes — write event, exit
- `sap record` acquires a write lock briefly; concurrent hooks may queue but won't fail
- `sap status` is read-only, never blocks
