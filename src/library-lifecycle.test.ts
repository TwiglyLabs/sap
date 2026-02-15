import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import {
  openDb,
  recordEvent,
  statusQuery,
  statusQueryGrouped,
  latestQuery,
  sessionsQuery,
  gcCommand,
  sweepCommand,
  getSession,
  insertSession,
  updateSessionState,
} from './index.ts';

describe('library lifecycle parity', () => {
  const tmpDb = `/tmp/sap-lib-lifecycle-${process.pid}.db`;

  afterEach(() => {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) {
      try { unlinkSync(f); } catch {}
    }
  });

  it('full session lifecycle: start → tool-use → idle → attention → end', () => {
    const db = openDb(tmpDb);
    const payload = {
      session_id: 'lifecycle-001',
      cwd: '/tmp/repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: '',
    };

    // Start
    recordEvent(db, 'session-start', { ...payload, source: 'startup' as const });
    expect(getSession(db, 'lifecycle-001')!.state).toBe('active');

    // Tool use
    recordEvent(db, 'tool-use', { ...payload, tool_name: 'Bash', tool_input: { command: 'npm test' } });
    const s1 = getSession(db, 'lifecycle-001')!;
    expect(s1.state).toBe('active');
    expect(s1.last_tool).toBe('Bash');
    expect(s1.last_tool_detail).toBe('npm test');

    // Turn complete → idle
    recordEvent(db, 'turn-complete', payload);
    expect(getSession(db, 'lifecycle-001')!.state).toBe('idle');

    // User prompt → active again
    recordEvent(db, 'user-prompt', { ...payload, prompt: 'now fix the CSS' });
    expect(getSession(db, 'lifecycle-001')!.state).toBe('active');

    // Attention permission
    recordEvent(db, 'attention-permission', payload);
    expect(getSession(db, 'lifecycle-001')!.state).toBe('attention');

    // End
    recordEvent(db, 'session-end', { ...payload, reason: 'user_exit' });
    expect(getSession(db, 'lifecycle-001')!.state).toBe('stopped');

    db.close();
  });

  it('statusQuery returns only non-stopped sessions', () => {
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 'active-one', cwd: '/tmp/a', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });
    recordEvent(db, 'session-start', {
      session_id: 'stopped-one', cwd: '/tmp/b', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });
    recordEvent(db, 'session-end', {
      session_id: 'stopped-one', cwd: '/tmp/b', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', reason: 'done',
    });

    const status = statusQuery(db);
    expect(status.sessions.length).toBe(1);
    expect(status.sessions[0].session_id).toBe('active-one');

    db.close();
  });

  it('statusQueryGrouped groups by workspace', () => {
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 's1', cwd: '/tmp/a', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });
    recordEvent(db, 'session-start', {
      session_id: 's2', cwd: '/tmp/a', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });

    const grouped = statusQueryGrouped(db);
    const workspaces = Object.keys(grouped.workspaces);
    expect(workspaces.length).toBeGreaterThan(0);

    // Both sessions should be under the same workspace
    const ws = grouped.workspaces[workspaces[0]];
    expect(ws.length).toBe(2);

    db.close();
  });

  it('sweepCommand marks stale sessions as stopped', () => {
    const db = openDb(tmpDb);

    // Insert a session with old last_event_at
    insertSession(db, {
      session_id: 'stale-one',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: Date.now() - 20 * 60 * 1000, // 20 min ago
    });
    updateSessionState(db, 'stale-one', 'active', Date.now() - 20 * 60 * 1000);

    const swept = sweepCommand(db, 10 * 60 * 1000); // 10 min threshold
    expect(swept).toBe(1);
    expect(getSession(db, 'stale-one')!.state).toBe('stopped');

    db.close();
  });

  it('gcCommand deletes old stopped sessions', () => {
    const db = openDb(tmpDb);

    // Insert a session that ended 40 days ago
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    insertSession(db, {
      session_id: 'old-one',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: fortyDaysAgo,
    });
    updateSessionState(db, 'old-one', 'stopped', fortyDaysAgo);

    const deleted = gcCommand(db, 30 * 24 * 60 * 60 * 1000); // 30 day threshold
    expect(deleted).toBe(1);
    expect(getSession(db, 'old-one')).toBeNull();

    db.close();
  });

  it('sessionsQuery respects workspace filter and limit', () => {
    const db = openDb(tmpDb);

    for (let i = 0; i < 5; i++) {
      insertSession(db, {
        session_id: `s${i}`,
        workspace: i < 3 ? 'repo:main' : 'repo:dev',
        cwd: '/tmp',
        transcript_path: null,
        started_at: Date.now() - i * 1000,
      });
    }

    const all = sessionsQuery(db, { limit: 100 });
    expect(all.length).toBe(5);

    const mainOnly = sessionsQuery(db, { workspace: 'repo:main', limit: 100 });
    expect(mainOnly.length).toBe(3);

    const limited = sessionsQuery(db, { limit: 2 });
    expect(limited.length).toBe(2);

    db.close();
  });

  it('latestQuery returns most recent session for workspace', () => {
    const db = openDb(tmpDb);

    insertSession(db, {
      session_id: 'older',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: 1000,
    });
    insertSession(db, {
      session_id: 'newer',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: 2000,
    });

    const latest = latestQuery(db, 'repo:main');
    expect(latest).not.toBeNull();
    expect(latest!.session_id).toBe('newer');

    const none = latestQuery(db, 'nonexistent:workspace');
    expect(none).toBeNull();

    db.close();
  });
});
