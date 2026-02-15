# Query & Analytics Commands

Last updated: 2026-02-14

## `sap query`

Raw SQL access to the database. The primary tool Claude uses for ad-hoc analysis.

```
sap query "SELECT tool_name, count(*) as n FROM tool_calls GROUP BY tool_name ORDER BY n DESC"
sap query "SELECT workspace, sum(output_tokens) FROM turns t JOIN sessions s ON t.session_id = s.session_id GROUP BY workspace"
```

### Behavior

- Accepts a single SQL string argument
- Returns JSON array of result rows: `[{"tool_name": "Edit", "n": 142}, ...]`
- **Read-only enforcement**: rejects statements starting with INSERT, UPDATE, DELETE, DROP, ALTER, CREATE. Opens connection in read-only mode as additional guard.
- No pagination — Claude can add LIMIT if needed
- Errors return JSON: `{"error": "message"}`

### Why Raw SQL

Claude is excellent at writing SQL. The schema is small (5 tables). Raw SQL gives Claude full analytical power — window functions, CTEs, subqueries, JSON operators — without us having to anticipate every possible analysis. The convenience commands below are just starting points.

## `sap analytics summary`

High-level dashboard of usage over a time window.

```
sap analytics summary [--since 7d] [--workspace NAME] [--json]
```

### Output (JSON)

```json
{
  "period": { "since": "2026-02-07T00:00:00Z", "until": "2026-02-14T00:00:00Z" },
  "sessions": {
    "total": 45,
    "avg_duration_min": 23.5,
    "avg_turns": 12,
    "by_workspace": [
      { "workspace": "sap:analytics", "count": 12 },
      { "workspace": "myapp:main", "count": 8 }
    ]
  },
  "tokens": {
    "total_input": 2450000,
    "total_output": 890000,
    "total_cache_read": 1200000,
    "total_cache_write": 340000,
    "avg_per_session": { "input": 54444, "output": 19778 },
    "avg_per_turn": { "input": 4537, "output": 1648 }
  },
  "tools": {
    "total_calls": 1823,
    "top": [
      { "tool": "Read", "count": 412, "success_rate": 0.98 },
      { "tool": "Edit", "count": 389, "success_rate": 0.91 },
      { "tool": "Bash", "count": 301, "success_rate": 0.85 }
    ]
  }
}
```

## `sap analytics tools`

Per-tool breakdown.

```
sap analytics tools [--since 7d] [--workspace NAME] [--json]
```

### Output (JSON)

```json
{
  "tools": [
    {
      "tool": "Edit",
      "count": 389,
      "success_rate": 0.91,
      "error_count": 35,
      "top_errors": ["old_string not found", "file not found"],
      "workspaces": [
        { "workspace": "sap:analytics", "count": 89 },
        { "workspace": "myapp:main", "count": 67 }
      ]
    }
  ],
  "sequences": [
    { "sequence": ["Read", "Edit"], "count": 145 },
    { "sequence": ["Grep", "Read", "Edit"], "count": 89 },
    { "sequence": ["Bash", "Bash"], "count": 67 }
  ]
}
```

The `sequences` field shows common tool pairs/triples — what tool typically follows what. Computed from tool_calls ordered by created_at within a turn.

## `sap analytics sessions`

Per-session metrics for comparing session efficiency.

```
sap analytics sessions [--since 7d] [--workspace NAME] [--limit 20] [--json]
```

### Output (JSON)

```json
{
  "sessions": [
    {
      "session_id": "abc123",
      "workspace": "sap:analytics",
      "started_at": "2026-02-14T10:00:00Z",
      "duration_min": 35.2,
      "turns": 18,
      "tool_calls": 42,
      "input_tokens": 85000,
      "output_tokens": 32000,
      "cache_read_tokens": 45000,
      "error_count": 3,
      "error_rate": 0.07,
      "outcome": {
        "committed": true,
        "tests_passed": true
      }
    }
  ]
}
```

## `sap analytics patterns`

Pattern detection across sessions.

```
sap analytics patterns [--since 7d] [--workspace NAME] [--json]
```

### Output (JSON)

```json
{
  "workflow_patterns": [
    {
      "pattern": "read-edit-test",
      "description": "Read file, edit, run tests",
      "frequency": 23,
      "avg_success_rate": 0.92
    }
  ],
  "anti_patterns": [
    {
      "pattern": "edit-retry",
      "description": "Edit failures followed by retry (old_string mismatch)",
      "frequency": 15,
      "sessions_affected": 8
    },
    {
      "pattern": "permission-stall",
      "description": "Permission prompts causing >2min delays",
      "frequency": 12,
      "total_time_lost_min": 28.5
    }
  ],
  "outlier_sessions": [
    {
      "session_id": "xyz789",
      "workspace": "myapp:main",
      "reason": "Token usage 3x average",
      "input_tokens": 250000
    }
  ]
}
```

## Common Filters

All analytics commands support:
- `--since DURATION` — Time window (7d, 30d, 24h). Default: 7d.
- `--workspace NAME` — Filter to specific workspace (repo:branch).
- `--json` — JSON output (default for `sap query`, optional for analytics commands).

## Human-Readable Output

Analytics commands without `--json` render formatted tables/summaries with color coding. This is secondary — the primary consumer is Claude via JSON.
