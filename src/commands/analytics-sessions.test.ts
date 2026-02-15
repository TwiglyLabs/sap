import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, insertTurn, insertToolCall } from '../db.ts';
import { sessionsAnalyticsQuery } from './analytics-sessions.ts';

describe('sessionsAnalyticsQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 3600000 });
    const t1 = insertTurn(db, {
      session_id: 's1', turn_number: 1, prompt_text: 'test',
      input_tokens: 5000, output_tokens: 1000, cache_read_tokens: 2000, cache_write_tokens: 500,
      model: null, tool_call_count: 2, started_at: Date.now() - 3600000, ended_at: Date.now() - 3500000, duration_ms: 100000,
    });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu1', tool_name: 'Read', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3580000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu2', tool_name: 'Bash', tool_input_summary: 'git commit -m "feat"', success: 1, error_message: null, created_at: Date.now() - 3560000 });
  });

  it('returns per-session metrics', () => {
    const result = sessionsAnalyticsQuery(db, {});
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].session_id).toBe('s1');
    expect(result.sessions[0].turns).toBe(1);
    expect(result.sessions[0].input_tokens).toBe(5000);
    expect(result.sessions[0].tool_calls).toBe(2);
  });

  it('detects commit outcome', () => {
    const result = sessionsAnalyticsQuery(db, {});
    expect(result.sessions[0].outcome.committed).toBe(true);
  });

  it('respects limit', () => {
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 1800000 });
    insertTurn(db, {
      session_id: 's2', turn_number: 1, prompt_text: 'test2',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 0, started_at: Date.now() - 1800000, ended_at: Date.now() - 1700000, duration_ms: 100000,
    });

    const result = sessionsAnalyticsQuery(db, {}, 1);
    expect(result.sessions).toHaveLength(1);
  });
});
