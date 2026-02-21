import type Database from 'better-sqlite3';
import type { Session, Turn, ToolCall } from '../../../core/types.ts';
import type {
  IngestionRepository,
  InsertTurnParams,
  InsertToolCallParams,
} from '../ingestion.repository.ts';

export class IngestionRepositorySqlite implements IngestionRepository {
  constructor(private db: Database.Database) {}

  getSession(sessionId: string): Session | null {
    return (this.db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Session | undefined) ?? null;
  }

  insertTurn(params: InsertTurnParams): number {
    const result = this.db.prepare(`
      INSERT INTO turns (session_id, turn_number, prompt_text, input_tokens, output_tokens,
        cache_read_tokens, cache_write_tokens, model, tool_call_count, started_at, ended_at, duration_ms)
      VALUES (@session_id, @turn_number, @prompt_text, @input_tokens, @output_tokens,
        @cache_read_tokens, @cache_write_tokens, @model, @tool_call_count, @started_at, @ended_at, @duration_ms)
    `).run(params);
    return Number(result.lastInsertRowid);
  }

  getSessionTurns(sessionId: string): Turn[] {
    return this.db.prepare(
      'SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number ASC'
    ).all(sessionId) as Turn[];
  }

  insertToolCall(params: InsertToolCallParams): void {
    this.db.prepare(`
      INSERT INTO tool_calls (session_id, turn_id, tool_use_id, tool_name,
        tool_input_summary, success, error_message, created_at)
      VALUES (@session_id, @turn_id, @tool_use_id, @tool_name,
        @tool_input_summary, @success, @error_message, @created_at)
    `).run(params);
  }

  getTurnToolCalls(turnId: number): ToolCall[] {
    return this.db.prepare(
      'SELECT * FROM tool_calls WHERE turn_id = ? ORDER BY created_at ASC'
    ).all(turnId) as ToolCall[];
  }

  deleteToolCallsForSession(sessionId: string): void {
    this.db.prepare('DELETE FROM tool_calls WHERE session_id = ?').run(sessionId);
  }

  deleteTurnsForSession(sessionId: string): void {
    this.db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);
  }

  markSessionIngested(sessionId: string): void {
    this.db.prepare('UPDATE sessions SET ingested_at = ? WHERE session_id = ?').run(Date.now(), sessionId);
  }

  getSessionsForIngestion(sinceMs?: number): { session_id: string; transcript_path: string | null; started_at: number; ingested_at: number | null }[] {
    let query = 'SELECT session_id, transcript_path, started_at, ingested_at FROM sessions WHERE transcript_path IS NOT NULL';
    const params: unknown[] = [];

    if (sinceMs) {
      const cutoff = Date.now() - sinceMs;
      query += ' AND started_at >= ?';
      params.push(cutoff);
    }

    query += ' ORDER BY started_at DESC';
    return this.db.prepare(query).all(...params) as { session_id: string; transcript_path: string | null; started_at: number; ingested_at: number | null }[];
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
