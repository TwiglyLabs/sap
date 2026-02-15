import { execFileSync } from 'child_process';
import { basename, resolve, isAbsolute } from 'path';
import type Database from 'better-sqlite3';
import { getCachedWorkspace, upsertWorkspace } from './db.ts';

interface WorkspaceResolution {
  repo_name: string;
  branch: string;
  workspace: string;
}

function execGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function resolveWorkspaceFromGit(cwd: string): WorkspaceResolution | null {
  const commonDir = execGit(cwd, ['rev-parse', '--git-common-dir']);
  if (commonDir === null) return null;

  // --git-common-dir returns relative path in main worktree (e.g. ".git"),
  // absolute path in worktrees. Resolve to absolute.
  const absCommonDir = isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir);
  // The repo root is the parent of .git
  const repoRoot = resolve(absCommonDir, '..');
  const repoName = basename(repoRoot);

  const branchRaw = execGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRaw === 'HEAD' ? 'detached' : (branchRaw ?? 'unknown');

  return {
    repo_name: repoName,
    branch,
    workspace: `${repoName}:${branch}`,
  };
}

export function resolveWorkspace(db: Database.Database, cwd: string, forceResolve: boolean): string {
  // Check cache unless force-resolving (session-start always force-resolves)
  if (!forceResolve) {
    const cached = getCachedWorkspace(db, cwd);
    if (cached) return cached.workspace;
  }

  const resolved = resolveWorkspaceFromGit(cwd);

  if (resolved) {
    upsertWorkspace(db, {
      cwd,
      repo_name: resolved.repo_name,
      branch: resolved.branch,
      workspace: resolved.workspace,
      resolved_at: Date.now(),
    });
    return resolved.workspace;
  }

  // Non-git fallback: basename(cwd):local
  const fallback = `${basename(cwd)}:local`;
  upsertWorkspace(db, {
    cwd,
    repo_name: basename(cwd),
    branch: 'local',
    workspace: fallback,
    resolved_at: Date.now(),
  });
  return fallback;
}
