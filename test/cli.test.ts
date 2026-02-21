import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { execFileSync } from 'child_process';
import { unlinkSync } from 'fs';
import { join } from 'path';

const SAP_BIN = join(__dirname, '..', 'dist', 'sap.cjs');
const tmpDb = `/tmp/sap-cli-test-${process.pid}.db`;

function sap(args: string[], input?: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execFileSync('node', [SAP_BIN, ...args], {
      encoding: 'utf-8',
      env: { ...process.env, SAP_DB_PATH: tmpDb },
      input,
      timeout: 10000,
    });
    return { stdout, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: e.stdout ?? '',
      stderr: e.stderr ?? '',
      exitCode: e.status ?? 1,
    };
  }
}

describe('CLI integration', () => {
  beforeAll(() => {
    execFileSync('node', [join(__dirname, '..', 'build.mjs')], {
      encoding: 'utf-8',
      timeout: 30000,
    });
  });

  afterEach(() => {
    try { unlinkSync(tmpDb); } catch {}
    try { unlinkSync(tmpDb + '-wal'); } catch {}
    try { unlinkSync(tmpDb + '-shm'); } catch {}
  });

  it('record with valid JSON exits 0', () => {
    const input = JSON.stringify({
      session_id: 'cli-test-1',
      cwd: '/tmp/fakerepo',
      transcript_path: '/tmp/t.jsonl',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
      source: 'startup',
    });
    const result = sap(['record', '--event', 'session-start'], input);
    expect(result.exitCode).toBe(0);
  });

  it('record with bad JSON exits 2 with error on stderr', () => {
    const result = sap(['record', '--event', 'session-start'], 'not json');
    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('Invalid JSON');
  });

  it('status --json returns valid JSON', () => {
    // First record a session
    const input = JSON.stringify({
      session_id: 'cli-test-2',
      cwd: '/tmp/fakerepo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
      source: 'startup',
    });
    sap(['record', '--event', 'session-start'], input);

    const result = sap(['status', '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('sessions');
    expect(Array.isArray(parsed.sessions)).toBe(true);
  });

  it('--help contains program description', () => {
    const result = sap(['--help']);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain('Session Awareness Protocol');
  });

  it('record with unknown event type exits 1', () => {
    const input = JSON.stringify({ session_id: 'cli-test-bad', cwd: '/tmp/fakerepo' });
    const result = sap(['record', '--event', 'bogus-event'], input);
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown event type');
  });

  it('latest --json wraps session in { session } envelope', () => {
    const input = JSON.stringify({
      session_id: 'cli-test-latest',
      cwd: '/tmp/fakerepo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
      source: 'startup',
    });
    sap(['record', '--event', 'session-start'], input);

    // Discover the resolved workspace name from status
    const status = sap(['status', '--json']);
    const workspace = JSON.parse(status.stdout).sessions[0].workspace;

    const result = sap(['latest', '--workspace', workspace, '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('session');
    expect(parsed.session).not.toBeNull();
    expect(parsed.session.session_id).toBe('cli-test-latest');
  });

  it('latest --json returns { session: null } when no session found', () => {
    const result = sap(['latest', '--workspace', 'nonexistent', '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toEqual({ session: null });
  });

  it('latest without --json exits 1 when no session found', () => {
    const result = sap(['latest', '--workspace', 'nonexistent']);
    expect(result.exitCode).toBe(1);
    expect(result.stdout).toContain('No sessions found');
  });

  it('sessions --json wraps in { sessions } envelope', () => {
    const input = JSON.stringify({
      session_id: 'cli-test-sessions',
      cwd: '/tmp/fakerepo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
      source: 'startup',
    });
    sap(['record', '--event', 'session-start'], input);

    const result = sap(['sessions', '--json']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('sessions');
    expect(Array.isArray(parsed.sessions)).toBe(true);
    expect(parsed.sessions.length).toBeGreaterThan(0);
  });

  it('query returns { rows } envelope for valid SQL', () => {
    const result = sap(['query', 'SELECT count(*) as n FROM sessions']);
    expect(result.exitCode).toBe(0);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('rows');
    expect(Array.isArray(parsed.rows)).toBe(true);
    expect(parsed.rows[0]).toHaveProperty('n');
  });

  it('query returns { error } and exit code 1 for write statements', () => {
    const result = sap(['query', 'DELETE FROM sessions']);
    expect(result.exitCode).toBe(1);
    const parsed = JSON.parse(result.stdout);
    expect(parsed).toHaveProperty('error');
    expect(parsed.error).toBeTruthy();
  });
});
