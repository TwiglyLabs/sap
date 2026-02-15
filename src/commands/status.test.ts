import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, updateSessionState } from '../db.ts';
import { statusQuery, statusQueryGrouped } from './status.ts';

describe('statusQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('returns active sessions with stale=false', () => {
    insertSession(db, {
      session_id: 's1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: Date.now() - 5000,
    });
    updateSessionState(db, 's1', 'active', Date.now());

    const result = statusQuery(db);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].stale).toBe(false);
  });

  it('marks sessions older than 10 minutes as stale', () => {
    const tenMinAgo = Date.now() - 11 * 60 * 1000;
    insertSession(db, {
      session_id: 's1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: tenMinAgo - 1000,
    });

    const result = statusQuery(db);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].stale).toBe(true);
  });

  it('excludes stopped sessions', () => {
    insertSession(db, {
      session_id: 's1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: Date.now(),
    });
    updateSessionState(db, 's1', 'stopped', Date.now());

    const result = statusQuery(db);
    expect(result.sessions).toHaveLength(0);
  });

  it('filters by workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo-a:main', cwd: '/a', transcript_path: null, started_at: Date.now() });
    insertSession(db, { session_id: 's2', workspace: 'repo-b:dev', cwd: '/b', transcript_path: null, started_at: Date.now() });

    const result = statusQuery(db, 'repo-a:main');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].workspace).toBe('repo-a:main');
  });

  it('includes idle and attention sessions', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() });
    updateSessionState(db, 's1', 'idle', Date.now());

    insertSession(db, { session_id: 's2', workspace: 'repo:dev', cwd: '/r', transcript_path: null, started_at: Date.now() });
    updateSessionState(db, 's2', 'attention', Date.now());

    const result = statusQuery(db);
    expect(result.sessions).toHaveLength(2);
  });
});

describe('statusQueryGrouped', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('groups sessions by workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo-a:main', cwd: '/a', transcript_path: null, started_at: Date.now() });
    insertSession(db, { session_id: 's2', workspace: 'repo-a:main', cwd: '/a', transcript_path: null, started_at: Date.now() });
    insertSession(db, { session_id: 's3', workspace: 'repo-b:dev', cwd: '/b', transcript_path: null, started_at: Date.now() });

    const result = statusQueryGrouped(db);
    expect(Object.keys(result.workspaces)).toHaveLength(2);
    expect(result.workspaces['repo-a:main']).toHaveLength(2);
    expect(result.workspaces['repo-b:dev']).toHaveLength(1);
  });

  it('returns empty workspaces when no sessions', () => {
    const result = statusQueryGrouped(db);
    expect(Object.keys(result.workspaces)).toHaveLength(0);
  });

  it('excludes stopped sessions', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() });
    updateSessionState(db, 's1', 'stopped', Date.now());

    const result = statusQueryGrouped(db);
    expect(Object.keys(result.workspaces)).toHaveLength(0);
  });

  it('filters by workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo-a:main', cwd: '/a', transcript_path: null, started_at: Date.now() });
    insertSession(db, { session_id: 's2', workspace: 'repo-b:dev', cwd: '/b', transcript_path: null, started_at: Date.now() });

    const result = statusQueryGrouped(db, 'repo-a:main');
    expect(Object.keys(result.workspaces)).toHaveLength(1);
    expect(result.workspaces['repo-a:main']).toHaveLength(1);
  });
});
