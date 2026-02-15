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
  insertSession,
} from './index.ts';

describe('library analytics parity', () => {
  const tmpDb = `/tmp/sap-lib-analytics-${process.pid}.db`;
  const tmpTranscript = `/tmp/sap-lib-transcript-${process.pid}.jsonl`;
  const tmpTranscript2 = `/tmp/sap-lib-transcript-${process.pid}-2.jsonl`;
  const tmpTranscript3 = `/tmp/sap-lib-transcript-${process.pid}-3.jsonl`;
  const tmpTranscript4 = `/tmp/sap-lib-transcript-${process.pid}-4.jsonl`;

  afterEach(() => {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm', tmpTranscript, tmpTranscript2, tmpTranscript3, tmpTranscript4]) {
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

  it('summaryQuery with workspace filter', () => {
    const db = openDb(tmpDb);

    // Create session for workspace repo-a:main
    const transcriptA = [
      {
        type: 'user',
        sessionId: 'ws-a-1',
        timestamp: new Date(1000).toISOString(),
        uuid: 'u1',
        message: { content: 'Test A' },
      },
      {
        type: 'assistant',
        sessionId: 'ws-a-1',
        timestamp: new Date(2000).toISOString(),
        uuid: 'a1',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.ts' } },
          ],
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'ws-a-1',
        timestamp: new Date(3000).toISOString(),
        uuid: 'u2',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false },
          ],
        },
      },
    ].map(l => JSON.stringify(l)).join('\n');

    // Create session for workspace repo-b:dev
    const transcriptB = [
      {
        type: 'user',
        sessionId: 'ws-b-1',
        timestamp: new Date(1000).toISOString(),
        uuid: 'u1',
        message: { content: 'Test B' },
      },
      {
        type: 'assistant',
        sessionId: 'ws-b-1',
        timestamp: new Date(2000).toISOString(),
        uuid: 'a1',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/b.ts', old_string: 'x', new_string: 'y' } },
          ],
          usage: {
            input_tokens: 2000,
            output_tokens: 1000,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'ws-b-1',
        timestamp: new Date(3000).toISOString(),
        uuid: 'u2',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false },
          ],
        },
      },
    ].map(l => JSON.stringify(l)).join('\n');

    writeFileSync(tmpTranscript2, transcriptA);
    writeFileSync(tmpTranscript3, transcriptB);

    insertSession(db, { session_id: 'ws-a-1', workspace: 'repo-a:main', cwd: '/tmp/a', transcript_path: tmpTranscript2, started_at: Date.now() });
    insertSession(db, { session_id: 'ws-b-1', workspace: 'repo-b:dev', cwd: '/tmp/b', transcript_path: tmpTranscript3, started_at: Date.now() });

    ingestSession(db, 'ws-a-1');
    ingestSession(db, 'ws-b-1');

    // Query for workspace repo-a:main
    const summaryA = summaryQuery(db, { workspace: 'repo-a:main' });
    expect(summaryA.sessions.total).toBe(1);
    expect(summaryA.tokens.total_input).toBe(1000);
    expect(summaryA.tokens.total_output).toBe(500);
    expect(summaryA.tools.total_calls).toBe(1);

    // Query for workspace repo-b:dev
    const summaryB = summaryQuery(db, { workspace: 'repo-b:dev' });
    expect(summaryB.sessions.total).toBe(1);
    expect(summaryB.tokens.total_input).toBe(2000);
    expect(summaryB.tokens.total_output).toBe(1000);

    // Query all workspaces
    const summaryAll = summaryQuery(db, {});
    expect(summaryAll.sessions.total).toBe(2);
    expect(summaryAll.tokens.total_input).toBe(3000);

    db.close();
  });

  it('toolsQuery with workspace filter', () => {
    const db = openDb(tmpDb);

    // Create session for workspace repo-a:main with Read tool
    const transcriptA = [
      {
        type: 'user',
        sessionId: 'ws-a-2',
        timestamp: new Date(1000).toISOString(),
        uuid: 'u1',
        message: { content: 'Test A' },
      },
      {
        type: 'assistant',
        sessionId: 'ws-a-2',
        timestamp: new Date(2000).toISOString(),
        uuid: 'a1',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.ts' } },
          ],
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'ws-a-2',
        timestamp: new Date(3000).toISOString(),
        uuid: 'u2',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false },
          ],
        },
      },
    ].map(l => JSON.stringify(l)).join('\n');

    // Create session for workspace repo-b:dev with Bash tool
    const transcriptB = [
      {
        type: 'user',
        sessionId: 'ws-b-2',
        timestamp: new Date(1000).toISOString(),
        uuid: 'u1',
        message: { content: 'Test B' },
      },
      {
        type: 'assistant',
        sessionId: 'ws-b-2',
        timestamp: new Date(2000).toISOString(),
        uuid: 'a1',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } },
          ],
          usage: {
            input_tokens: 2000,
            output_tokens: 1000,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'ws-b-2',
        timestamp: new Date(3000).toISOString(),
        uuid: 'u2',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false },
          ],
        },
      },
    ].map(l => JSON.stringify(l)).join('\n');

    writeFileSync(tmpTranscript2, transcriptA);
    writeFileSync(tmpTranscript3, transcriptB);

    insertSession(db, { session_id: 'ws-a-2', workspace: 'repo-a:main', cwd: '/tmp/a', transcript_path: tmpTranscript2, started_at: Date.now() });
    insertSession(db, { session_id: 'ws-b-2', workspace: 'repo-b:dev', cwd: '/tmp/b', transcript_path: tmpTranscript3, started_at: Date.now() });

    ingestSession(db, 'ws-a-2');
    ingestSession(db, 'ws-b-2');

    // Query for workspace repo-a:main
    const toolsA = toolsQuery(db, { workspace: 'repo-a:main' });
    expect(toolsA.tools.length).toBe(1);
    expect(toolsA.tools[0].tool).toBe('Read');
    expect(toolsA.tools[0].count).toBe(1);

    // Query for workspace repo-b:dev
    const toolsB = toolsQuery(db, { workspace: 'repo-b:dev' });
    expect(toolsB.tools.length).toBe(1);
    expect(toolsB.tools[0].tool).toBe('Bash');
    expect(toolsB.tools[0].count).toBe(1);

    // Query all workspaces
    const toolsAll = toolsQuery(db, {});
    expect(toolsAll.tools.length).toBe(2);

    db.close();
  });

  it('patternsQuery with anti-patterns', () => {
    const db = openDb(tmpDb);

    // Create session with failed Edit and Bash tool calls
    const transcript = [
      {
        type: 'user',
        sessionId: 'anti-pattern-test',
        timestamp: new Date(1000).toISOString(),
        uuid: 'u1',
        message: { content: 'Fix the code' },
      },
      {
        type: 'assistant',
        sessionId: 'anti-pattern-test',
        timestamp: new Date(2000).toISOString(),
        uuid: 'a1',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/app.ts', old_string: 'bad', new_string: 'good' } },
          ],
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'anti-pattern-test',
        timestamp: new Date(3000).toISOString(),
        uuid: 'u2',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'Edit failed: string not found', is_error: true },
          ],
        },
      },
      {
        type: 'assistant',
        sessionId: 'anti-pattern-test',
        timestamp: new Date(4000).toISOString(),
        uuid: 'a2',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'invalid-command' } },
          ],
          usage: {
            input_tokens: 800,
            output_tokens: 300,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'anti-pattern-test',
        timestamp: new Date(5000).toISOString(),
        uuid: 'u3',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu2', content: 'command not found', is_error: true },
          ],
        },
      },
    ].map(l => JSON.stringify(l)).join('\n');

    writeFileSync(tmpTranscript, transcript);

    insertSession(db, { session_id: 'anti-pattern-test', workspace: 'test:main', cwd: '/tmp/test', transcript_path: tmpTranscript, started_at: Date.now() });
    ingestSession(db, 'anti-pattern-test');

    const patterns = patternsQuery(db, {});
    expect(patterns.anti_patterns.length).toBeGreaterThan(0);

    // Check for edit-retry anti-pattern
    const editRetry = patterns.anti_patterns.find(p => p.pattern === 'edit-retry');
    expect(editRetry).toBeDefined();
    expect(editRetry!.frequency).toBeGreaterThan(0);
    expect(editRetry!.sessions_affected).toBe(1);

    // Check for bash-error anti-pattern
    const bashError = patterns.anti_patterns.find(p => p.pattern === 'bash-error');
    expect(bashError).toBeDefined();
    expect(bashError!.frequency).toBeGreaterThan(0);
    expect(bashError!.sessions_affected).toBe(1);

    db.close();
  });

  it('patternsQuery with outlier sessions', () => {
    const db = openDb(tmpDb);

    // Outlier detection uses threshold = 3 * avg(per-session input_tokens).
    // The avg includes the outlier itself, so we need many normal sessions
    // to dilute the average enough for the outlier to exceed 3x avg.
    // 5 normals at 1000 + 1 outlier at 50000:
    //   avg = (5000 + 50000) / 6 = 9166.67
    //   threshold = 27500
    //   50000 > 27500 → detected

    function makeNormalTranscript(sid: string): string {
      return [
        { type: 'user', sessionId: sid, timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Task' } },
        { type: 'assistant', sessionId: sid, timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.ts' } }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
        { type: 'user', sessionId: sid, timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }] } },
      ].map(l => JSON.stringify(l)).join('\n');
    }

    const outlierTranscript = [
      { type: 'user', sessionId: 'outlier-1', timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Complex task' } },
      { type: 'assistant', sessionId: 'outlier-1', timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/huge.ts' } }], usage: { input_tokens: 50000, output_tokens: 20000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
      { type: 'user', sessionId: 'outlier-1', timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }] } },
    ].map(l => JSON.stringify(l)).join('\n');

    // Write 5 normal transcripts to tmpTranscript2, and outlier to tmpTranscript3
    const normalPaths: string[] = [];
    for (let i = 0; i < 5; i++) {
      const p = `/tmp/sap-lib-outlier-normal-${process.pid}-${i}.jsonl`;
      normalPaths.push(p);
      writeFileSync(p, makeNormalTranscript(`normal-${i}`));
      insertSession(db, { session_id: `normal-${i}`, workspace: 'test:main', cwd: '/tmp/test', transcript_path: p, started_at: Date.now() });
      ingestSession(db, `normal-${i}`);
    }

    writeFileSync(tmpTranscript4, outlierTranscript);
    insertSession(db, { session_id: 'outlier-1', workspace: 'test:main', cwd: '/tmp/test', transcript_path: tmpTranscript4, started_at: Date.now() });
    ingestSession(db, 'outlier-1');

    const patterns = patternsQuery(db, {});
    expect(patterns.outlier_sessions.length).toBeGreaterThan(0);

    const outlier = patterns.outlier_sessions.find(s => s.session_id === 'outlier-1');
    expect(outlier).toBeDefined();
    expect(outlier!.value).toBe(50000);
    expect(outlier!.reason).toContain('average');

    // Cleanup extra files
    for (const p of normalPaths) { try { unlinkSync(p); } catch {} }

    db.close();
  });
});
