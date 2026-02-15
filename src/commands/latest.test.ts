import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, updateSessionState } from '../db.ts';
import { latestQuery } from './latest.ts';

describe('latestQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('returns the most recent session for a workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: '/t1', started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: '/t2', started_at: 2000 });

    const result = latestQuery(db, 'repo:main');
    expect(result).not.toBeNull();
    expect(result!.session_id).toBe('s2');
  });

  it('returns stopped session if it is the most recent', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: '/t1', started_at: 1000 });
    updateSessionState(db, 's1', 'stopped', 2000);

    const result = latestQuery(db, 'repo:main');
    expect(result!.state).toBe('stopped');
    expect(result!.ended_at).toBe(2000);
  });

  it('returns null for unknown workspace', () => {
    const result = latestQuery(db, 'nonexistent:branch');
    expect(result).toBeNull();
  });
});
