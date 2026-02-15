import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import { openDb, insertSession, updateSessionState, getSession } from './db.ts';

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

    // Both connections insert sessions — WAL + busy_timeout should prevent errors
    insertSession(db1, {
      session_id: 'sess-a',
      workspace: 'repo:main',
      cwd: '/a',
      transcript_path: null,
      started_at: 1000,
    });

    insertSession(db2, {
      session_id: 'sess-b',
      workspace: 'repo:main',
      cwd: '/b',
      transcript_path: null,
      started_at: 2000,
    });

    // Both sessions should be visible from either connection
    expect(getSession(db1, 'sess-a')).not.toBeNull();
    expect(getSession(db1, 'sess-b')).not.toBeNull();
    expect(getSession(db2, 'sess-a')).not.toBeNull();
    expect(getSession(db2, 'sess-b')).not.toBeNull();

    db1.close();
    db2.close();
  });

  it('concurrent updates to different sessions succeed', () => {
    const db1 = openDb(tmpPath);
    const db2 = openDb(tmpPath);

    insertSession(db1, {
      session_id: 'sess-a',
      workspace: 'repo:main',
      cwd: '/a',
      transcript_path: null,
      started_at: 1000,
    });
    insertSession(db1, {
      session_id: 'sess-b',
      workspace: 'repo:main',
      cwd: '/b',
      transcript_path: null,
      started_at: 2000,
    });

    // Update from different connections
    updateSessionState(db1, 'sess-a', 'idle', 3000);
    updateSessionState(db2, 'sess-b', 'attention', 4000);

    const a = getSession(db1, 'sess-a');
    const b = getSession(db2, 'sess-b');
    expect(a!.state).toBe('idle');
    expect(b!.state).toBe('attention');

    db1.close();
    db2.close();
  });
});
