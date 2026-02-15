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

  it('dist/index.js exports all expected functions', () => {
    // Core database
    expect(typeof lib.openDb).toBe('function');
    expect(typeof lib.DEFAULT_DB_PATH).toBe('string');
    expect(typeof lib.insertSession).toBe('function');
    expect(typeof lib.getSession).toBe('function');

    // Commands
    expect(typeof lib.recordEvent).toBe('function');
    expect(typeof lib.statusQuery).toBe('function');
    expect(typeof lib.latestQuery).toBe('function');
    expect(typeof lib.sessionsQuery).toBe('function');
    expect(typeof lib.gcCommand).toBe('function');
    expect(typeof lib.sweepCommand).toBe('function');
    expect(typeof lib.ingestSession).toBe('function');
    expect(typeof lib.executeQuery).toBe('function');

    // Analytics
    expect(typeof lib.summaryQuery).toBe('function');
    expect(typeof lib.toolsQuery).toBe('function');
    expect(typeof lib.sessionsAnalyticsQuery).toBe('function');
    expect(typeof lib.patternsQuery).toBe('function');

    // Utilities
    expect(typeof lib.resolveWorkspace).toBe('function');
    expect(typeof lib.parseTranscriptLine).toBe('function');
    expect(typeof lib.extractToolDetail).toBe('function');
  });

  it('full workflow through built artifact', () => {
    const db = lib.openDb(tmpDb);

    // Start a session
    lib.recordEvent(db, 'session-start', {
      session_id: 'e2e-001',
      cwd: '/tmp/e2e-repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'session-start',
      source: 'startup',
    });

    // Query via library
    const status = lib.statusQuery(db);
    expect(status.sessions.length).toBe(1);
    expect(status.sessions[0].session_id).toBe('e2e-001');

    // Tool use
    lib.recordEvent(db, 'tool-use', {
      session_id: 'e2e-001',
      cwd: '/tmp/e2e-repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'tool-use',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/e2e-repo/index.ts' },
    });

    const session = lib.getSession(db, 'e2e-001');
    expect(session.last_tool).toBe('Read');

    // Raw query
    const qr = lib.executeQuery(db, 'SELECT count(*) as n FROM sessions');
    expect(qr.rows[0].n).toBe(1);
    expect(qr.error).toBeUndefined();

    // Write query blocked
    const bad = lib.executeQuery(db, 'DELETE FROM sessions');
    expect(bad.error).toBeDefined();

    // End session
    lib.recordEvent(db, 'session-end', {
      session_id: 'e2e-001',
      cwd: '/tmp/e2e-repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'session-end',
      reason: 'user_exit',
    });

    expect(lib.getSession(db, 'e2e-001').state).toBe('stopped');
    db.close();
  });

  it('dist/index.js does not contain chalk or commander', () => {
    const content = readFileSync(distPath, 'utf-8');
    // These strings would appear if CLI deps leaked into the library bundle
    expect(content).not.toContain('chalk');
    expect(content).not.toContain('commander');
  });

  it('dist/index.d.ts exists and contains key exports', () => {
    const dtsPath = distPath.replace('.js', '.d.ts');
    expect(existsSync(dtsPath)).toBe(true);

    const content = readFileSync(dtsPath, 'utf-8');
    expect(content).toContain('openDb');
    expect(content).toContain('Session');
    expect(content).toContain('StatusResult');
    expect(content).toContain('SummaryResult');
  });

  it('dist/index.js.map exists (sourcemap)', () => {
    expect(existsSync(distPath + '.map')).toBe(true);
  });

  it('ingestion + analytics through built artifact', () => {
    const dbPath = `/tmp/sap-e2e-ingest-${process.pid}.db`;
    const transcriptPath = `/tmp/sap-e2e-transcript-${process.pid}.jsonl`;

    try {
      const db = lib.openDb(dbPath);

      // Create a proper JSONL transcript
      const lines = [
        { type: 'user', sessionId: 'e2e-ingest', timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Fix the bug' } },
        { type: 'assistant', sessionId: 'e2e-ingest', timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/app.ts' } }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 } } },
        { type: 'user', sessionId: 'e2e-ingest', timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false }] } },
        { type: 'assistant', sessionId: 'e2e-ingest', timestamp: new Date(4000).toISOString(), uuid: 'a2', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'a', new_string: 'b' } }], usage: { input_tokens: 800, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
        { type: 'user', sessionId: 'e2e-ingest', timestamp: new Date(5000).toISOString(), uuid: 'u3', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok', is_error: false }] } },
      ];
      writeFileSync(transcriptPath, lines.map(l => JSON.stringify(l)).join('\n'));

      // Insert session with known workspace (avoid git resolution)
      lib.insertSession(db, { session_id: 'e2e-ingest', workspace: 'e2e:main', cwd: '/tmp/e2e', transcript_path: transcriptPath, started_at: Date.now() });

      // Ingest
      const ingestResult = lib.ingestSession(db, 'e2e-ingest');
      expect(ingestResult.turns).toBe(1);
      expect(ingestResult.toolCalls).toBe(2);

      // Analytics: summaryQuery takes (db, FilterOptions)
      const summary = lib.summaryQuery(db, {});
      expect(summary.sessions.total).toBe(1);
      expect(summary.tokens.total_input).toBe(1800);
      expect(summary.tokens.total_output).toBe(800);
      expect(summary.tools.total_calls).toBe(2);

      // toolsQuery
      const tools = lib.toolsQuery(db, {});
      expect(tools.tools.length).toBe(2);
      const readTool = tools.tools.find((t: any) => t.tool === 'Read');
      expect(readTool).toBeDefined();
      expect(readTool.count).toBe(1);

      db.close();
    } finally {
      for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm', transcriptPath]) {
        try { unlinkSync(f); } catch {}
      }
    }
  });

  it('turn/tool retrieval through built artifact', () => {
    const dbPath = `/tmp/sap-e2e-turns-${process.pid}.db`;
    const transcriptPath = `/tmp/sap-e2e-turns-transcript-${process.pid}.jsonl`;

    try {
      const db = lib.openDb(dbPath);

      const lines = [
        { type: 'user', sessionId: 'e2e-turns', timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Write a file' } },
        { type: 'assistant', sessionId: 'e2e-turns', timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Write', input: { file_path: '/tmp/test.txt', content: 'hello' } }], usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
        { type: 'user', sessionId: 'e2e-turns', timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }] } },
      ];
      writeFileSync(transcriptPath, lines.map(l => JSON.stringify(l)).join('\n'));

      lib.insertSession(db, { session_id: 'e2e-turns', workspace: 'e2e:main', cwd: '/tmp/e2e', transcript_path: transcriptPath, started_at: Date.now() });
      lib.ingestSession(db, 'e2e-turns');

      // Get turns
      const turns = lib.getSessionTurns(db, 'e2e-turns');
      expect(turns.length).toBe(1);
      expect(turns[0].turn_number).toBe(1);
      expect(turns[0].prompt_text).toBe('Write a file');
      expect(turns[0].input_tokens).toBe(500);

      // Get tool calls for the turn
      const toolCalls = lib.getTurnToolCalls(db, turns[0].id);
      expect(toolCalls.length).toBe(1);
      expect(toolCalls[0].tool_name).toBe('Write');
      expect(toolCalls[0].tool_input_summary).toBe('test.txt');
      expect(toolCalls[0].success).toBe(1);

      db.close();
    } finally {
      for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm', transcriptPath]) {
        try { unlinkSync(f); } catch {}
      }
    }
  });

  it('getSessionEvents through built artifact', () => {
    const dbPath = `/tmp/sap-e2e-events-${process.pid}.db`;

    try {
      const db = lib.openDb(dbPath);

      lib.recordEvent(db, 'session-start', {
        session_id: 'e2e-events',
        cwd: '/tmp/e2e-repo',
        transcript_path: '',
        permission_mode: 'default',
        hook_event_name: 'session-start',
        source: 'startup',
      });

      lib.recordEvent(db, 'tool-use', {
        session_id: 'e2e-events',
        cwd: '/tmp/e2e-repo',
        transcript_path: '',
        permission_mode: 'default',
        hook_event_name: 'tool-use',
        tool_name: 'Bash',
        tool_input: { command: 'ls' },
      });

      lib.recordEvent(db, 'tool-use', {
        session_id: 'e2e-events',
        cwd: '/tmp/e2e-repo',
        transcript_path: '',
        permission_mode: 'default',
        hook_event_name: 'tool-use',
        tool_name: 'Read',
        tool_input: { file_path: '/tmp/test.txt' },
      });

      // getSessionEvents returns EventRow[] with event_type and data (JSON string)
      const events = lib.getSessionEvents(db, 'e2e-events');
      expect(events.length).toBe(3);
      expect(events[0].event_type).toBe('session-start');
      expect(events[1].event_type).toBe('tool-use');
      expect(events[2].event_type).toBe('tool-use');

      // Tool info is stored in the data JSON field
      const e1data = JSON.parse(events[1].data);
      expect(e1data.tool_name).toBe('Bash');
      const e2data = JSON.parse(events[2].data);
      expect(e2data.tool_name).toBe('Read');

      db.close();
    } finally {
      for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
        try { unlinkSync(f); } catch {}
      }
    }
  });

  it('getActiveSessions through built artifact', () => {
    const dbPath = `/tmp/sap-e2e-active-${process.pid}.db`;

    try {
      const db = lib.openDb(dbPath);

      // Use insertSession directly to control workspace values
      lib.insertSession(db, { session_id: 'active-1', workspace: 'repo-a:main', cwd: '/tmp/a', transcript_path: null, started_at: Date.now() });
      lib.insertSession(db, { session_id: 'active-2', workspace: 'repo-a:main', cwd: '/tmp/a', transcript_path: null, started_at: Date.now() });
      lib.insertSession(db, { session_id: 'active-3', workspace: 'repo-b:dev', cwd: '/tmp/b', transcript_path: null, started_at: Date.now() });

      // Stop one session
      lib.updateSessionState(db, 'active-2', 'stopped', Date.now());

      // All active
      const allActive = lib.getActiveSessions(db);
      expect(allActive.length).toBe(2);
      expect(allActive.some((s: any) => s.session_id === 'active-1')).toBe(true);
      expect(allActive.some((s: any) => s.session_id === 'active-3')).toBe(true);

      // Filtered by workspace
      const wsA = lib.getActiveSessions(db, 'repo-a:main');
      expect(wsA.length).toBe(1);
      expect(wsA[0].session_id).toBe('active-1');

      const wsB = lib.getActiveSessions(db, 'repo-b:dev');
      expect(wsB.length).toBe(1);
      expect(wsB[0].session_id).toBe('active-3');

      db.close();
    } finally {
      for (const f of [dbPath, dbPath + '-wal', dbPath + '-shm']) {
        try { unlinkSync(f); } catch {}
      }
    }
  });
});
