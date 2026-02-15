import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession } from '../db.ts';
import { sessionsQuery } from './sessions.ts';

describe('sessionsQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('returns sessions in reverse chronological order', () => {
    for (let i = 1; i <= 5; i++) {
      insertSession(db, { session_id: `s${i}`, workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: i * 1000 });
    }

    const result = sessionsQuery(db, { limit: 20 });
    expect(result).toHaveLength(5);
    expect(result[0].session_id).toBe('s5');
  });

  it('respects limit', () => {
    for (let i = 1; i <= 5; i++) {
      insertSession(db, { session_id: `s${i}`, workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: i * 1000 });
    }

    const result = sessionsQuery(db, { limit: 2 });
    expect(result).toHaveLength(2);
  });

  it('filters by workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo-a:main', cwd: '/a', transcript_path: null, started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo-b:main', cwd: '/b', transcript_path: null, started_at: 2000 });

    const result = sessionsQuery(db, { workspace: 'repo-a:main', limit: 20 });
    expect(result).toHaveLength(1);
  });
});
