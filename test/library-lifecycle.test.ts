import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSap, type Sap } from '../src/sap.ts';
import { openDb } from '../src/core/storage.ts';
import { SessionRepositorySqlite } from '../src/features/sessions/sqlite/session.repository.sqlite.ts';
import { SessionService } from '../src/features/sessions/session.service.ts';

describe('library lifecycle parity', () => {
  let sap: Sap;

  beforeEach(() => {
    sap = createSap({ dbPath: ':memory:' });
  });

  afterEach(() => {
    sap.close();
  });

  it('full session lifecycle: start → tool-use → idle → attention → end', async () => {
    const payload = {
      session_id: 'lifecycle-001',
      cwd: '/tmp/repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: '',
    };

    await sap.recording.recordEvent('session-start', { ...payload, source: 'startup' as const });
    expect(sap.sessions.status().sessions[0].state).toBe('active');

    await sap.recording.recordEvent('tool-use', { ...payload, tool_name: 'Bash', tool_input: { command: 'npm test' } });
    const s1 = sap.sessions.status().sessions[0];
    expect(s1.state).toBe('active');
    expect(s1.last_tool).toBe('Bash');
    expect(s1.last_tool_detail).toBe('npm test');

    await sap.recording.recordEvent('turn-complete', payload);
    expect(sap.sessions.status().sessions[0].state).toBe('idle');

    await sap.recording.recordEvent('user-prompt', { ...payload, prompt: 'now fix the CSS' });
    expect(sap.sessions.status().sessions[0].state).toBe('active');

    await sap.recording.recordEvent('attention-permission', payload);
    expect(sap.sessions.status().sessions[0].state).toBe('attention');

    await sap.recording.recordEvent('session-end', { ...payload, reason: 'user_exit' });
    expect(sap.sessions.status().sessions.length).toBe(0);
  });

  it('status returns only non-stopped sessions', async () => {
    await sap.recording.recordEvent('session-start', {
      session_id: 'active-one', cwd: '/tmp/a', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });
    await sap.recording.recordEvent('session-start', {
      session_id: 'stopped-one', cwd: '/tmp/b', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });
    await sap.recording.recordEvent('session-end', {
      session_id: 'stopped-one', cwd: '/tmp/b', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', reason: 'done',
    });

    const status = sap.sessions.status();
    expect(status.sessions.length).toBe(1);
    expect(status.sessions[0].session_id).toBe('active-one');
  });

  it('statusGrouped groups by workspace', async () => {
    await sap.recording.recordEvent('session-start', {
      session_id: 's1', cwd: '/tmp/a', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });
    await sap.recording.recordEvent('session-start', {
      session_id: 's2', cwd: '/tmp/a', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });

    const grouped = sap.sessions.statusGrouped();
    const workspaces = Object.keys(grouped.workspaces);
    expect(workspaces.length).toBeGreaterThan(0);
    const ws = grouped.workspaces[workspaces[0]];
    expect(ws.length).toBe(2);
  });

  it('sweep marks stale sessions as stopped', () => {
    const db = openDb(':memory:');
    const repo = new SessionRepositorySqlite(db);
    repo.insertSession({
      session_id: 'stale-one',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: Date.now() - 20 * 60 * 1000,
    });
    repo.updateSessionState('stale-one', 'active', Date.now() - 20 * 60 * 1000);

    const sessionService = new SessionService(repo);
    const swept = sessionService.sweep(10 * 60 * 1000);
    expect(swept).toBe(1);
    expect(repo.getSession('stale-one')!.state).toBe('stopped');
    db.close();
  });

  it('gc deletes old stopped sessions', () => {
    const db = openDb(':memory:');
    const repo = new SessionRepositorySqlite(db);
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    repo.insertSession({
      session_id: 'old-one',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: fortyDaysAgo,
    });
    repo.updateSessionState('old-one', 'stopped', fortyDaysAgo);

    const sessionService = new SessionService(repo);
    const deleted = sessionService.gc(30 * 24 * 60 * 60 * 1000);
    expect(deleted).toBe(1);
    expect(repo.getSession('old-one')).toBeNull();
    db.close();
  });

  it('sessions respects workspace filter and limit', () => {
    const db = openDb(':memory:');
    const repo = new SessionRepositorySqlite(db);
    for (let i = 0; i < 5; i++) {
      repo.insertSession({
        session_id: `s${i}`,
        workspace: i < 3 ? 'repo:main' : 'repo:dev',
        cwd: '/tmp',
        transcript_path: null,
        started_at: Date.now() - i * 1000,
      });
    }

    const sessionService = new SessionService(repo);

    expect(sessionService.sessions({ limit: 100 }).length).toBe(5);
    expect(sessionService.sessions({ workspace: 'repo:main', limit: 100 }).length).toBe(3);
    expect(sessionService.sessions({ limit: 2 }).length).toBe(2);

    db.close();
  });

  it('latest returns most recent session for workspace', () => {
    const db = openDb(':memory:');
    const repo = new SessionRepositorySqlite(db);
    repo.insertSession({ session_id: 'older', workspace: 'repo:main', cwd: '/tmp', transcript_path: null, started_at: 1000 });
    repo.insertSession({ session_id: 'newer', workspace: 'repo:main', cwd: '/tmp', transcript_path: null, started_at: 2000 });

    const sessionService = new SessionService(repo);

    const latest = sessionService.latest('repo:main');
    expect(latest).not.toBeNull();
    expect(latest!.session_id).toBe('newer');

    expect(sessionService.latest('nonexistent:workspace')).toBeNull();

    db.close();
  });
});
