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

export interface SapOptions {
  dbPath?: string;
}

export interface Sap {
  sessions: SessionService;
  workspace: WorkspaceService;
  recording: RecordingService;
  ingestion: IngestionService;
  analytics: AnalyticsService;
  close(): void;
}

export function createSap(options?: SapOptions): Sap {
  const db = openDb(options?.dbPath ?? DEFAULT_DB_PATH);
  const sessionRepo = new SessionRepositorySqlite(db);
  const sessionService = new SessionService(sessionRepo);
  const workspaceRepo = new WorkspaceRepositorySqlite(db);
  const workspaceService = new WorkspaceService(workspaceRepo);
  const recordingRepo = new RecordingRepositorySqlite(db);
  const recordingService = new RecordingService(recordingRepo, workspaceService);
  const ingestionRepo = new IngestionRepositorySqlite(db);
  const ingestionService = new IngestionService(ingestionRepo);
  const analyticsRepo = new AnalyticsRepositorySqlite(db);
  const analyticsService = new AnalyticsService(analyticsRepo);

  return {
    sessions: sessionService,
    workspace: workspaceService,
    recording: recordingService,
    ingestion: ingestionService,
    analytics: analyticsService,
    close: () => db.close(),
  };
}
