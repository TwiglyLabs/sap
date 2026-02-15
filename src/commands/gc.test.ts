import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, updateSessionState, getSession, insertEvent, getSessionEvents } from '../db.ts';
import { gcCommand } from './gc.ts';

describe('gcCommand', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('deletes stopped sessions older than threshold', () => {
    const oldTime = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 days ago
    insertSession(db, { session_id: 's-old', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: oldTime });
    updateSessionState(db, 's-old', 'stopped', oldTime + 1000);
    insertEvent(db, { session_id: 's-old', event_type: 'session-start', data: null, created_at: oldTime });

    const deleted = gcCommand(db, 30 * 24 * 60 * 60 * 1000);
    expect(deleted).toBe(1);
    expect(getSession(db, 's-old')).toBeNull();
    expect(getSessionEvents(db, 's-old')).toHaveLength(0);
  });

  it('deletes orphaned active sessions older than threshold', () => {
    const oldTime = Date.now() - 40 * 24 * 60 * 60 * 1000;
    insertSession(db, { session_id: 's-orphan', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: oldTime });

    const deleted = gcCommand(db, 30 * 24 * 60 * 60 * 1000);
    expect(deleted).toBe(1);
  });

  it('keeps recent sessions', () => {
    insertSession(db, { session_id: 's-new', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() });

    const deleted = gcCommand(db, 30 * 24 * 60 * 60 * 1000);
    expect(deleted).toBe(0);
    expect(getSession(db, 's-new')).not.toBeNull();
  });
});
