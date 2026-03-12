# CLI Reference

All commands are invoked as `sap <command> [options]`.

Exit codes: `0` success, `2` invalid input or processing error.

Commands that accept `--json` write a JSON envelope to stdout. Errors always go to stderr as `{ "error": "..." }` with exit code `2`. The `query` command always outputs JSON.

---

## record

Record a hook event from Claude Code. Reads a JSON payload from stdin.

```
sap record --event <type>
```

**Required flag:** `--event <type>`

**Event types:**

| Type | Trigger | Session state after |
|------|---------|-------------------|
| `session-start` | Claude Code session created or resumed | `active` |
| `session-end` | Session finished | `stopped` |
| `turn-complete` | Agent turn finished, waiting for next prompt | `idle` |
| `attention-permission` | Waiting for user to approve a permission request | `attention` |
| `attention-idle` | Idle and awaiting user input | `attention` |
| `user-prompt` | User submitted a new prompt | `active` |
| `tool-use` | Tool invocation completed | `active` |

**Required JSON fields:** `session_id`, `cwd`.

**Example:**

```bash
echo '{"session_id":"abc","cwd":"/repo"}' | sap record --event session-start
```

**Source values for `session-start`:** `startup` (new session), `resume` (session resumed), `clear` (`/clear` command), `compact` (`/compact` command).

---

## status

Show all non-stopped sessions and their current state.

```
sap status [--workspace <name>] [--group] [--json]
```

| Flag | Description |
|------|-------------|
| `--workspace <name>` | Filter by workspace (e.g. `"repo:branch"`) |
| `--group` | Group sessions by workspace in output |
| `--json` | Output as JSON |

**Flat JSON output (default):**
```json
{ "sessions": [{ "session_id": "...", "workspace": "...", "state": "active", "stale": false }] }
```

**Grouped JSON output (`--group`):**
```json
{ "workspaces": { "repo:branch": [...sessions] } }
```

A session is marked `stale: true` when its last event is older than 10 minutes, indicating it may have disconnected without sending `session-end`.

---

## latest

Show the most recent session for a given workspace.

```
sap latest --workspace <name> [--json]
```

| Flag | Description |
|------|-------------|
| `--workspace <name>` | Workspace name (required) |
| `--json` | Output as JSON |

Returns the full session object or `null` if no sessions exist for the workspace.

**Session fields:** `session_id`, `workspace`, `cwd`, `state`, `started_at`, `ended_at`, `last_event_at`, `last_tool`, `last_tool_detail`, `transcript_path`.

**Example:**

```bash
sap latest --workspace myrepo:main --json
```

---

## sessions

Show session history across all workspaces.

```
sap sessions [--workspace <name>] [--limit <n>] [--json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--workspace <name>` | — | Filter by workspace |
| `--limit <n>` | `20` | Number of sessions to return |
| `--json` | — | Output as JSON |

Returns sessions ordered by `started_at` descending (most recent first).

**JSON output:**
```json
{ "sessions": [{ "session_id": "...", "workspace": "...", "state": "stopped", "started_at": 1234567890 }] }
```

**Examples:**

```bash
sap sessions --limit 5 --json
sap sessions --workspace myrepo:main
```

---

## gc

Delete old sessions and their associated events.

```
sap gc [--older-than <duration>] [--json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--older-than <duration>` | `30d` | Delete sessions older than this threshold |
| `--json` | — | Output as JSON |

Removes stopped sessions with `ended_at` older than the threshold, and non-stopped sessions with `last_event_at` older than the threshold. Cascading deletes remove associated `events`, `turns`, and `tool_calls` records.

**Duration format:** `Nd` (e.g. `30d` = 30 days, `7d` = 7 days).

**JSON output:** `{ "deleted": N }`

**Example:**

```bash
sap gc --older-than 7d --json
```

---

## sweep

Mark stale sessions as stopped.

```
sap sweep [--threshold <duration>] [--json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--threshold <duration>` | `10m` | Staleness threshold |
| `--json` | — | Output as JSON |

Transitions any non-stopped session whose `last_event_at` is older than the threshold to the `stopped` state. Useful for cleaning up sessions that disconnected without sending `session-end`.

**Duration format:** `Nm` (e.g. `10m` = 10 minutes, `30m` = 30 minutes).

**JSON output:** `{ "swept": N }`

**Example:**

```bash
sap sweep --threshold 30m --json
```

---

## ingest

Parse transcript files and populate analytics tables (`turns`, `tool_calls`).

```
sap ingest [--session <id>] [--since <duration>] [--force] [--json]
```

| Flag | Description |
|------|-------------|
| `--session <id>` | Ingest a specific session by ID |
| `--since <duration>` | Only ingest sessions from this period (e.g. `7d`, `24h`) |
| `--force` | Re-ingest already-processed sessions |
| `--json` | Output as JSON |

Reads the JSONL transcript files referenced by sessions and extracts turn-level data: token usage, tool calls, prompt text, durations. Already-ingested sessions are skipped unless `--force` is used.

Maximum transcript size: 50MB per file.

**JSON output:**
```json
{ "ingested": 5, "skipped": 3, "errors": [] }
```

**Examples:**

```bash
sap ingest --since 7d
sap ingest --session abc123 --force
sap ingest --json
```

---

## query

Execute a read-only SQL query against the SAP database.

```
sap query "<sql>"
```

Returns results as a JSON array of row objects. Write statements (`INSERT`, `UPDATE`, `DELETE`, etc.) are rejected.

**Available tables:** `sessions`, `events`, `workspaces`, `turns`, `tool_calls`.

Always outputs JSON. No `--json` flag required.

**Examples:**

```bash
sap query "SELECT tool_name, count(*) as n FROM tool_calls GROUP BY tool_name ORDER BY n DESC"

sap query "SELECT workspace, sum(output_tokens) FROM turns t JOIN sessions s ON t.session_id = s.session_id GROUP BY workspace"
```

---

## analytics summary

High-level usage summary over a time window.

```
sap analytics summary [--since <duration>] [--workspace <name>] [--json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--since <duration>` | `7d` | Time window (e.g. `7d`, `30d`) |
| `--workspace <name>` | — | Filter by workspace |
| `--json` | — | Output as JSON |

Returns session counts, average turns and duration, token totals (input, output, cache read/write), averages per session and per turn, and top tools by call count with success rates.

---

## analytics tools

Per-tool usage breakdown with common sequences.

```
sap analytics tools [--since <duration>] [--workspace <name>] [--json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--since <duration>` | `7d` | Time window |
| `--workspace <name>` | — | Filter by workspace |
| `--json` | — | Output as JSON |

Returns per-tool call counts, success rates, error counts, top error messages, workspace distribution, and common tool call sequences.

---

## analytics sessions

Per-session metrics for comparing efficiency.

```
sap analytics sessions [--since <duration>] [--workspace <name>] [--limit <n>] [--json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--since <duration>` | `7d` | Time window |
| `--workspace <name>` | — | Filter by workspace |
| `--limit <n>` | `20` | Number of sessions to return |
| `--json` | — | Output as JSON |

Returns per-session: duration, turn count, tool call count, token usage, error count and rate, and outcome indicators (committed, tests passed).

---

## analytics patterns

Detect workflow anti-patterns and outlier sessions.

```
sap analytics patterns [--since <duration>] [--workspace <name>] [--json]
```

| Flag | Default | Description |
|------|---------|-------------|
| `--since <duration>` | `7d` | Time window |
| `--workspace <name>` | — | Filter by workspace |
| `--json` | — | Output as JSON |

Returns detected anti-patterns (with frequency and affected session counts) and outlier sessions (with the reason and outlier value). Useful for identifying where agent workflows are inefficient or going wrong.
