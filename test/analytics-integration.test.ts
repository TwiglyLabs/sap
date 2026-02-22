import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createSap, type Sap } from '../src/sap.ts';

describe('analytics integration', () => {
  let sap: Sap;
  let tmpDir: string;

  beforeEach(() => {
    sap = createSap({ dbPath: ':memory:' });
    tmpDir = mkdtempSync(join(tmpdir(), 'sap-integration-'));
  });

  afterEach(() => {
    sap.close();
    rmSync(tmpDir, { recursive: true });
  });

  it('full lifecycle: record → ingest → query → analytics', async () => {
    // 1. Record a session via hooks
    const transcriptPath = join(tmpDir, 'transcript.jsonl');
    const payload = {
      session_id: 'int-1',
      cwd: tmpDir,
      transcript_path: transcriptPath,
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
      source: 'startup' as const,
    };

    await sap.recording.recordEvent('session-start', payload);
    await sap.recording.recordEvent('user-prompt', { ...payload, prompt: 'fix the bug' });
    await sap.recording.recordEvent('tool-use', { ...payload, tool_name: 'Read', tool_input: { file_path: '/src/app.ts' } });
    await sap.recording.recordEvent('tool-use', { ...payload, tool_name: 'Edit', tool_input: { file_path: '/src/app.ts' } });
    await sap.recording.recordEvent('turn-complete', payload);
    await sap.recording.recordEvent('session-end', { ...payload, reason: 'done' });

    // 2. Write a transcript file
    const transcriptLines = [
      { type: 'user', sessionId: 'int-1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1', message: { role: 'user', content: 'fix the bug' } },
      { type: 'assistant', sessionId: 'int-1', timestamp: '2026-02-14T10:00:05.000Z', uuid: 'u2', message: {
        role: 'assistant', model: 'claude-sonnet-4-5-20250929',
        content: [
          { type: 'text', text: 'Let me read the file.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/src/app.ts' } },
        ],
        usage: { input_tokens: 5000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 },
      }},
      { type: 'user', sessionId: 'int-1', timestamp: '2026-02-14T10:00:06.000Z', uuid: 'u3', message: {
        role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents' }],
      }},
      { type: 'assistant', sessionId: 'int-1', timestamp: '2026-02-14T10:00:10.000Z', uuid: 'u4', message: {
        role: 'assistant', model: 'claude-sonnet-4-5-20250929',
        content: [
          { type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'bug', new_string: 'fix' } },
        ],
        usage: { input_tokens: 8000, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200 },
      }},
      { type: 'user', sessionId: 'int-1', timestamp: '2026-02-14T10:00:11.000Z', uuid: 'u5', message: {
        role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }],
      }},
      { type: 'assistant', sessionId: 'int-1', timestamp: '2026-02-14T10:00:15.000Z', uuid: 'u6', message: {
        role: 'assistant', model: 'claude-sonnet-4-5-20250929',
        content: [{ type: 'text', text: 'Fixed the bug.' }],
        usage: { input_tokens: 10000, output_tokens: 50, cache_read_input_tokens: 8000, cache_creation_input_tokens: 100 },
      }},
    ];
    writeFileSync(transcriptPath, transcriptLines.map(l => JSON.stringify(l)).join('\n'));

    // 3. Ingest
    const ingestResult = await sap.ingestion.ingestSession('int-1');
    expect(ingestResult.ok).toBe(true);
    if (!ingestResult.ok) return;
    expect(ingestResult.data.turns).toBe(1);
    expect(ingestResult.data.toolCalls).toBe(2);

    // 4. Raw query works
    const queryResult = sap.analytics.executeQuery('SELECT count(*) as n FROM turns');
    expect(queryResult.rows[0].n).toBe(1);

    // 5. Analytics summary works
    const summary = sap.analytics.summary({});
    expect(summary.sessions.total).toBe(1);
    expect(summary.tokens.total_input).toBe(23000);
    expect(summary.tools.total_calls).toBe(2);
  });
});
