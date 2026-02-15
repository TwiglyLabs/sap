import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { resolveWorkspaceFromGit, resolveWorkspace } from './workspace.ts';
import { openDb, getCachedWorkspace, upsertWorkspace } from './db.ts';

describe('resolveWorkspaceFromGit', () => {
  it('resolves the current repo', () => {
    const result = resolveWorkspaceFromGit(process.cwd());
    expect(result).not.toBeNull();
    expect(result!.repo_name).toBeTruthy();
    expect(result!.branch).toMatch(/^[a-zA-Z0-9_./-]+$/);
    expect(result!.workspace).toBe(`${result!.repo_name}:${result!.branch}`);
  });

  it('returns null for a non-git directory', () => {
    const result = resolveWorkspaceFromGit('/tmp');
    expect(result).toBeNull();
  });
});

describe('resolveWorkspace', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('returns cached workspace when available', () => {
    upsertWorkspace(db, {
      cwd: '/cached/path',
      repo_name: 'cached-repo',
      branch: 'feat',
      workspace: 'cached-repo:feat',
      resolved_at: Date.now(),
    });

    const result = resolveWorkspace(db, '/cached/path', false);
    expect(result).toBe('cached-repo:feat');
  });

  it('resolves from git and caches when no cache exists', () => {
    const result = resolveWorkspace(db, process.cwd(), false);
    expect(result).toMatch(/^sap:/);

    const cached = getCachedWorkspace(db, process.cwd());
    expect(cached).not.toBeNull();
    expect(cached!.workspace).toBe(result);
  });

  it('force-resolves from git when forceResolve=true (ignores cache)', () => {
    upsertWorkspace(db, {
      cwd: process.cwd(),
      repo_name: 'stale',
      branch: 'old',
      workspace: 'stale:old',
      resolved_at: 1000,
    });

    const result = resolveWorkspace(db, process.cwd(), true);
    expect(result).toMatch(/^sap:/);
    expect(result).not.toBe('stale:old');
  });

  it('returns fallback for non-git directory', () => {
    const result = resolveWorkspace(db, '/tmp', false);
    expect(result).toBe('tmp:local');
  });
});
