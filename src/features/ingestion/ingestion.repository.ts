import type { Session, Turn, ToolCall } from '../../core/types.ts';

export interface InsertTurnParams {
  session_id: string;
  turn_number: number;
  prompt_text: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  model: string | null;
  tool_call_count: number;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null;
}

export interface InsertToolCallParams {
  session_id: string;
  turn_id: number;
  tool_use_id: string | null;
  tool_name: string;
  tool_input_summary: string | null;
  success: number | null;
  error_message: string | null;
  created_at: number;
}

export interface IngestionRepository {
  getSession(sessionId: string): Session | null;
  insertTurn(params: InsertTurnParams): number;
  getSessionTurns(sessionId: string): Turn[];
  insertToolCall(params: InsertToolCallParams): void;
  getTurnToolCalls(turnId: number): ToolCall[];
  deleteToolCallsForSession(sessionId: string): void;
  deleteTurnsForSession(sessionId: string): void;
  markSessionIngested(sessionId: string): void;
  getSessionsForIngestion(sinceMs?: number): { session_id: string; transcript_path: string | null; started_at: number; ingested_at: number | null }[];
  transaction<T>(fn: () => T): T;
}
