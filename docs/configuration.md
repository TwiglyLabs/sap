# Configuration

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `SAP_DB_PATH` | `~/.sap/sap.db` | Path to the SQLite database file |

The database directory is created automatically on first use. To use a non-default path:

```bash
export SAP_DB_PATH=/custom/path/sap.db
sap status
```

The `:memory:` value is supported for testing:

```typescript
const sap = createSap({ dbPath: ':memory:' });
```

## Hook setup

SAP records events via Claude Code hooks. Add the following to your Claude Code settings (e.g., `~/.claude/settings.json` or `.claude/settings.json` in your project):

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "sap record --event session-start", "timeout": 5000 }]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "sap record --event session-end", "timeout": 5000 }]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "sap record --event turn-complete", "timeout": 5000 }]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [{ "type": "command", "command": "sap record --event attention-permission", "timeout": 5000 }]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [{ "type": "command", "command": "sap record --event attention-idle", "timeout": 5000 }]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "sap record --event user-prompt", "timeout": 5000 }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{ "type": "command", "command": "sap record --event tool-use", "timeout": 5000 }]
      }
    ]
  }
}
```

A copy of this configuration is also included in the repository at `hooks.example.json`.

Each hook fires automatically during a Claude Code session, piping a JSON payload to `sap record` via stdin. SAP reads `session_id` and `cwd` from the payload to identify the session and resolve the workspace.

## Library options

When using SAP as a library, options are passed to `createSap()`:

```typescript
import { createSap } from '@twiglylabs/sap';

const sap = createSap({
  dbPath: '/custom/path/sap.db',  // overrides SAP_DB_PATH
  logger: myLogger,               // optional; no-op logger used if omitted
});
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `dbPath` | `string` | `~/.sap/sap.db` | SQLite database path. Use `':memory:'` for tests. Overrides `SAP_DB_PATH`. |
| `logger` | `Logger` | no-op | Optional `@twiglylabs/log`-compatible logger. |

## Subpath imports

Individual feature modules are available as subpath imports for advanced use cases where you do not need the full `createSap` factory:

```typescript
import { SessionService } from '@twiglylabs/sap/sessions';
import { AnalyticsService } from '@twiglylabs/sap/analytics';
import { IngestionService } from '@twiglylabs/sap/ingestion';
import { RecordingService } from '@twiglylabs/sap/recording';
import { WorkspaceService } from '@twiglylabs/sap/workspace';
```

Each subpath also exports the corresponding repository interface and feature-specific types.
