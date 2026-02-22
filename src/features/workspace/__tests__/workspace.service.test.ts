import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../../core/storage.ts';
import { WorkspaceRepositorySqlite } from '../sqlite/workspace.repository.sqlite.ts';
import { WorkspaceService, resolveWorkspaceFromGit } from '../workspace.service.ts';

describe('resolveWorkspaceFromGit', () => {
  it('resolves the current repo', async () => {
    const result = await resolveWorkspaceFromGit(process.cwd());
    expect(result).not.toBeNull();
    expect(result!.repo_name).toBeTruthy();
    expect(result!.branch).toMatch(/^[a-zA-Z0-9_./-]+$/);
    expect(result!.workspace).toBe(`${result!.repo_name}:${result!.branch}`);
  });

  it('returns null for a non-git directory', async () => {
    const result = await resolveWorkspaceFromGit('/tmp');
    expect(result).toBeNull();
  });
});

describe('WorkspaceService.resolveWorkspace', () => {
  let service: WorkspaceService;

  beforeEach(() => {
    const db = openDb(':memory:');
    const repo = new WorkspaceRepositorySqlite(db);
    service = new WorkspaceService(repo);
  });

  it('returns cached workspace when available', async () => {
    const repo = (service as any).repo as WorkspaceRepositorySqlite;
    repo.upsertWorkspace({
      cwd: '/cached/path',
      repo_name: 'cached-repo',
      branch: 'feat',
      workspace: 'cached-repo:feat',
      resolved_at: Date.now(),
    });

    const result = await service.resolveWorkspace('/cached/path', false);
    expect(result).toBe('cached-repo:feat');
  });

  it('resolves from git and caches when no cache exists', async () => {
    const result = await service.resolveWorkspace(process.cwd(), false);
    expect(result).toMatch(/^sap:/);

    const repo = (service as any).repo as WorkspaceRepositorySqlite;
    const cached = repo.getCachedWorkspace(process.cwd());
    expect(cached).not.toBeNull();
    expect(cached!.workspace).toBe(result);
  });

  it('force-resolves from git when forceResolve=true (ignores cache)', async () => {
    const repo = (service as any).repo as WorkspaceRepositorySqlite;
    repo.upsertWorkspace({
      cwd: process.cwd(),
      repo_name: 'stale',
      branch: 'old',
      workspace: 'stale:old',
      resolved_at: 1000,
    });

    const result = await service.resolveWorkspace(process.cwd(), true);
    expect(result).toMatch(/^sap:/);
    expect(result).not.toBe('stale:old');
  });

  it('returns fallback for non-git directory', async () => {
    const result = await service.resolveWorkspace('/tmp', false);
    expect(result).toBe('tmp:local');
  });
});
