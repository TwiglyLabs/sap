import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, insertTurn, insertToolCall } from '../db.ts';
import { patternsQuery } from './analytics-patterns.ts';

describe('patternsQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    // Session with Edit retry pattern
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 3600000 });
    const t1 = insertTurn(db, {
      session_id: 's1', turn_number: 1, prompt_text: 'edit file',
      input_tokens: 5000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 3, started_at: Date.now() - 3600000, ended_at: Date.now() - 3500000, duration_ms: 100000,
    });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu1', tool_name: 'Edit', tool_input_summary: 'a.ts', success: 0, error_message: 'old_string not found', created_at: Date.now() - 3580000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu2', tool_name: 'Read', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3570000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu3', tool_name: 'Edit', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3560000 });

    // Normal sessions to establish a low average
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 3000000 });
    insertTurn(db, {
      session_id: 's2', turn_number: 1, prompt_text: 'small task',
      input_tokens: 3000, output_tokens: 500, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 0, started_at: Date.now() - 3000000, ended_at: Date.now() - 2900000, duration_ms: 100000,
    });
    insertSession(db, { session_id: 's3', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 2500000 });
    insertTurn(db, {
      session_id: 's3', turn_number: 1, prompt_text: 'another small task',
      input_tokens: 4000, output_tokens: 600, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 0, started_at: Date.now() - 2500000, ended_at: Date.now() - 2400000, duration_ms: 100000,
    });

    // High-token outlier session (10x the others)
    insertSession(db, { session_id: 's4', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 1800000 });
    insertTurn(db, {
      session_id: 's4', turn_number: 1, prompt_text: 'huge task',
      input_tokens: 500000, output_tokens: 100000, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 0, started_at: Date.now() - 1800000, ended_at: Date.now() - 1700000, duration_ms: 100000,
    });
  });

  it('detects edit retry anti-pattern', () => {
    const result = patternsQuery(db, {});
    const editRetry = result.anti_patterns.find(p => p.pattern === 'edit-retry');
    expect(editRetry).toBeDefined();
    expect(editRetry!.frequency).toBeGreaterThan(0);
  });

  it('identifies outlier sessions', () => {
    const result = patternsQuery(db, {});
    expect(result.outlier_sessions.length).toBeGreaterThan(0);
  });
});
