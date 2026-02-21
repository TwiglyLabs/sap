import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

export const SCHEMA = `
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

import { join } from 'path';
import { homedir } from 'os';

export const DEFAULT_DB_PATH = process.env.SAP_DB_PATH || join(homedir(), '.sap', 'sap.db');
