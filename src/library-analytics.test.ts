import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, writeFileSync } from 'fs';
import {
  openDb,
  recordEvent,
  ingestSession,
  summaryQuery,
  toolsQuery,
  sessionsAnalyticsQuery,
  patternsQuery,
  getSession,
  parseDuration,
  buildWhereClause,
} from './index.ts';

describe('library analytics parity', () => {
  const tmpDb = `/tmp/sap-lib-analytics-${process.pid}.db`;
  const tmpTranscript = `/tmp/sap-lib-transcript-${process.pid}.jsonl`;

  afterEach(() => {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm', tmpTranscript]) {
      try { unlinkSync(f); } catch {}
    }
  });

  function makeTranscript(): string {
    const lines = [
      {
        type: 'user',
        sessionId: 'analytics-test',
        timestamp: new Date(1000).toISOString(),
        uuid: 'u1',
        message: { content: 'Fix the bug' },
      },
      {
        type: 'assistant',
        sessionId: 'analytics-test',
        timestamp: new Date(2000).toISOString(),
        uuid: 'a1',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/app.ts' } },
          ],
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 100,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'analytics-test',
        timestamp: new Date(3000).toISOString(),
        uuid: 'u2',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false },
          ],
        },
      },
      {
        type: 'assistant',
        sessionId: 'analytics-test',
        timestamp: new Date(4000).toISOString(),
        uuid: 'a2',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'a', new_string: 'b' } },
          ],
          usage: {
            input_tokens: 800,
            output_tokens: 300,
            cache_read_input_tokens: 150,
            cache_creation_input_tokens: 50,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'analytics-test',
        timestamp: new Date(5000).toISOString(),
        uuid: 'u3',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu2', content: 'ok', is_error: false },
          ],
        },
      },
    ];

    return lines.map(l => JSON.stringify(l)).join('\n');
  }

  it('summaryQuery returns correct structure', () => {
    writeFileSync(tmpTranscript, makeTranscript());
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 'analytics-test',
      cwd: '/tmp/repo',
      transcript_path: tmpTranscript,
      permission_mode: 'default',
      hook_event_name: 'session-start',
      source: 'startup',
    });

    const result = ingestSession(db, 'analytics-test');
    expect(result.turns).toBe(1);
    expect(result.toolCalls).toBe(2);

    const summary = summaryQuery(db, {});
    expect(summary.period.until).toBeDefined();
    expect(summary.sessions.total).toBe(1);
    expect(summary.tokens.total_input).toBe(1800);
    expect(summary.tokens.total_output).toBe(800);
    expect(summary.tools.total_calls).toBe(2);
    expect(summary.tools.top.length).toBeGreaterThan(0);

    db.close();
  });

  it('toolsQuery returns per-tool breakdown', () => {
    writeFileSync(tmpTranscript, makeTranscript());
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 'analytics-test',
      cwd: '/tmp/repo',
      transcript_path: tmpTranscript,
      permission_mode: 'default',
      hook_event_name: 'session-start',
      source: 'startup',
    });

    ingestSession(db, 'analytics-test');

    const tools = toolsQuery(db, {});
    expect(tools.tools.length).toBe(2);

    const readTool = tools.tools.find(t => t.tool === 'Read');
    expect(readTool).toBeDefined();
    expect(readTool!.count).toBe(1);
    expect(readTool!.success_rate).toBe(1);

    db.close();
  });

  it('sessionsAnalyticsQuery returns per-session metrics', () => {
    writeFileSync(tmpTranscript, makeTranscript());
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 'analytics-test',
      cwd: '/tmp/repo',
      transcript_path: tmpTranscript,
      permission_mode: 'default',
      hook_event_name: 'session-start',
      source: 'startup',
    });

    ingestSession(db, 'analytics-test');

    const result = sessionsAnalyticsQuery(db, {}, 10);
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].session_id).toBe('analytics-test');
    expect(result.sessions[0].turns).toBe(1);
    expect(result.sessions[0].tool_calls).toBe(2);
    expect(result.sessions[0].input_tokens).toBe(1800);

    db.close();
  });

  it('patternsQuery returns anti-patterns and outliers', () => {
    const db = openDb(tmpDb);
    const patterns = patternsQuery(db, {});
    expect(patterns.anti_patterns).toEqual([]);
    expect(patterns.outlier_sessions).toEqual([]);
    db.close();
  });

  it('parseDuration handles all units', () => {
    expect(parseDuration('7d')).toBe(7 * 86400 * 1000);
    expect(parseDuration('24h')).toBe(24 * 3600 * 1000);
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    expect(() => parseDuration('bad')).toThrow();
  });

  it('buildWhereClause generates correct SQL', () => {
    const empty = buildWhereClause({});
    expect(empty.clause).toBe('');
    expect(empty.params).toEqual([]);

    const withWorkspace = buildWhereClause({ workspace: 'repo:main' });
    expect(withWorkspace.clause).toContain('s.workspace = ?');
    expect(withWorkspace.params).toContain('repo:main');

    const withBoth = buildWhereClause({ workspace: 'repo:main', sinceMs: 86400000 });
    expect(withBoth.clause).toContain('AND');
    expect(withBoth.params.length).toBe(2);
  });
});
