import type Database from 'better-sqlite3';
import type { Session, SessionState } from '../../../core/types.ts';
import type {
  SessionRepository,
  InsertSessionParams,
  InsertEventParams,
  EventRow,
  SessionHistoryParams,
} from '../session.repository.ts';

export class SessionRepositorySqlite implements SessionRepository {
  constructor(private db: Database.Database) {}

  getSession(sessionId: string): Session | null {
    return (this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Session | undefined) ?? null;
  }

  getActiveSessions(workspace?: string): Session[] {
    if (workspace) {
      return this.db.prepare(
        "SELECT * FROM sessions WHERE state != 'stopped' AND workspace = ? ORDER BY last_event_at DESC"
      ).all(workspace) as Session[];
    }
    return this.db.prepare(
      "SELECT * FROM sessions WHERE state != 'stopped' ORDER BY last_event_at DESC"
    ).all() as Session[];
  }

  getLatestSession(workspace: string): Session | null {
    return (this.db.prepare(
      'SELECT * FROM sessions WHERE workspace = ? ORDER BY started_at DESC LIMIT 1'
    ).get(workspace) as Session | undefined) ?? null;
  }

  getSessionHistory(params: SessionHistoryParams): Session[] {
    if (params.workspace) {
      return this.db.prepare(
        'SELECT * FROM sessions WHERE workspace = ? ORDER BY started_at DESC LIMIT ?'
      ).all(params.workspace, params.limit) as Session[];
    }
    return this.db.prepare(
      'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?'
    ).all(params.limit) as Session[];
  }

  insertSession(params: InsertSessionParams): void {
    this.db.prepare(`
      INSERT INTO sessions (session_id, workspace, cwd, transcript_path, state, started_at, last_event_at)
      VALUES (@session_id, @workspace, @cwd, @transcript_path, 'active', @started_at, @started_at)
    `).run(params);
  }

  upsertSession(params: InsertSessionParams): void {
    this.db.prepare(`
      INSERT INTO sessions (session_id, workspace, cwd, transcript_path, state, started_at, last_event_at)
      VALUES (@session_id, @workspace, @cwd, @transcript_path, 'active', @started_at, @started_at)
      ON CONFLICT(session_id) DO UPDATE SET
        workspace = excluded.workspace,
        cwd = excluded.cwd,
        transcript_path = excluded.transcript_path,
        state = 'active',
        started_at = excluded.started_at,
        last_event_at = excluded.started_at,
        ended_at = NULL,
        last_tool = NULL,
        last_tool_detail = NULL
    `).run(params);
  }

  updateSessionState(
    sessionId: string,
    state: SessionState,
    eventTime: number,
    tool?: { tool: string; detail: string | null },
  ): void {
    if (state === 'stopped') {
      this.db.prepare(`
        UPDATE sessions SET state = ?, last_event_at = ?, ended_at = ? WHERE session_id = ?
      `).run(state, eventTime, eventTime, sessionId);
    } else if (tool) {
      this.db.prepare(`
        UPDATE sessions SET state = ?, last_event_at = ?, last_tool = ?, last_tool_detail = ?
        WHERE session_id = ?
      `).run(state, eventTime, tool.tool, tool.detail, sessionId);
    } else {
      this.db.prepare(`
        UPDATE sessions SET state = ?, last_event_at = ? WHERE session_id = ?
      `).run(state, eventTime, sessionId);
    }
  }

  markStaleSessions(thresholdMs: number): number {
    const cutoff = Date.now() - thresholdMs;
    const result = this.db.prepare(`
      UPDATE sessions
      SET state = 'stopped', ended_at = last_event_at
      WHERE state != 'stopped' AND last_event_at < ?
    `).run(cutoff);
    return result.changes;
  }

  deleteStaleSessions(olderThan: number): number {
    const now = Date.now();
    const cutoff = now - olderThan;
    const result = this.db.prepare(`
      DELETE FROM sessions
      WHERE (state = 'stopped' AND ended_at < ?)
         OR (state != 'stopped' AND last_event_at < ?)
    `).run(cutoff, cutoff);
    return result.changes;
  }

  insertEvent(params: InsertEventParams): void {
    this.db.prepare(`
      INSERT INTO events (session_id, event_type, data, created_at)
      VALUES (@session_id, @event_type, @data, @created_at)
    `).run(params);
  }

  getSessionEvents(sessionId: string): EventRow[] {
    return this.db.prepare(
      'SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC'
    ).all(sessionId) as EventRow[];
  }
}
