import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import {
  openDb,
  insertSession,
  upsertSession,
  getSession,
  updateSessionState,
  getActiveSessions,
  insertEvent,
  getSessionEvents,
  upsertWorkspace,
  getCachedWorkspace,
  getLatestSession,
  getSessionHistory,
  deleteStaleSessions,
} from './db.ts';

describe('openDb', () => {
  it('creates tables in a new database', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('sessions');
    expect(names).toContain('events');
    expect(names).toContain('workspaces');
    db.close();
  });

  it('sets busy_timeout pragma', () => {
    const db = openDb(':memory:');
    const result = db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    expect(result.timeout).toBe(3000);
    db.close();
  });

  it('enables WAL mode on file-based database', () => {
    const tmpPath = `/tmp/sap-test-${Date.now()}.db`;
    const db = openDb(tmpPath);
    const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(result.journal_mode).toBe('wal');
    db.close();
    const { unlinkSync } = require('fs');
    try { unlinkSync(tmpPath); unlinkSync(tmpPath + '-wal'); unlinkSync(tmpPath + '-shm'); } catch {}
  });
});

describe('session operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('inserts and retrieves a session', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: '/tmp/transcript.jsonl',
      started_at: 1000,
    });

    const session = getSession(db, 'sess-1');
    expect(session).not.toBeNull();
    expect(session!.session_id).toBe('sess-1');
    expect(session!.workspace).toBe('myrepo:main');
    expect(session!.state).toBe('active');
    expect(session!.started_at).toBe(1000);
    expect(session!.last_event_at).toBe(1000);
  });

  it('upserts session on duplicate session_id', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: null,
      started_at: 1000,
    });
    updateSessionState(db, 'sess-1', 'stopped', 2000, { tool: 'Edit', detail: 'foo.ts' });

    const stopped = getSession(db, 'sess-1');
    expect(stopped!.state).toBe('stopped');
    expect(stopped!.ended_at).toBe(2000);

    // Upsert should reset to active, clear ended_at and tool info
    upsertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:dev',
      cwd: '/home/user/myrepo',
      transcript_path: '/new/path',
      started_at: 3000,
    });

    const restarted = getSession(db, 'sess-1');
    expect(restarted!.state).toBe('active');
    expect(restarted!.workspace).toBe('myrepo:dev');
    expect(restarted!.started_at).toBe(3000);
    expect(restarted!.ended_at).toBeNull();
    expect(restarted!.last_tool).toBeNull();
    expect(restarted!.last_tool_detail).toBeNull();
  });

  it('updates session state', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: null,
      started_at: 1000,
    });

    updateSessionState(db, 'sess-1', 'attention', 2000);
    const session = getSession(db, 'sess-1');
    expect(session!.state).toBe('attention');
    expect(session!.last_event_at).toBe(2000);
  });

  it('updates session state with tool info', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: null,
      started_at: 1000,
    });

    updateSessionState(db, 'sess-1', 'active', 2000, { tool: 'Edit', detail: 'app.ts' });
    const session = getSession(db, 'sess-1');
    expect(session!.last_tool).toBe('Edit');
    expect(session!.last_tool_detail).toBe('app.ts');
  });

  it('sets ended_at when state is stopped', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: null,
      started_at: 1000,
    });

    updateSessionState(db, 'sess-1', 'stopped', 3000);
    const session = getSession(db, 'sess-1');
    expect(session!.state).toBe('stopped');
    expect(session!.ended_at).toBe(3000);
  });

  it('returns active and non-stopped sessions', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'repo-a:main',
      cwd: '/a',
      transcript_path: null,
      started_at: 1000,
    });
    insertSession(db, {
      session_id: 'sess-2',
      workspace: 'repo-b:main',
      cwd: '/b',
      transcript_path: null,
      started_at: 2000,
    });
    updateSessionState(db, 'sess-1', 'stopped', 3000);

    const active = getActiveSessions(db);
    expect(active).toHaveLength(1);
    expect(active[0].session_id).toBe('sess-2');
  });

  it('filters sessions by workspace', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'repo-a:main',
      cwd: '/a',
      transcript_path: null,
      started_at: 1000,
    });
    insertSession(db, {
      session_id: 'sess-2',
      workspace: 'repo-b:dev',
      cwd: '/b',
      transcript_path: null,
      started_at: 2000,
    });

    const filtered = getActiveSessions(db, 'repo-a:main');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].session_id).toBe('sess-1');
  });
});

describe('event operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: null,
      started_at: 1000,
    });
  });

  it('inserts and retrieves events', () => {
    insertEvent(db, {
      session_id: 'sess-1',
      event_type: 'tool-use',
      data: JSON.stringify({ tool_name: 'Edit' }),
      created_at: 2000,
    });

    const events = getSessionEvents(db, 'sess-1');
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('tool-use');
    expect(events[0].session_id).toBe('sess-1');
  });

  it('returns events in chronological order', () => {
    insertEvent(db, { session_id: 'sess-1', event_type: 'tool-use', data: null, created_at: 2000 });
    insertEvent(db, { session_id: 'sess-1', event_type: 'user-prompt', data: null, created_at: 3000 });
    insertEvent(db, { session_id: 'sess-1', event_type: 'tool-use', data: null, created_at: 4000 });

    const events = getSessionEvents(db, 'sess-1');
    expect(events).toHaveLength(3);
    expect(events[0].created_at).toBe(2000);
    expect(events[2].created_at).toBe(4000);
  });
});

describe('workspace cache', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('caches and retrieves a workspace mapping', () => {
    upsertWorkspace(db, {
      cwd: '/home/user/myrepo',
      repo_name: 'myrepo',
      branch: 'main',
      workspace: 'myrepo:main',
      resolved_at: 1000,
    });

    const cached = getCachedWorkspace(db, '/home/user/myrepo');
    expect(cached).not.toBeNull();
    expect(cached!.workspace).toBe('myrepo:main');
  });

  it('returns null for uncached cwd', () => {
    const cached = getCachedWorkspace(db, '/nowhere');
    expect(cached).toBeNull();
  });

  it('upserts on conflict (branch change)', () => {
    upsertWorkspace(db, {
      cwd: '/home/user/myrepo',
      repo_name: 'myrepo',
      branch: 'main',
      workspace: 'myrepo:main',
      resolved_at: 1000,
    });
    upsertWorkspace(db, {
      cwd: '/home/user/myrepo',
      repo_name: 'myrepo',
      branch: 'dev',
      workspace: 'myrepo:dev',
      resolved_at: 2000,
    });

    const cached = getCachedWorkspace(db, '/home/user/myrepo');
    expect(cached!.workspace).toBe('myrepo:dev');
    expect(cached!.resolved_at).toBe(2000);
  });
});

describe('query helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('getLatestSession returns most recent session for workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: 2000 });
    updateSessionState(db, 's1', 'stopped', 1500);

    const latest = getLatestSession(db, 'repo:main');
    expect(latest!.session_id).toBe('s2');
  });

  it('getLatestSession returns stopped session if most recent', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: 1000 });
    updateSessionState(db, 's1', 'stopped', 2000);

    const latest = getLatestSession(db, 'repo:main');
    expect(latest!.state).toBe('stopped');
  });

  it('getSessionHistory returns N most recent sessions', () => {
    for (let i = 1; i <= 5; i++) {
      insertSession(db, { session_id: `s${i}`, workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: i * 1000 });
    }

    const history = getSessionHistory(db, { limit: 3 });
    expect(history).toHaveLength(3);
    expect(history[0].session_id).toBe('s5');
    expect(history[2].session_id).toBe('s3');
  });

  it('getSessionHistory filters by workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo-a:main', cwd: '/a', transcript_path: null, started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo-b:main', cwd: '/b', transcript_path: null, started_at: 2000 });

    const history = getSessionHistory(db, { workspace: 'repo-a:main', limit: 20 });
    expect(history).toHaveLength(1);
    expect(history[0].session_id).toBe('s1');
  });

  it('deleteStaleSessions removes old stopped sessions and their events', () => {
    const now = Date.now();
    const oldTime = now - 60000;
    insertSession(db, { session_id: 's-old', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: oldTime });
    updateSessionState(db, 's-old', 'stopped', oldTime + 100);
    insertEvent(db, { session_id: 's-old', event_type: 'tool-use', data: null, created_at: oldTime + 50 });

    insertSession(db, { session_id: 's-new', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: now });

    const deleted = deleteStaleSessions(db, 50000);
    expect(deleted).toBe(1);
    expect(getSession(db, 's-old')).toBeNull();
    expect(getSessionEvents(db, 's-old')).toHaveLength(0);
    expect(getSession(db, 's-new')).not.toBeNull();
  });

  it('deleteStaleSessions removes orphaned active sessions', () => {
    const oldTime = Date.now() - 60000;
    insertSession(db, { session_id: 's-orphan', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: oldTime });

    const deleted = deleteStaleSessions(db, 50000);
    expect(deleted).toBe(1);
    expect(getSession(db, 's-orphan')).toBeNull();
  });
});
