import type { Session, SessionState } from '../../core/types.ts';

export interface InsertSessionParams {
  session_id: string;
  workspace: string;
  cwd: string;
  transcript_path: string | null;
  started_at: number;
}

export interface InsertEventParams {
  session_id: string;
  event_type: string;
  data: string | null;
  created_at: number;
}

export interface RecordingRepository {
  getSession(sessionId: string): Session | null;
  insertSession(params: InsertSessionParams): void;
  upsertSession(params: InsertSessionParams): void;
  updateSessionState(
    sessionId: string,
    state: SessionState,
    eventTime: number,
    tool?: { tool: string; detail: string | null },
  ): void;
  insertEvent(params: InsertEventParams): void;
  transaction<T>(fn: () => T): T;
}
