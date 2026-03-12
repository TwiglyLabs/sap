# SAP

Session analytics for Claude Code.

## What it does

SAP tracks what Claude Code actually does during a session — every tool call, token consumed, state transition, and moment waiting for the user. It records these events in a local SQLite database via Claude Code hooks and makes them queryable through a CLI or TypeScript library.

The problem it solves is visibility. When an AI agent is doing the work, it is easy to lose track of how that work is going: which tools are being called most, how long sessions run, where errors cluster, and whether the agent is efficient or spinning. SAP gives developers the data to answer those questions and tune their prompts and workflows accordingly.

After recording events during sessions, SAP can ingest the JSONL transcript files that Claude Code writes and extract turn-level detail: token counts by turn, tool call success and failure, prompt text, and timing. The analytics commands aggregate this data into summaries, per-tool breakdowns, per-session comparisons, and pattern detection.

## Key concepts

**Session** — A single Claude Code process run, identified by a `session_id`. Sessions transition through states: `active` (agent is working), `idle` (waiting for next prompt), `attention` (waiting for user approval or input), `stopped` (session ended). A session is considered stale when its last event is older than 10 minutes.

**Event** — A hook payload fired by Claude Code at a lifecycle moment: session start/end, turn complete, tool use, user prompt, attention notifications. Each event is stored in the `events` table linked to its session.

**Turn** — One agent response cycle, parsed from the JSONL transcript. Contains token usage (input, output, cache read/write), the model used, tool call count, and timing. Turns are populated by `sap ingest`.

**Tool call** — A single tool invocation within a turn, with the tool name, a summary of its input, and whether it succeeded or produced an error.

**Workspace** — A `"repo:branch"` identifier resolved from the working directory via git. Sessions are grouped and filtered by workspace.

## Quick start

Install the package:

```bash
npm install @twiglylabs/sap
```

Set up Claude Code hooks to record events automatically. Add the following to your Claude Code settings file (`~/.claude/settings.json` or `.claude/settings.json`):

```json
{
  "hooks": {
    "SessionStart": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "sap record --event session-start", "timeout": 5000 }] }],
    "SessionEnd": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "sap record --event session-end", "timeout": 5000 }] }],
    "Stop": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "sap record --event turn-complete", "timeout": 5000 }] }],
    "UserPromptSubmit": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "sap record --event user-prompt", "timeout": 5000 }] }],
    "PostToolUse": [{ "matcher": "*", "hooks": [{ "type": "command", "command": "sap record --event tool-use", "timeout": 5000 }] }],
    "Notification": [
      { "matcher": "permission_prompt", "hooks": [{ "type": "command", "command": "sap record --event attention-permission", "timeout": 5000 }] },
      { "matcher": "idle_prompt", "hooks": [{ "type": "command", "command": "sap record --event attention-idle", "timeout": 5000 }] }
    ]
  }
}
```

A complete example is in `hooks.example.json`. Once hooks are in place, check active sessions and run analytics:

```bash
sap status --json
sap ingest --since 7d
sap analytics summary --since 7d
```

## How it works

Claude Code fires hook events at key lifecycle moments. Each hook pipes a JSON payload to `sap record --event <type>` via stdin. SAP parses the payload, resolves the working directory to a `"repo:branch"` workspace via git, and writes the session state and event to SQLite.

To get turn-level analytics (token counts, tool call details), run `sap ingest`. This reads the JSONL transcript files that Claude Code writes during sessions, parses them into structured turn and tool call records, and stores them in the `turns` and `tool_calls` tables. Once ingested, the `sap analytics` commands have the data they need.

The library API exposes the same functionality through `createSap()`, which returns five services wired to a shared SQLite connection.

## CLI reference

| Command | Description |
|---------|-------------|
| `sap record --event <type>` | Record a hook event from stdin JSON |
| `sap status` | Show all non-stopped sessions |
| `sap latest --workspace <name>` | Most recent session for a workspace |
| `sap sessions` | Session history |
| `sap gc` | Delete old sessions |
| `sap sweep` | Mark stale sessions as stopped |
| `sap ingest` | Parse transcripts into turns and tool calls |
| `sap query "<sql>"` | Execute read-only SQL against the database |
| `sap analytics summary` | Token totals, session counts, top tools |
| `sap analytics tools` | Per-tool breakdown with success rates and sequences |
| `sap analytics sessions` | Per-session metrics for comparing efficiency |
| `sap analytics patterns` | Detect anti-patterns and outlier sessions |

See [docs/cli-reference.md](docs/cli-reference.md) for full flag documentation.

## Library API

`createSap(options?)` opens the database and returns a `Sap` object with five services:

```typescript
import { createSap } from '@twiglylabs/sap';

const sap = createSap();

const { sessions } = sap.sessions.status();
const summary = sap.analytics.summary({ sinceMs: 7 * 86400 * 1000 });
const { rows } = sap.analytics.executeQuery('SELECT tool_name, count(*) as n FROM tool_calls GROUP BY tool_name ORDER BY n DESC');

sap.close();
```

| Service | Responsibility |
|---------|----------------|
| `sap.sessions` | Session lifecycle: status, history, gc, sweep |
| `sap.recording` | Record hook events from Claude Code |
| `sap.workspace` | Resolve working directories to workspace identifiers |
| `sap.ingestion` | Parse JSONL transcripts into turns and tool calls |
| `sap.analytics` | Aggregated usage queries and raw SQL |

See [docs/architecture.md](docs/architecture.md) for the full service API and library design.

## Documentation

- [Architecture](docs/architecture.md)
- [CLI Reference](docs/cli-reference.md)
- [Configuration](docs/configuration.md)
- [Database Schema](docs/database-schema.md)
- [Development](docs/development.md)

## Part of the TwiglyLabs toolchain

SAP is one of five tools built to enable AI-driven software development:

| Tool | Role |
|------|------|
| [Canopy](https://github.com/twiglylabs/canopy) | Workspace dashboard |
| [Trellis](https://github.com/twiglylabs/trellis) | Plan management |
| [Grove](https://github.com/twiglylabs/grove) | Local environments |
| [Bark](https://github.com/twiglylabs/bark) | Quality gates |
| [SAP](https://github.com/twiglylabs/sap) | Session analytics |

Each tool works independently but they compose into a complete workflow.
