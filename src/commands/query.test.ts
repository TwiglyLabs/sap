import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession } from '../db.ts';
import { executeQuery } from './query.ts';

describe('executeQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, {
      session_id: 's1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: 1000,
    });
  });

  it('executes a SELECT and returns rows as JSON-ready array', () => {
    const result = executeQuery(db, 'SELECT session_id, workspace FROM sessions');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].session_id).toBe('s1');
  });

  it('supports parameterless aggregation queries', () => {
    const result = executeQuery(db, 'SELECT count(*) as n FROM sessions');
    expect(result.rows[0].n).toBe(1);
  });

  it('rejects INSERT statements', () => {
    const result = executeQuery(db, "INSERT INTO sessions VALUES ('x','x','x',null,'active',1,null,1,null,null,null)");
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/read-only/i);
  });

  it('rejects DELETE statements', () => {
    const result = executeQuery(db, 'DELETE FROM sessions');
    expect(result.error).toBeDefined();
  });

  it('rejects DROP statements', () => {
    const result = executeQuery(db, 'DROP TABLE sessions');
    expect(result.error).toBeDefined();
  });

  it('rejects write statements hidden behind SQL comments', () => {
    const result = executeQuery(db, '/* sneaky */ DROP TABLE sessions');
    expect(result.error).toBeDefined();
  });

  it('rejects PRAGMA writes', () => {
    const result = executeQuery(db, 'PRAGMA writable_schema = ON');
    expect(result.error).toBeDefined();
  });

  it('rejects ATTACH DATABASE', () => {
    const result = executeQuery(db, "ATTACH DATABASE ':memory:' AS tmp");
    expect(result.error).toBeDefined();
  });

  it('allows read-only PRAGMA table_info', () => {
    const result = executeQuery(db, 'PRAGMA table_info(sessions)');
    expect(result.error).toBeUndefined();
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it('returns error for invalid SQL', () => {
    const result = executeQuery(db, 'SELECTT * FROM sessions');
    expect(result.error).toBeDefined();
  });

  it('works with CTEs and window functions', () => {
    insertSession(db, { session_id: 's2', workspace: 'repo:dev', cwd: '/r', transcript_path: null, started_at: 2000 });

    const result = executeQuery(db, `
      WITH ranked AS (
        SELECT workspace, row_number() OVER (ORDER BY started_at DESC) as rn
        FROM sessions
      )
      SELECT workspace, rn FROM ranked ORDER BY rn
    `);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].rn).toBe(1);
  });
});
