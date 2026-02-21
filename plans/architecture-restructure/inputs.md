
## Export Mapping
Complete mapping of all 74 current exports to their target location in the new structure.

### core/

| Current Export | Current Source | Target |
|---|---|---|
| `openDb` | `db.ts` | `core/storage.ts` |
| `DEFAULT_DB_PATH` | `db.ts` | `core/config.ts` |
| `parseDuration` | `commands/analytics-common.ts` | `core/utils.ts` (consolidated from 4 impls) |
| `SessionState` (type) | `types.ts` | `core/types.ts` |
| `EventType` (type) | `types.ts` | `core/types.ts` |
| `SessionStartSource` (type) | `types.ts` | `core/types.ts` |
| `HookPayload` (type) | `types.ts` | `core/types.ts` |
| `Session` (type) | `types.ts` | `core/types.ts` |
| `SessionStatus` (type) | `types.ts` | `core/types.ts` |
| `Turn` (type) | `types.ts` | `core/types.ts` |
| `ToolCall` (type) | `types.ts` | `core/types.ts` |
| `WorkspaceEntry` (type) | `types.ts` | `core/types.ts` |

### features/sessions/

| Current Export | Current Source | Target |
|---|---|---|
| `insertSession` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `upsertSession` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `getSession` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `updateSessionState` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `getActiveSessions` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `getLatestSession` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `getSessionHistory` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `markStaleSessions` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `deleteStaleSessions` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `insertEvent` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `getSessionEvents` | `db.ts` | `sqlite/session.repository.sqlite.ts` |
| `EventRow` (type) | `db.ts` | `session.types.ts` |
| `statusQuery` | `commands/status.ts` | `session.service.ts` |
| `statusQueryGrouped` | `commands/status.ts` | `session.service.ts` |
| `StatusResult` (type) | `commands/status.ts` | `session.types.ts` |
| `GroupedStatusResult` (type) | `commands/status.ts` | `session.types.ts` |
| `latestQuery` | `commands/latest.ts` | `session.service.ts` |
| `sessionsQuery` | `commands/sessions.ts` | `session.service.ts` |
| `SessionsQueryOptions` (type) | `commands/sessions.ts` | `session.types.ts` |
| `gcCommand` | `commands/gc.ts` | `session.service.ts` |
| `sweepCommand` | `commands/sweep.ts` | `session.service.ts` |
| `parseSweepThreshold` | `commands/sweep.ts` | **REMOVED** (replaced by consolidated `parseDuration` in core) |

### features/recording/

| Current Export | Current Source | Target |
|---|---|---|
| `recordEvent` | `commands/record.ts` | `recording.service.ts` |
| `parsePayload` | `commands/record.ts` | `recording.service.ts` |

### features/workspace/

| Current Export | Current Source | Target |
|---|---|---|
| `upsertWorkspace` | `db.ts` | `sqlite/workspace.repository.sqlite.ts` |
| `getCachedWorkspace` | `db.ts` | `sqlite/workspace.repository.sqlite.ts` |
| `resolveWorkspace` | `workspace.ts` | `workspace.service.ts` |
| `resolveWorkspaceFromGit` | `workspace.ts` | `workspace.service.ts` |

### features/ingestion/

| Current Export | Current Source | Target |
|---|---|---|
| `insertTurn` | `db.ts` | `sqlite/ingestion.repository.sqlite.ts` |
| `getSessionTurns` | `db.ts` | `sqlite/ingestion.repository.sqlite.ts` |
| `insertToolCall` | `db.ts` | `sqlite/ingestion.repository.sqlite.ts` |
| `getTurnToolCalls` | `db.ts` | `sqlite/ingestion.repository.sqlite.ts` |
| `ingestSession` | `commands/ingest.ts` | `ingestion.service.ts` |
| `ingestBatch` | `commands/ingest.ts` | `ingestion.service.ts` |
| `IngestResult` (type) | `commands/ingest.ts` | `ingestion.types.ts` |
| `IngestOptions` (type) | `commands/ingest.ts` | `ingestion.types.ts` |
| `BatchResult` (type) | `commands/ingest.ts` | `ingestion.types.ts` |
| `BatchOptions` (type) | `commands/ingest.ts` | `ingestion.types.ts` |
| `parseTranscriptLine` | `transcript.ts` | `transcript.ts` (stays as pure function) |
| `groupIntoTurns` | `transcript.ts` | `transcript.ts` (stays as pure function) |
| `TranscriptToolUse` (type) | `transcript.ts` | `transcript.ts` |
| `TranscriptToolResult` (type) | `transcript.ts` | `transcript.ts` |
| `TranscriptUsage` (type) | `transcript.ts` | `transcript.ts` |
| `TranscriptLine` (type) | `transcript.ts` | `transcript.ts` |
| `ParsedTurn` (type) | `transcript.ts` | `transcript.ts` |
| `extractToolDetail` | `tool-detail.ts` | `tool-detail.ts` (stays as pure function) |

### features/analytics/

| Current Export | Current Source | Target |
|---|---|---|
| `buildWhereClause` | `commands/analytics-common.ts` | `analytics.utils.ts` |
| `parseAnalyticsOptions` | `commands/analytics-common.ts` | `analytics.utils.ts` |
| `FilterOptions` (type) | `commands/analytics-common.ts` | `analytics.types.ts` |
| `WhereClause` (type) | `commands/analytics-common.ts` | `analytics.types.ts` |
| `AnalyticsCliOptions` (type) | `commands/analytics-common.ts` | `analytics.types.ts` |
| `summaryQuery` | `commands/analytics-summary.ts` | `analytics.service.ts` |
| `SummaryResult` (type) | `commands/analytics-summary.ts` | `analytics.types.ts` |
| `toolsQuery` | `commands/analytics-tools.ts` | `analytics.service.ts` |
| `ToolsResult` (type) | `commands/analytics-tools.ts` | `analytics.types.ts` |
| `sessionsAnalyticsQuery` | `commands/analytics-sessions.ts` | `analytics.service.ts` |
| `SessionAnalytics` (type) | `commands/analytics-sessions.ts` | `analytics.types.ts` |
| `SessionsAnalyticsResult` (type) | `commands/analytics-sessions.ts` | `analytics.types.ts` |
| `patternsQuery` | `commands/analytics-patterns.ts` | `analytics.service.ts` |
| `PatternsResult` (type) | `commands/analytics-patterns.ts` | `analytics.types.ts` |
| `executeQuery` | `commands/query.ts` | `analytics.service.ts` (or `analytics/query.ts`) |
| `QueryResult` (type) | `commands/query.ts` | `analytics.types.ts` |

### Not Exported (CLI-only, internal)

These functions exist in command files but are NOT in the library barrel. They move to `.cli.ts` files:
- `statusCommand` → `session.cli.ts`
- `latestCommand` → `session.cli.ts`
- `sessionsCommand` → `session.cli.ts`
- `gcCli` → `session.cli.ts`
- `sweepCli` → `session.cli.ts`
- `recordEvent` CLI handler (in `cli.ts` action) → `recording.cli.ts`
- `ingestCli` → `ingestion.cli.ts`
- `queryCli` → `analytics.cli.ts`
- `summaryCli` → `analytics.cli.ts`
- `toolsCli` → `analytics.cli.ts`
- `sessionsAnalyticsCli` → `analytics.cli.ts`
- `patternsCli` → `analytics.cli.ts`

### Local Functions (not exported, absorbed during migration)

- `gc.ts:parseDuration()` (local, days only) → replaced by `core/utils.ts:parseDuration`
- `sweep.ts:parseSweepThreshold()` (exported) → replaced by `core/utils.ts:parseDuration`
- `ingest.ts:parseSinceDuration()` (local, d/h/m) → replaced by `core/utils.ts:parseDuration`
- `status.ts:STALE_THRESHOLD_MS` → `core/config.ts`

## From existing code
- `src/db.ts` - All database operations (split across feature repositories)
- `src/types.ts` - Shared types (moved to `core/types.ts`)
- `src/commands/` - All command modules (split into feature services + CLI handlers)
- `src/workspace.ts` - Workspace resolution (moved to `features/workspace/`)
- `src/transcript.ts` - Transcript parsing (moved to `features/ingestion/`)
- `src/tool-detail.ts` - Tool detail extraction (moved to `features/ingestion/`)
