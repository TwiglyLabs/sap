import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { basename, resolve, isAbsolute } from 'path';
import type { WorkspaceRepository } from './workspace.repository.ts';

const execFileAsync = promisify(execFile);

interface WorkspaceResolution {
  repo_name: string;
  branch: string;
  workspace: string;
}

async function execGit(cwd: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
      encoding: 'utf-8',
      timeout: 5000,
    });
    return stdout.trim();
  } catch {
    return null;
  }
}

export async function resolveWorkspaceFromGit(cwd: string): Promise<WorkspaceResolution | null> {
  const commonDir = await execGit(cwd, ['rev-parse', '--git-common-dir']);
  if (commonDir === null) return null;

  const absCommonDir = isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir);
  const repoRoot = resolve(absCommonDir, '..');
  const repoName = basename(repoRoot);

  const branchRaw = await execGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRaw === 'HEAD' ? 'detached' : (branchRaw ?? 'unknown');

  return {
    repo_name: repoName,
    branch,
    workspace: `${repoName}:${branch}`,
  };
}

/** Resolves working directories to "repo:branch" workspace identifiers via git. */
export class WorkspaceService {
  constructor(private repo: WorkspaceRepository) {}

  /** Resolve cwd to a workspace string. Uses cache unless forceResolve is true. Falls back to "dirname:local". */
  async resolveWorkspace(cwd: string, forceResolve: boolean): Promise<string> {
    if (!forceResolve) {
      const cached = this.repo.getCachedWorkspace(cwd);
      if (cached) return cached.workspace;
    }

    const resolved = await resolveWorkspaceFromGit(cwd);

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
