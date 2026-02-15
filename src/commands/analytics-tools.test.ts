import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, insertTurn, insertToolCall } from '../db.ts';
import { toolsQuery } from './analytics-tools.ts';

describe('toolsQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 3600000 });
    const t1 = insertTurn(db, {
      session_id: 's1', turn_number: 1, prompt_text: 'test',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 3, started_at: Date.now() - 3600000, ended_at: Date.now() - 3500000, duration_ms: 100000,
    });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu1', tool_name: 'Read', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3580000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu2', tool_name: 'Edit', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3570000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu3', tool_name: 'Edit', tool_input_summary: 'b.ts', success: 0, error_message: 'old_string not found', created_at: Date.now() - 3560000 });
  });

  it('returns per-tool breakdown', () => {
    const result = toolsQuery(db, {});
    expect(result.tools.length).toBeGreaterThanOrEqual(2);
    const edit = result.tools.find(t => t.tool === 'Edit');
    expect(edit?.count).toBe(2);
    expect(edit?.success_rate).toBe(0.5);
    expect(edit?.error_count).toBe(1);
  });

  it('returns tool sequences', () => {
    const result = toolsQuery(db, {});
    expect(result.sequences.length).toBeGreaterThan(0);
    // Read→Edit should be a sequence
    const readEdit = result.sequences.find(s => s.sequence[0] === 'Read' && s.sequence[1] === 'Edit');
    expect(readEdit).toBeDefined();
  });
});
