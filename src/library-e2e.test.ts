import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, unlinkSync, readFileSync } from 'fs';
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
});
