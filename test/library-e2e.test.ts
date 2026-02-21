import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, unlinkSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

/**
 * E2E test: imports from the built dist/index.js artifact.
 * Requires `npm run test:e2e` (which runs build first) or a manual
 * `node build.mjs` before running this test directly.
 */
describe('library e2e (built artifact)', () => {
  const distPath = join(__dirname, '..', 'dist', 'index.js');
  const tmpDb = `/tmp/sap-e2e-${process.pid}.db`;
  let lib: Record<string, any>;

  beforeAll(async () => {
    if (!existsSync(distPath)) {
      throw new Error(
        'dist/index.js not found. Run "npm run test:e2e" or "node build.mjs" first.',
      );
    }
    lib = await import(distPath);
  });

  afterAll(() => {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) {
      try { unlinkSync(f); } catch {}
    }
  });

  it('dist/index.js exports all expected functions and classes', () => {
    // Factory
    expect(typeof lib.createSap).toBe('function');

    // Core
    expect(typeof lib.openDb).toBe('function');
    expect(typeof lib.DEFAULT_DB_PATH).toBe('string');
    expect(typeof lib.parseDuration).toBe('function');
    expect(typeof lib.STALE_THRESHOLD_MS).toBe('number');

    // Services
    expect(typeof lib.SessionService).toBe('function');
    expect(typeof lib.RecordingService).toBe('function');
    expect(typeof lib.WorkspaceService).toBe('function');
    expect(typeof lib.IngestionService).toBe('function');
    expect(typeof lib.AnalyticsService).toBe('function');

    // Utilities
    expect(typeof lib.parsePayload).toBe('function');
    expect(typeof lib.resolveWorkspaceFromGit).toBe('function');
    expect(typeof lib.buildWhereClause).toBe('function');
    expect(typeof lib.parseAnalyticsOptions).toBe('function');
    expect(typeof lib.parseTranscriptLine).toBe('function');
    expect(typeof lib.groupIntoTurns).toBe('function');
    expect(typeof lib.extractToolDetail).toBe('function');
  });

  it('full workflow through built artifact', () => {
    const sap = lib.createSap({ dbPath: tmpDb });

    // Start a session
    sap.recording.recordEvent('session-start', {
      session_id: 'e2e-001',
      cwd: '/tmp/e2e-repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'session-start',
      source: 'startup',
    });

    // Query via service
    const status = sap.sessions.status();
    expect(status.sessions.length).toBe(1);
    expect(status.sessions[0].session_id).toBe('e2e-001');

    // Tool use
    sap.recording.recordEvent('tool-use', {
      session_id: 'e2e-001',
      cwd: '/tmp/e2e-repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'tool-use',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/e2e-repo/index.ts' },
    });

    const session = sap.sessions.status().sessions[0];
    expect(session.last_tool).toBe('Read');

    // Raw query
    const qr = sap.analytics.executeQuery('SELECT count(*) as n FROM sessions');
    expect(qr.rows[0].n).toBe(1);
    expect(qr.error).toBeUndefined();

    // Write query blocked
    const bad = sap.analytics.executeQuery('DELETE FROM sessions');
    expect(bad.error).toBeDefined();

    // End session
    sap.recording.recordEvent('session-end', {
      session_id: 'e2e-001',
      cwd: '/tmp/e2e-repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'session-end',
      reason: 'user_exit',
    });

    expect(sap.sessions.status().sessions.length).toBe(0);
    sap.close();
  });

  it('dist/index.js does not contain chalk or commander', () => {
    const content = readFileSync(distPath, 'utf-8');
    expect(content).not.toContain('chalk');
    expect(content).not.toContain('commander');
  });

  it('dist/index.d.ts exists and contains key exports', () => {
    const dtsPath = distPath.replace('.js', '.d.ts');
    expect(existsSync(dtsPath)).toBe(true);

    const content = readFileSync(dtsPath, 'utf-8');
    expect(content).toContain('openDb');
    expect(content).toContain('Session');
    expect(content).toContain('createSap');
  });

  it('dist/index.js.map exists (sourcemap)', () => {
    expect(existsSync(distPath + '.map')).toBe(true);
  });

  it('ingestion + analytics through built artifact', () => {
    const dbPath = `/tmp/sap-e2e-ingest-${process.pid}.db`;
    const transcriptPath = `/tmp/sap-e2e-transcript-${process.pid}.jsonl`;

    try {
      const sap = lib.createSap({ dbPath });

      const lines = [
        { type: 'user', sessionId: 'e2e-ingest', timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Fix the bug' } },
        { type: 'assistant', sessionId: 'e2e-ingest', timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/app.ts' } }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 } } },
        { type: 'user', sessionId: 'e2e-ingest', timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false }] } },
        { type: 'assistant', sessionId: 'e2e-ingest', timestamp: new Date(4000).toISOString(), uuid: 'a2', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'a', new_string: 'b' } }], usage: { input_tokens: 800, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
        { type: 'user', sessionId: 'e2e-ingest', timestamp: new Date(5000).toISOString(), uuid: 'u3', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok', is_error: false }] } },
      ];
      writeFileSync(transcriptPath, lines.map(l => JSON.stringify(l)).join('\n'));

      // Record session-start to create the session (uses workspace resolution)
      sap.recording.recordEvent('session-start', {
        session_id: 'e2e-ingest', cwd: '/tmp/e2e', transcript_path: transcriptPath,
        permission_mode: 'default', hook_event_name: 'session-start', source: 'startup',
      });

      // Ingest
      const ingestResult = sap.ingestion.ingestSession('e2e-ingest');
      expect(ingestResult.turns).toBe(1);
      expect(ingestResult.toolCalls).toBe(2);

      // Analytics
      const summary = sap.analytics.summary({});
      expect(summary.sessions.total).toBe(1);
      expect(summary.tokens.total_input).toBe(1800);
      expect(summary.tokens.total_output).toBe(800);
      expect(summary.tools.total_calls).toBe(2);

      const tools = sap.analytics.tools({});
      expect(tools.tools.length).toBe(2);
      const readTool = tools.tools.find((t: any) => t.tool === 'Read');
      expect(readTool).toBeDefined();
      expect(readTool.count).toBe(1);

      sap.close();
    } finally {
      for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm', transcriptPath]) {
        try { unlinkSync(f); } catch {}
      }
    }
  });
});
