import { describe, it, expect } from 'vitest';
import {
  // Factory
  createSap,
  // Core
  openDb,
  DEFAULT_DB_PATH,
  parseDuration,
  STALE_THRESHOLD_MS,
  // Services
  SessionService,
  RecordingService,
  WorkspaceService,
  IngestionService,
  AnalyticsService,
  // Recording
  parsePayload,
  // Workspace
  resolveWorkspaceFromGit,
  // Analytics utils
  buildWhereClause,
  parseAnalyticsOptions,
  // Transcript
  parseTranscriptLine,
  groupIntoTurns,
  // Tool detail
  extractToolDetail,
} from '../src/index.ts';

// Type-only imports — compile-time verification that types are re-exported
import type {
  Sap,
  SapOptions,
  SessionState,
  EventType,
  SessionStartSource,
  HookPayload,
  Session,
  SessionStatus,
  Turn,
  ToolCall,
  WorkspaceEntry,
  StatusResult,
  GroupedStatusResult,
  SessionsQueryOptions,
  EventRow,
  SessionRepository,
  IngestResult,
  IngestOptions,
  BatchResult,
  BatchOptions,
  FilterOptions,
  WhereClause,
  AnalyticsCliOptions,
  SummaryResult,
  ToolsResult,
  SessionAnalytics,
  SessionsAnalyticsResult,
  PatternsResult,
  QueryResult,
  TranscriptLine,
  TranscriptToolUse,
  TranscriptToolResult,
  TranscriptUsage,
  ParsedTurn,
} from '../src/index.ts';

describe('library API surface', () => {
  it('exports factory and core infrastructure', () => {
    expect(typeof createSap).toBe('function');
    expect(typeof openDb).toBe('function');
    expect(typeof DEFAULT_DB_PATH).toBe('string');
    expect(typeof parseDuration).toBe('function');
    expect(typeof STALE_THRESHOLD_MS).toBe('number');
  });

  it('exports service classes', () => {
    expect(typeof SessionService).toBe('function');
    expect(typeof RecordingService).toBe('function');
    expect(typeof WorkspaceService).toBe('function');
    expect(typeof IngestionService).toBe('function');
    expect(typeof AnalyticsService).toBe('function');
  });

  it('exports utility functions', () => {
    expect(typeof parsePayload).toBe('function');
    expect(typeof resolveWorkspaceFromGit).toBe('function');
    expect(typeof buildWhereClause).toBe('function');
    expect(typeof parseAnalyticsOptions).toBe('function');
    expect(typeof parseTranscriptLine).toBe('function');
    expect(typeof groupIntoTurns).toBe('function');
    expect(typeof extractToolDetail).toBe('function');
  });

  it('createSap returns Sap instance with all services', () => {
    const sap = createSap({ dbPath: ':memory:' });
    expect(sap.sessions).toBeInstanceOf(SessionService);
    expect(sap.recording).toBeInstanceOf(RecordingService);
    expect(sap.workspace).toBeInstanceOf(WorkspaceService);
    expect(sap.ingestion).toBeInstanceOf(IngestionService);
    expect(sap.analytics).toBeInstanceOf(AnalyticsService);
    expect(typeof sap.close).toBe('function');
    sap.close();
  });
});
