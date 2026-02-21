import { execFileSync } from 'child_process';
import { basename, resolve, isAbsolute } from 'path';
import type { WorkspaceRepository } from './workspace.repository.ts';

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

  const absCommonDir = isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir);
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

export class WorkspaceService {
  constructor(private repo: WorkspaceRepository) {}

  resolveWorkspace(cwd: string, forceResolve: boolean): string {
    if (!forceResolve) {
      const cached = this.repo.getCachedWorkspace(cwd);
      if (cached) return cached.workspace;
    }

    const resolved = resolveWorkspaceFromGit(cwd);

    if (resolved) {
      this.repo.upsertWorkspace({
        cwd,
        repo_name: resolved.repo_name,
        branch: resolved.branch,
        workspace: resolved.workspace,
        resolved_at: Date.now(),
      });
      return resolved.workspace;
    }

    const fallback = `${basename(cwd)}:local`;
    this.repo.upsertWorkspace({
      cwd,
      repo_name: basename(cwd),
      branch: 'local',
      workspace: fallback,
      resolved_at: Date.now(),
    });
    return fallback;
  }
}
