import { openDb, DEFAULT_DB_PATH } from './core/storage.ts';
import { SessionRepositorySqlite } from './features/sessions/sqlite/session.repository.sqlite.ts';
import { SessionService } from './features/sessions/session.service.ts';
import { WorkspaceRepositorySqlite } from './features/workspace/sqlite/workspace.repository.sqlite.ts';
import { WorkspaceService } from './features/workspace/workspace.service.ts';
import { RecordingRepositorySqlite } from './features/recording/sqlite/recording.repository.sqlite.ts';
import { RecordingService } from './features/recording/recording.service.ts';
import { IngestionRepositorySqlite } from './features/ingestion/sqlite/ingestion.repository.sqlite.ts';
import { IngestionService } from './features/ingestion/ingestion.service.ts';
import { AnalyticsRepositorySqlite } from './features/analytics/sqlite/analytics.repository.sqlite.ts';
import { AnalyticsService } from './features/analytics/analytics.service.ts';
import { noopLogger } from '@twiglylabs/log';
import type { Logger } from '@twiglylabs/log';

/** Options for creating a SAP instance. */
export interface SapOptions {
  /** SQLite database path. Defaults to ~/.sap/sap.db or SAP_DB_PATH env var. Use ':memory:' for tests. */
  dbPath?: string;
  /** Optional logger. When omitted, a no-op logger is used (zero overhead). */
  logger?: Logger;
}

/** SAP instance with all services wired to a shared SQLite database. */
export interface Sap {
  /** Session lifecycle: status, history, gc, sweep. */
  sessions: SessionService;
  /** Git workspace resolution and caching. */
  workspace: WorkspaceService;
  /** Hook event recording from Claude Code. */
  recording: RecordingService;
  /** Transcript JSONL parsing into turns and tool calls. */
  ingestion: IngestionService;
  /** Usage analytics: summary, tools, sessions, patterns, raw SQL. */
  analytics: AnalyticsService;
  /** Close the underlying database connection. */
  close(): void;
}

/** Create a SAP instance. Opens the database and wires all services. */
export function createSap(options?: SapOptions): Sap {
  const logger = options?.logger ?? noopLogger;
  const log = logger.child('sap');

  const dbPath = options?.dbPath ?? DEFAULT_DB_PATH;
  const db = openDb(dbPath);
  log.debug('database opened', { dbPath });

  const sessionRepo = new SessionRepositorySqlite(db);
  const sessionService = new SessionService(sessionRepo, logger);
  const workspaceRepo = new WorkspaceRepositorySqlite(db);
  const workspaceService = new WorkspaceService(workspaceRepo);
  const recordingRepo = new RecordingRepositorySqlite(db);
  const recordingService = new RecordingService(recordingRepo, workspaceService, logger);
  const ingestionRepo = new IngestionRepositorySqlite(db);
  const ingestionService = new IngestionService(ingestionRepo, logger);
  const analyticsRepo = new AnalyticsRepositorySqlite(db);
  const analyticsService = new AnalyticsService(analyticsRepo, logger);

  return {
    sessions: sessionService,
    workspace: workspaceService,
    recording: recordingService,
    ingestion: ingestionService,
    analytics: analyticsService,
    close: () => {
      db.close();
      log.debug('database closed', { dbPath });
    },
  };
}
