import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, updateSessionState, getSession } from '../db.ts';
import { sweepCommand } from './sweep.ts';

describe('sweepCommand', () => {
  let db: Database.Database;
  const TEN_MIN = 10 * 60 * 1000;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('sweeps stale active sessions to stopped', () => {
    const old = Date.now() - TEN_MIN - 1000;
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: old });

    const swept = sweepCommand(db, TEN_MIN);
    expect(swept).toBe(1);

    const session = getSession(db, 's1');
    expect(session!.state).toBe('stopped');
    expect(session!.ended_at).toBe(old); // ended_at set to last_event_at
  });

  it('sweeps stale idle sessions to stopped', () => {
    const old = Date.now() - TEN_MIN - 1000;
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: old });
    updateSessionState(db, 's1', 'idle', old + 100);

    const swept = sweepCommand(db, TEN_MIN);
    expect(swept).toBe(1);
    expect(getSession(db, 's1')!.state).toBe('stopped');
  });

  it('sweeps stale attention sessions to stopped', () => {
    const old = Date.now() - TEN_MIN - 1000;
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: old });
    updateSessionState(db, 's1', 'attention', old + 100);

    const swept = sweepCommand(db, TEN_MIN);
    expect(swept).toBe(1);
    expect(getSession(db, 's1')!.state).toBe('stopped');
  });

  it('does not sweep fresh sessions', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() });

    const swept = sweepCommand(db, TEN_MIN);
    expect(swept).toBe(0);
    expect(getSession(db, 's1')!.state).toBe('active');
  });

  it('does not sweep already stopped sessions', () => {
    const old = Date.now() - TEN_MIN - 1000;
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: old });
    updateSessionState(db, 's1', 'stopped', old + 100);

    const swept = sweepCommand(db, TEN_MIN);
    expect(swept).toBe(0);
  });

  it('uses custom threshold', () => {
    const thirtyMinAgo = Date.now() - 30 * 60 * 1000 - 1000;
    const fiveMinAgo = Date.now() - 5 * 60 * 1000;

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: thirtyMinAgo });
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: fiveMinAgo });

    // With 30 min threshold, only the 30-min-old one should be swept
    const swept = sweepCommand(db, 30 * 60 * 1000);
    expect(swept).toBe(1);
    expect(getSession(db, 's1')!.state).toBe('stopped');
    expect(getSession(db, 's2')!.state).toBe('active');
  });
});
