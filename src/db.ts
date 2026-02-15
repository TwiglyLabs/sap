import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import type { Session, SessionState, WorkspaceEntry, Turn, ToolCall } from './types.ts';

export const DEFAULT_DB_PATH = process.env.SAP_DB_PATH || join(homedir(), '.sap', 'sap.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  cwd         TEXT PRIMARY KEY,
  repo_name   TEXT NOT NULL,
  branch      TEXT NOT NULL,
  workspace   TEXT NOT NULL,
  resolved_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  session_id       TEXT PRIMARY KEY,
  workspace        TEXT NOT NULL,
  cwd              TEXT NOT NULL,
  transcript_path  TEXT,
  state            TEXT NOT NULL DEFAULT 'active',
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  last_event_at    INTEGER NOT NULL,
  last_tool        TEXT,
  last_tool_detail TEXT,
  ingested_at      INTEGER
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  data        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id               TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_number              INTEGER NOT NULL,
  prompt_text              TEXT,
  input_tokens             INTEGER,
  output_tokens            INTEGER,
  cache_read_tokens        INTEGER,
  cache_write_tokens       INTEGER,
  model                    TEXT,
  tool_call_count          INTEGER NOT NULL DEFAULT 0,
  started_at               INTEGER,
  ended_at                 INTEGER,
  duration_ms              INTEGER
);

CREATE TABLE IF NOT EXISTS tool_calls (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_id             INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  tool_use_id         TEXT,
  tool_name           TEXT NOT NULL,
  tool_input_summary  TEXT,
  success             INTEGER,
  error_message       TEXT,
  created_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_started ON turns(started_at);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);
`;

export function openDb(path: string = DEFAULT_DB_PATH): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 3000');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  // Migration for existing databases: add ingested_at column if missing
  try {
    db.exec('ALTER TABLE sessions ADD COLUMN ingested_at INTEGER');
  } catch {
    // Column already exists — ignore
  }

  return db;
}

// --- Session operations ---

interface InsertSessionParams {
  session_id: string;
  workspace: string;
  cwd: string;
  transcript_path: string | null;
  started_at: number;
}

export function insertSession(db: Database.Database, params: InsertSessionParams): void {
  db.prepare(`
    INSERT INTO sessions (session_id, workspace, cwd, transcript_path, state, started_at, last_event_at)
    VALUES (@session_id, @workspace, @cwd, @transcript_path, 'active', @started_at, @started_at)
  `).run(params);
}

export function upsertSession(db: Database.Database, params: InsertSessionParams): void {
  db.prepare(`
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

export function getSession(db: Database.Database, sessionId: string): Session | null {
  return (db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Session | undefined) ?? null;
}

export function updateSessionState(
  db: Database.Database,
  sessionId: string,
  state: SessionState,
  eventTime: number,
  tool?: { tool: string; detail: string | null },
): void {
  if (state === 'stopped') {
    db.prepare(`
      UPDATE sessions SET state = ?, last_event_at = ?, ended_at = ? WHERE session_id = ?
    `).run(state, eventTime, eventTime, sessionId);
  } else if (tool) {
    db.prepare(`
      UPDATE sessions SET state = ?, last_event_at = ?, last_tool = ?, last_tool_detail = ?
      WHERE session_id = ?
    `).run(state, eventTime, tool.tool, tool.detail, sessionId);
  } else {
    db.prepare(`
      UPDATE sessions SET state = ?, last_event_at = ? WHERE session_id = ?
    `).run(state, eventTime, sessionId);
  }
}

export function getActiveSessions(db: Database.Database, workspace?: string): Session[] {
  if (workspace) {
    return db.prepare(
      "SELECT * FROM sessions WHERE state != 'stopped' AND workspace = ? ORDER BY last_event_at DESC"
    ).all(workspace) as Session[];
  }
  return db.prepare(
    "SELECT * FROM sessions WHERE state != 'stopped' ORDER BY last_event_at DESC"
  ).all() as Session[];
}

// --- Event operations ---

interface InsertEventParams {
  session_id: string;
  event_type: string;
  data: string | null;
  created_at: number;
}

export interface EventRow {
  id: number;
  session_id: string;
  event_type: string;
  data: string | null;
  created_at: number;
}

export function insertEvent(db: Database.Database, params: InsertEventParams): void {
  db.prepare(`
    INSERT INTO events (session_id, event_type, data, created_at)
    VALUES (@session_id, @event_type, @data, @created_at)
  `).run(params);
}

export function getSessionEvents(db: Database.Database, sessionId: string): EventRow[] {
  return db.prepare(
    'SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as EventRow[];
}

// --- Workspace cache ---

export function upsertWorkspace(db: Database.Database, entry: WorkspaceEntry): void {
  db.prepare(`
    INSERT INTO workspaces (cwd, repo_name, branch, workspace, resolved_at)
    VALUES (@cwd, @repo_name, @branch, @workspace, @resolved_at)
    ON CONFLICT(cwd) DO UPDATE SET
      repo_name = excluded.repo_name,
      branch = excluded.branch,
      workspace = excluded.workspace,
      resolved_at = excluded.resolved_at
  `).run(entry);
}

export function getCachedWorkspace(db: Database.Database, cwd: string): WorkspaceEntry | null {
  return (db.prepare('SELECT * FROM workspaces WHERE cwd = ?').get(cwd) as WorkspaceEntry | undefined) ?? null;
}

// --- Query helpers ---

export function getLatestSession(db: Database.Database, workspace: string): Session | null {
  return (db.prepare(
    'SELECT * FROM sessions WHERE workspace = ? ORDER BY started_at DESC LIMIT 1'
  ).get(workspace) as Session | undefined) ?? null;
}

interface SessionHistoryParams {
  workspace?: string;
  limit: number;
}

export function getSessionHistory(db: Database.Database, params: SessionHistoryParams): Session[] {
  if (params.workspace) {
    return db.prepare(
      'SELECT * FROM sessions WHERE workspace = ? ORDER BY started_at DESC LIMIT ?'
    ).all(params.workspace, params.limit) as Session[];
  }
  return db.prepare(
    'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?'
  ).all(params.limit) as Session[];
}

export function markStaleSessions(db: Database.Database, thresholdMs: number): number {
  const cutoff = Date.now() - thresholdMs;

  const result = db.prepare(`
    UPDATE sessions
    SET state = 'stopped', ended_at = last_event_at
    WHERE state != 'stopped' AND last_event_at < ?
  `).run(cutoff);

  return result.changes;
}

export function deleteStaleSessions(db: Database.Database, olderThan: number): number {
  const now = Date.now();
  const cutoff = now - olderThan;

  const result = db.prepare(`
    DELETE FROM sessions
    WHERE (state = 'stopped' AND ended_at < ?)
       OR (state != 'stopped' AND last_event_at < ?)
  `).run(cutoff, cutoff);

  return result.changes;
}

// --- Turn operations ---

interface InsertTurnParams {
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

export function insertTurn(db: Database.Database, params: InsertTurnParams): number {
  const result = db.prepare(`
    INSERT INTO turns (session_id, turn_number, prompt_text, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, model, tool_call_count, started_at, ended_at, duration_ms)
    VALUES (@session_id, @turn_number, @prompt_text, @input_tokens, @output_tokens,
      @cache_read_tokens, @cache_write_tokens, @model, @tool_call_count, @started_at, @ended_at, @duration_ms)
  `).run(params);
  return Number(result.lastInsertRowid);
}

export function getSessionTurns(db: Database.Database, sessionId: string): Turn[] {
  return db.prepare(
    'SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number ASC'
  ).all(sessionId) as Turn[];
}

// --- Tool call operations ---

interface InsertToolCallParams {
  session_id: string;
  turn_id: number;
  tool_use_id: string | null;
  tool_name: string;
  tool_input_summary: string | null;
  success: number | null;
  error_message: string | null;
  created_at: number;
}

export function insertToolCall(db: Database.Database, params: InsertToolCallParams): void {
  db.prepare(`
    INSERT INTO tool_calls (session_id, turn_id, tool_use_id, tool_name,
      tool_input_summary, success, error_message, created_at)
    VALUES (@session_id, @turn_id, @tool_use_id, @tool_name,
      @tool_input_summary, @success, @error_message, @created_at)
  `).run(params);
}

export function getTurnToolCalls(db: Database.Database, turnId: number): ToolCall[] {
  return db.prepare(
    'SELECT * FROM tool_calls WHERE turn_id = ? ORDER BY created_at ASC'
  ).all(turnId) as ToolCall[];
}
