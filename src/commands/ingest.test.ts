import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type Database from 'better-sqlite3';
import { openDb, insertSession, getSession, getSessionTurns, getTurnToolCalls } from '../db.ts';
import { ingestSession, ingestBatch } from './ingest.ts';

function writeTranscript(dir: string, lines: object[]): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));
  return path;
}

describe('ingestSession', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = openDb(':memory:');
    tmpDir = mkdtempSync(join(tmpdir(), 'sap-test-'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it('ingests a simple one-turn transcript', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'fix the bug' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:05.000Z', uuid: 'u2',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'I fixed it.' }],
          usage: { input_tokens: 5000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 },
        },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });

    const result = ingestSession(db, 's1');
    expect(result.turns).toBe(1);
    expect(result.toolCalls).toBe(0);

    const turns = getSessionTurns(db, 's1');
    expect(turns).toHaveLength(1);
    expect(turns[0].prompt_text).toBe('fix the bug');
    expect(turns[0].input_tokens).toBe(5000);
    expect(turns[0].output_tokens).toBe(200);
    expect(turns[0].model).toBe('claude-sonnet-4-5-20250929');

    const session = getSession(db, 's1');
    expect(session!.ingested_at).not.toBeNull();
  });

  it('ingests tool calls and correlates with results', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'read the file' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:02.000Z', uuid: 'u2',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'text', text: 'Let me read it.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/src/app.ts' } },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:03.000Z', uuid: 'u3',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file content here' }],
        },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:05.000Z', uuid: 'u4',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'Done.' }],
          usage: { input_tokens: 200, output_tokens: 30 },
        },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });

    const result = ingestSession(db, 's1');
    expect(result.turns).toBe(1);
    expect(result.toolCalls).toBe(1);

    const turns = getSessionTurns(db, 's1');
    expect(turns[0].tool_call_count).toBe(1);

    const calls = getTurnToolCalls(db, turns[0].id);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('Read');
    expect(calls[0].tool_input_summary).toBe('app.ts');
    expect(calls[0].success).toBe(1);
  });

  it('detects tool call errors', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'edit the file' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:02.000Z', uuid: 'u2',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/a.ts', old_string: 'foo', new_string: 'bar' } }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:03.000Z', uuid: 'u3',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Error: old_string not found in file', is_error: true }],
        },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:05.000Z', uuid: 'u4',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'Let me try again.' }],
          usage: { input_tokens: 200, output_tokens: 30 },
        },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });
    ingestSession(db, 's1');

    const turns = getSessionTurns(db, 's1');
    const calls = getTurnToolCalls(db, turns[0].id);
    expect(calls[0].success).toBe(0);
    expect(calls[0].error_message).toContain('old_string not found');
  });

  it('skips already-ingested sessions without --force', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:01.000Z', uuid: 'u2',
        message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });

    ingestSession(db, 's1');
    const result = ingestSession(db, 's1');  // second call
    expect(result.skipped).toBe(true);
  });

  it('re-ingests with force flag', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:01.000Z', uuid: 'u2',
        message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });

    ingestSession(db, 's1');
    const result = ingestSession(db, 's1', { force: true });
    expect(result.skipped).toBe(false);
    expect(result.turns).toBe(1);

    // Should not have duplicate turns
    const turns = getSessionTurns(db, 's1');
    expect(turns).toHaveLength(1);
  });

  it('returns error for missing transcript file', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: '/nonexistent/transcript.jsonl', started_at: 1000 });

    const result = ingestSession(db, 's1');
    expect(result.error).toBeDefined();
  });

  it('returns error for session with no transcript path', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: 1000 });

    const result = ingestSession(db, 's1');
    expect(result.error).toBeDefined();
  });
});

describe('ingestBatch', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = openDb(':memory:');
    tmpDir = mkdtempSync(join(tmpdir(), 'sap-test-'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it('ingests all uninigested sessions', () => {
    const t1 = writeTranscript(join(tmpDir, '1'), [
      { type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:01.000Z', uuid: 'u2', message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);
    const t2 = writeTranscript(join(tmpDir, '2'), [
      { type: 'user', sessionId: 's2', timestamp: '2026-02-14T11:00:00.000Z', uuid: 'u3', message: { role: 'user', content: 'bye' } },
      { type: 'assistant', sessionId: 's2', timestamp: '2026-02-14T11:00:01.000Z', uuid: 'u4', message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'bye' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: t1, started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: t2, started_at: 2000 });

    const result = ingestBatch(db, {});
    expect(result.ingested).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('respects --since filter', () => {
    const recent = Date.now() - 1000;

    const t1 = writeTranscript(join(tmpDir, '1'), [
      { type: 'user', sessionId: 's1', timestamp: new Date(recent).toISOString(), uuid: 'u1', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', sessionId: 's1', timestamp: new Date(recent + 1000).toISOString(), uuid: 'u2', message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);

    const old = Date.now() - 86400 * 1000 * 10;  // 10 days ago

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: t1, started_at: recent });
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: '/fake', started_at: old });

    const result = ingestBatch(db, { sinceMs: 86400 * 1000 * 7 });  // 7 days
    expect(result.ingested).toBe(1);  // only s1
  });
});
