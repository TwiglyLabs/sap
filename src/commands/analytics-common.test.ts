import { describe, it, expect } from 'vitest';
import { parseDuration, buildWhereClause } from './analytics-common.ts';

describe('parseDuration', () => {
  it('parses days', () => {
    expect(parseDuration('7d')).toBe(7 * 86400 * 1000);
  });

  it('parses hours', () => {
    expect(parseDuration('24h')).toBe(24 * 3600 * 1000);
  });

  it('parses minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
  });

  it('throws on invalid format', () => {
    expect(() => parseDuration('abc')).toThrow();
  });
});

describe('buildWhereClause', () => {
  it('returns empty for no filters', () => {
    const result = buildWhereClause({});
    expect(result.clause).toBe('');
    expect(result.params).toEqual([]);
  });

  it('adds workspace filter', () => {
    const result = buildWhereClause({ workspace: 'repo:main' });
    expect(result.clause).toContain('workspace = ?');
    expect(result.params).toContain('repo:main');
  });

  it('adds since filter on turns.started_at', () => {
    const before = Date.now();
    const result = buildWhereClause({ sinceMs: 86400000 }, 't.started_at');
    expect(result.clause).toContain('t.started_at >= ?');
    expect(result.params[0]).toBeGreaterThan(before - 86400000 - 1000);
  });

  it('combines workspace and since', () => {
    const result = buildWhereClause({ workspace: 'repo:main', sinceMs: 86400000 }, 't.started_at');
    expect(result.clause).toContain('AND');
    expect(result.params).toHaveLength(2);
  });
});
