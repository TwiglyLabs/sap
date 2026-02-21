import type { Session, SessionState } from '../../core/types.ts';

export interface InsertSessionParams {
  session_id: string;
  workspace: string;
  cwd: string;
  transcript_path: string | null;
  started_at: number;
}

export interface EventRow {
  id: number;
  session_id: string;
  event_type: string;
  data: string | null;
  created_at: number;
}

export interface InsertEventParams {
  session_id: string;
  event_type: string;
  data: string | null;
  created_at: number;
}

export interface SessionHistoryParams {
  workspace?: string;
  limit: number;
}

/** Data access contract for session lifecycle operations. */
export interface SessionRepository {
  getSession(sessionId: string): Session | null;
  getActiveSessions(workspace?: string): Session[];
  getLatestSession(workspace: string): Session | null;
  getSessionHistory(params: SessionHistoryParams): Session[];
  insertSession(params: InsertSessionParams): void;
  upsertSession(params: InsertSessionParams): void;
  updateSessionState(
    sessionId: string,
    state: SessionState,
    eventTime: number,
    tool?: { tool: string; detail: string | null },
  ): void;
  markStaleSessions(thresholdMs: number): number;
  deleteStaleSessions(olderThan: number): number;
  insertEvent(params: InsertEventParams): void;
  getSessionEvents(sessionId: string): EventRow[];
}
