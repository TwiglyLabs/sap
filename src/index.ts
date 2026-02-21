// --- Factory ---
export { createSap } from './sap.ts';
export type { Sap, SapOptions } from './sap.ts';

// --- Core types ---
export type {
  Result,
  SessionState,
  EventType,
  SessionStartSource,
  HookPayload,
  Session,
  SessionStatus,
  Turn,
  ToolCall,
  WorkspaceEntry,
} from './core/types.ts';

// --- Result helpers ---
export { ok, err } from './core/utils.ts';

// --- Core utilities ---
export { openDb, DEFAULT_DB_PATH } from './core/storage.ts';
export { parseDuration } from './core/utils.ts';
export { STALE_THRESHOLD_MS } from './core/config.ts';

// --- Session types ---
export type { StatusResult, GroupedStatusResult, SessionsQueryOptions } from './features/sessions/session.types.ts';
export type { EventRow, SessionRepository } from './features/sessions/session.repository.ts';
export { SessionService } from './features/sessions/session.service.ts';

// --- Recording ---
export { RecordingService, parsePayload } from './features/recording/recording.service.ts';

// --- Workspace ---
export { WorkspaceService, resolveWorkspaceFromGit } from './features/workspace/workspace.service.ts';

// --- Ingestion ---
export { IngestionService } from './features/ingestion/ingestion.service.ts';
export type { IngestResult, IngestOptions, BatchResult, BatchOptions } from './features/ingestion/ingestion.types.ts';

// --- Transcript parsing ---
export { parseTranscriptLine, groupIntoTurns } from './features/ingestion/transcript.ts';
export type {
  TranscriptToolUse,
  TranscriptToolResult,
  TranscriptUsage,
  TranscriptLine,
  ParsedTurn,
} from './features/ingestion/transcript.ts';

// --- Tool detail extraction ---
export { extractToolDetail } from './features/ingestion/tool-detail.ts';

// --- Analytics ---
export { AnalyticsService } from './features/analytics/analytics.service.ts';
export { buildWhereClause, parseAnalyticsOptions } from './features/analytics/analytics.utils.ts';
export type {
  FilterOptions,
  WhereClause,
  AnalyticsCliOptions,
  SummaryResult,
  ToolsResult,
  SessionAnalytics,
  SessionsAnalyticsResult,
  PatternsResult,
  QueryResult,
} from './features/analytics/analytics.types.ts';
