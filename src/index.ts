// --- Database ---
export { openDb, DEFAULT_DB_PATH } from './db.ts';
export {
  insertSession,
  upsertSession,
  getSession,
  updateSessionState,
  getActiveSessions,
  insertEvent,
  getSessionEvents,
  upsertWorkspace,
  getCachedWorkspace,
  getLatestSession,
  getSessionHistory,
  markStaleSessions,
  deleteStaleSessions,
  insertTurn,
  getSessionTurns,
  insertToolCall,
  getTurnToolCalls,
} from './db.ts';
export type { EventRow } from './db.ts';

// --- Core types ---
export type {
  SessionState,
  EventType,
  SessionStartSource,
  HookPayload,
  Session,
  SessionStatus,
  Turn,
  ToolCall,
  WorkspaceEntry,
} from './types.ts';

// --- Event recording ---
export { recordEvent, parsePayload } from './commands/record.ts';

// --- Session queries ---
export { statusQuery, statusQueryGrouped } from './commands/status.ts';
export type { StatusResult, GroupedStatusResult } from './commands/status.ts';

export { latestQuery } from './commands/latest.ts';

export { sessionsQuery } from './commands/sessions.ts';
export type { SessionsQueryOptions } from './commands/sessions.ts';

// --- Lifecycle management ---
export { gcCommand } from './commands/gc.ts';
export { sweepCommand, parseSweepThreshold } from './commands/sweep.ts';

// --- Transcript ingestion ---
export { ingestSession, ingestBatch } from './commands/ingest.ts';
export type {
  IngestResult,
  IngestOptions,
  BatchResult,
  BatchOptions,
} from './commands/ingest.ts';

// --- Raw query ---
export { executeQuery } from './commands/query.ts';
export type { QueryResult } from './commands/query.ts';

// --- Analytics ---
export { parseDuration, buildWhereClause, parseAnalyticsOptions } from './commands/analytics-common.ts';
export type {
  FilterOptions,
  WhereClause,
  AnalyticsCliOptions,
} from './commands/analytics-common.ts';

export { summaryQuery } from './commands/analytics-summary.ts';
export type { SummaryResult } from './commands/analytics-summary.ts';

export { toolsQuery } from './commands/analytics-tools.ts';
export type { ToolsResult } from './commands/analytics-tools.ts';

export { sessionsAnalyticsQuery } from './commands/analytics-sessions.ts';
export type {
  SessionAnalytics,
  SessionsAnalyticsResult,
} from './commands/analytics-sessions.ts';

export { patternsQuery } from './commands/analytics-patterns.ts';
export type { PatternsResult } from './commands/analytics-patterns.ts';

// --- Workspace resolution ---
export { resolveWorkspace, resolveWorkspaceFromGit } from './workspace.ts';

// --- Transcript parsing ---
export { parseTranscriptLine, groupIntoTurns } from './transcript.ts';
export type {
  TranscriptToolUse,
  TranscriptToolResult,
  TranscriptUsage,
  TranscriptLine,
  ParsedTurn,
} from './transcript.ts';

// --- Tool detail extraction ---
export { extractToolDetail } from './tool-detail.ts';
