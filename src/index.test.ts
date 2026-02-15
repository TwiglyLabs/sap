import { describe, it, expect } from 'vitest';
import {
  // Database
  openDb,
  DEFAULT_DB_PATH,
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
  // Event recording
  recordEvent,
  parsePayload,
  // Session queries
  statusQuery,
  statusQueryGrouped,
  latestQuery,
  sessionsQuery,
  // Lifecycle
  gcCommand,
  sweepCommand,
  parseSweepThreshold,
  // Ingestion
  ingestSession,
  ingestBatch,
  // Raw query
  executeQuery,
  // Analytics
  parseDuration,
  buildWhereClause,
  parseAnalyticsOptions,
  summaryQuery,
  toolsQuery,
  sessionsAnalyticsQuery,
  patternsQuery,
  // Workspace
  resolveWorkspace,
  resolveWorkspaceFromGit,
  // Transcript
  parseTranscriptLine,
  groupIntoTurns,
  // Tool detail
  extractToolDetail,
} from './index.ts';

// Type-only imports — compile-time verification that types are re-exported
import type {
  SessionState,
  EventType,
  Session,
  SessionStatus,
  Turn,
  ToolCall,
  HookPayload,
  WorkspaceEntry,
  StatusResult,
  GroupedStatusResult,
  SessionsQueryOptions,
  IngestResult,
  BatchResult,
  BatchOptions,
  IngestOptions,
  QueryResult,
  FilterOptions,
  WhereClause,
  SummaryResult,
  ToolsResult,
  SessionAnalytics,
  SessionsAnalyticsResult,
  PatternsResult,
  TranscriptLine,
  TranscriptToolUse,
  TranscriptToolResult,
  TranscriptUsage,
  ParsedTurn,
  EventRow,
  AnalyticsCliOptions,
  SessionStartSource,
} from './index.ts';

describe('library API surface', () => {
  it('exports all database functions', () => {
    expect(typeof openDb).toBe('function');
    expect(typeof DEFAULT_DB_PATH).toBe('string');
    expect(typeof insertSession).toBe('function');
    expect(typeof upsertSession).toBe('function');
    expect(typeof getSession).toBe('function');
    expect(typeof updateSessionState).toBe('function');
    expect(typeof getActiveSessions).toBe('function');
    expect(typeof insertEvent).toBe('function');
    expect(typeof getSessionEvents).toBe('function');
    expect(typeof upsertWorkspace).toBe('function');
    expect(typeof getCachedWorkspace).toBe('function');
    expect(typeof getLatestSession).toBe('function');
    expect(typeof getSessionHistory).toBe('function');
    expect(typeof markStaleSessions).toBe('function');
    expect(typeof deleteStaleSessions).toBe('function');
    expect(typeof insertTurn).toBe('function');
    expect(typeof getSessionTurns).toBe('function');
    expect(typeof insertToolCall).toBe('function');
    expect(typeof getTurnToolCalls).toBe('function');
  });

  it('exports all command functions', () => {
    expect(typeof recordEvent).toBe('function');
    expect(typeof parsePayload).toBe('function');
    expect(typeof statusQuery).toBe('function');
    expect(typeof statusQueryGrouped).toBe('function');
    expect(typeof latestQuery).toBe('function');
    expect(typeof sessionsQuery).toBe('function');
    expect(typeof gcCommand).toBe('function');
    expect(typeof sweepCommand).toBe('function');
    expect(typeof parseSweepThreshold).toBe('function');
    expect(typeof ingestSession).toBe('function');
    expect(typeof ingestBatch).toBe('function');
    expect(typeof executeQuery).toBe('function');
  });

  it('exports all analytics functions', () => {
    expect(typeof parseDuration).toBe('function');
    expect(typeof buildWhereClause).toBe('function');
    expect(typeof parseAnalyticsOptions).toBe('function');
    expect(typeof summaryQuery).toBe('function');
    expect(typeof toolsQuery).toBe('function');
    expect(typeof sessionsAnalyticsQuery).toBe('function');
    expect(typeof patternsQuery).toBe('function');
  });

  it('exports workspace and transcript utilities', () => {
    expect(typeof resolveWorkspace).toBe('function');
    expect(typeof resolveWorkspaceFromGit).toBe('function');
    expect(typeof parseTranscriptLine).toBe('function');
    expect(typeof groupIntoTurns).toBe('function');
    expect(typeof extractToolDetail).toBe('function');
  });
});
