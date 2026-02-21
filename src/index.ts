// --- Factory ---
export { createSap } from './sap.ts';
export type { Sap, SapOptions } from './sap.ts';

// --- Result type ---
export type { Result } from './core/types.ts';
export { ok, err } from './core/utils.ts';

// --- Domain types ---
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
} from './core/types.ts';

// --- Session types ---
export type { StatusResult, GroupedStatusResult, SessionsQueryOptions } from './features/sessions/session.types.ts';

// --- Ingestion types ---
export type { IngestResult, IngestOptions, BatchResult, BatchOptions } from './features/ingestion/ingestion.types.ts';

// --- Analytics types ---
export type {
  FilterOptions,
  SummaryResult,
  ToolsResult,
  SessionAnalytics,
  SessionsAnalyticsResult,
  PatternsResult,
  QueryResult,
} from './features/analytics/analytics.types.ts';
