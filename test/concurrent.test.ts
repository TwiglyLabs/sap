import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import { openDb } from '../src/core/storage.ts';
import { SessionRepositorySqlite } from '../src/features/sessions/sqlite/session.repository.sqlite.ts';

describe('concurrent writers', () => {
  const tmpPath = `/tmp/sap-concurrent-${process.pid}.db`;

  afterEach(() => {
    try { unlinkSync(tmpPath); } catch {}
    try { unlinkSync(tmpPath + '-wal'); } catch {}
    try { unlinkSync(tmpPath + '-shm'); } catch {}
  });

  it('multiple connections can write without SQLITE_BUSY', () => {
    const db1 = openDb(tmpPath);
    const db2 = openDb(tmpPath);
    const repo1 = new SessionRepositorySqlite(db1);
    const repo2 = new SessionRepositorySqlite(db2);

    // Both connections insert sessions — WAL + busy_timeout should prevent errors
    repo1.insertSession({
      session_id: 'sess-a',
      workspace: 'repo:main',
      cwd: '/a',
      transcript_path: null,
      started_at: 1000,
    });

    repo2.insertSession({
      session_id: 'sess-b',
      workspace: 'repo:main',
      cwd: '/b',
      transcript_path: null,
      started_at: 2000,
    });

    // Both sessions should be visible from either connection
    expect(repo1.getSession('sess-a')).not.toBeNull();
    expect(repo1.getSession('sess-b')).not.toBeNull();
    expect(repo2.getSession('sess-a')).not.toBeNull();
    expect(repo2.getSession('sess-b')).not.toBeNull();

    db1.close();
    db2.close();
  });

  it('concurrent updates to different sessions succeed', () => {
    const db1 = openDb(tmpPath);
    const db2 = openDb(tmpPath);
    const repo1 = new SessionRepositorySqlite(db1);
    const repo2 = new SessionRepositorySqlite(db2);

    repo1.insertSession({
      session_id: 'sess-a',
      workspace: 'repo:main',
      cwd: '/a',
      transcript_path: null,
      started_at: 1000,
    });
    repo1.insertSession({
      session_id: 'sess-b',
      workspace: 'repo:main',
      cwd: '/b',
      transcript_path: null,
      started_at: 2000,
    });

    // Update from different connections
    repo1.updateSessionState('sess-a', 'idle', 3000);
    repo2.updateSessionState('sess-b', 'attention', 4000);

    const a = repo1.getSession('sess-a');
    const b = repo2.getSession('sess-b');
    expect(a!.state).toBe('idle');
    expect(b!.state).toBe('attention');

    db1.close();
    db2.close();
  });
});
