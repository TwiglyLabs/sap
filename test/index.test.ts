import { describe, it, expect } from 'vitest';
import {
  createSap,
  ok,
  err,
} from '../src/index.ts';

// Type-only imports — compile-time verification that types are re-exported
import type {
  Sap,
  SapOptions,
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
  StatusResult,
  GroupedStatusResult,
  SessionsQueryOptions,
  IngestResult,
  IngestOptions,
  BatchResult,
  BatchOptions,
  FilterOptions,
  SummaryResult,
  ToolsResult,
  SessionAnalytics,
  SessionsAnalyticsResult,
  PatternsResult,
  QueryResult,
} from '../src/index.ts';

// Subpath imports
import { SessionService } from '../src/features/sessions/index.ts';
import { RecordingService } from '../src/features/recording/index.ts';
import { WorkspaceService } from '../src/features/workspace/index.ts';
import { IngestionService } from '../src/features/ingestion/index.ts';
import { AnalyticsService } from '../src/features/analytics/index.ts';

describe('library API surface', () => {
  it('exports factory and result helpers from main barrel', () => {
    expect(typeof createSap).toBe('function');
    expect(typeof ok).toBe('function');
    expect(typeof err).toBe('function');
  });

  it('ok/err helpers produce correct Result shapes', () => {
    const success = ok(42);
    expect(success).toEqual({ ok: true, data: 42 });

    const failure = err('bad input');
    expect(failure).toEqual({ ok: false, error: 'bad input' });
  });

  it('exports service classes via subpath imports', () => {
    expect(typeof SessionService).toBe('function');
    expect(typeof RecordingService).toBe('function');
    expect(typeof WorkspaceService).toBe('function');
    expect(typeof IngestionService).toBe('function');
    expect(typeof AnalyticsService).toBe('function');
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
