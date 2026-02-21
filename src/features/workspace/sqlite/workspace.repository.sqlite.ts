import type Database from 'better-sqlite3';
import type { WorkspaceEntry } from '../../../core/types.ts';
import type { WorkspaceRepository } from '../workspace.repository.ts';

export class WorkspaceRepositorySqlite implements WorkspaceRepository {
  constructor(private db: Database.Database) {}

  upsertWorkspace(entry: WorkspaceEntry): void {
    this.db.prepare(`
      INSERT INTO workspaces (cwd, repo_name, branch, workspace, resolved_at)
      VALUES (@cwd, @repo_name, @branch, @workspace, @resolved_at)
      ON CONFLICT(cwd) DO UPDATE SET
        repo_name = excluded.repo_name,
        branch = excluded.branch,
        workspace = excluded.workspace,
        resolved_at = excluded.resolved_at
    `).run(entry);
  }

  getCachedWorkspace(cwd: string): WorkspaceEntry | null {
    return (this.db.prepare('SELECT * FROM workspaces WHERE cwd = ?').get(cwd) as WorkspaceEntry | undefined) ?? null;
  }
}
