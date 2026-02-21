import type Database from 'better-sqlite3';
import type { Session, SessionState } from '../../../core/types.ts';
import type {
  RecordingRepository,
  InsertSessionParams,
  InsertEventParams,
} from '../recording.repository.ts';

export class RecordingRepositorySqlite implements RecordingRepository {
  constructor(private db: Database.Database) {}

  getSession(sessionId: string): Session | null {
    return (this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Session | undefined) ?? null;
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

  insertEvent(params: InsertEventParams): void {
    this.db.prepare(`
      INSERT INTO events (session_id, event_type, data, created_at)
      VALUES (@session_id, @event_type, @data, @created_at)
    `).run(params);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
