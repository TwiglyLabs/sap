import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, insertTurn, insertToolCall } from '../db.ts';
import { summaryQuery } from './analytics-summary.ts';

function seedData(db: Database.Database) {
  insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 3600000 });
  insertSession(db, { session_id: 's2', workspace: 'repo:dev', cwd: '/r', transcript_path: null, started_at: Date.now() - 1800000 });

  const t1 = insertTurn(db, {
    session_id: 's1', turn_number: 1, prompt_text: 'hello',
    input_tokens: 5000, output_tokens: 1000, cache_read_tokens: 2000, cache_write_tokens: 500,
    model: 'claude-sonnet-4-5-20250929', tool_call_count: 2, started_at: Date.now() - 3600000, ended_at: Date.now() - 3500000, duration_ms: 100000,
  });
  const t2 = insertTurn(db, {
    session_id: 's1', turn_number: 2, prompt_text: 'fix bug',
    input_tokens: 8000, output_tokens: 2000, cache_read_tokens: 4000, cache_write_tokens: 1000,
    model: 'claude-sonnet-4-5-20250929', tool_call_count: 1, started_at: Date.now() - 3400000, ended_at: Date.now() - 3300000, duration_ms: 100000,
  });
  const t3 = insertTurn(db, {
    session_id: 's2', turn_number: 1, prompt_text: 'deploy',
    input_tokens: 3000, output_tokens: 500, cache_read_tokens: 1000, cache_write_tokens: 200,
    model: 'claude-sonnet-4-5-20250929', tool_call_count: 1, started_at: Date.now() - 1800000, ended_at: Date.now() - 1700000, duration_ms: 100000,
  });

  insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu1', tool_name: 'Read', tool_input_summary: 'app.ts', success: 1, error_message: null, created_at: Date.now() - 3550000 });
  insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu2', tool_name: 'Edit', tool_input_summary: 'app.ts', success: 1, error_message: null, created_at: Date.now() - 3540000 });
  insertToolCall(db, { session_id: 's1', turn_id: t2, tool_use_id: 'tu3', tool_name: 'Bash', tool_input_summary: 'npm test', success: 0, error_message: 'exit code 1', created_at: Date.now() - 3350000 });
  insertToolCall(db, { session_id: 's2', turn_id: t3, tool_use_id: 'tu4', tool_name: 'Read', tool_input_summary: 'config.ts', success: 1, error_message: null, created_at: Date.now() - 1750000 });
}

describe('summaryQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    seedData(db);
  });

  it('returns session count', () => {
    const result = summaryQuery(db, {});
    expect(result.sessions.total).toBe(2);
  });

  it('returns token totals', () => {
    const result = summaryQuery(db, {});
    expect(result.tokens.total_input).toBe(16000);
    expect(result.tokens.total_output).toBe(3500);
  });

  it('returns top tools', () => {
    const result = summaryQuery(db, {});
    expect(result.tools.total_calls).toBe(4);
    const readTool = result.tools.top.find(t => t.tool === 'Read');
    expect(readTool?.count).toBe(2);
  });

  it('returns workspace breakdown', () => {
    const result = summaryQuery(db, {});
    expect(result.sessions.by_workspace).toHaveLength(2);
  });

  it('filters by workspace', () => {
    const result = summaryQuery(db, { workspace: 'repo:main' });
    expect(result.sessions.total).toBe(1);
    expect(result.tokens.total_input).toBe(13000);
  });
});
