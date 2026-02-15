# Schema: Analytics Tables

Last updated: 2026-02-14

## Existing Tables (unchanged)

- `workspaces` — cached git workspace resolution
- `sessions` — session lifecycle and state
- `events` — raw event log

## Schema Changes to Existing Tables

### `sessions` — add ingestion tracking

```sql
ALTER TABLE sessions ADD COLUMN ingested_at INTEGER;  -- NULL = not yet ingested
```

This lets `sap ingest` skip already-processed sessions and supports `--force` re-ingestion.

## New Tables

### `turns`

One row per assistant response cycle (user prompt → assistant response with tool calls).

```sql
CREATE TABLE turns (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id               TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_number              INTEGER NOT NULL,  -- ordinal within session (1, 2, 3...)
  prompt_text              TEXT,              -- what the user asked (NULL for system/meta turns)
  input_tokens             INTEGER,
  output_tokens            INTEGER,
  cache_read_tokens        INTEGER,
  cache_write_tokens       INTEGER,
  model                    TEXT,              -- model used for this turn
  tool_call_count          INTEGER NOT NULL DEFAULT 0,
  started_at               INTEGER,           -- timestamp of user message
  ended_at                 INTEGER,           -- timestamp of assistant response completion
  duration_ms              INTEGER            -- wall-clock time for the turn
);

CREATE INDEX idx_turns_session ON turns(session_id);
CREATE INDEX idx_turns_started ON turns(started_at);
```

### `tool_calls`

One row per tool invocation within a turn.

```sql
CREATE TABLE tool_calls (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_id             INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  tool_use_id         TEXT,                -- Claude's tool_use_id for correlating with results
  tool_name           TEXT NOT NULL,       -- Edit, Bash, Read, Task, etc.
  tool_input_summary  TEXT,               -- extracted context (filename, command, query)
  success             INTEGER,            -- 1=success, 0=error, NULL=unknown
  error_message       TEXT,               -- extracted error if success=0
  created_at          INTEGER NOT NULL
);

CREATE INDEX idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX idx_tool_calls_turn ON tool_calls(turn_id);
CREATE INDEX idx_tool_calls_name ON tool_calls(tool_name);
```

## Design Decisions

**No `messages` table.** Full assistant response text stays in the transcript JSONL. Storing it in SQLite would bloat the DB for marginal analytical value. The `prompt_text` in `turns` captures the most important content — what the user asked.

**`success` as INTEGER not BOOLEAN.** SQLite doesn't have a boolean type. 1/0/NULL maps to success/error/unknown. NULL is important because not all tool results clearly indicate success or failure.

**`tool_input_summary` not full input.** Tool inputs can be huge (full file contents for Write). We extract the useful signal: filename for Read/Edit/Write, command for Bash, pattern for Grep/Glob, query for WebSearch.

**Token fields on `turns` not `tool_calls`.** The transcript reports token usage per assistant response, not per tool call. Token cost of a tool call is embedded in the next turn's input_tokens (the tool result gets sent back as context).

**Cascade deletes.** Matches existing pattern — `sap gc` deletes sessions and everything cascades.
