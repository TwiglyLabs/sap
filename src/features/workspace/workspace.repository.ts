import type { WorkspaceEntry } from '../../core/types.ts';

export interface WorkspaceRepository {
  upsertWorkspace(entry: WorkspaceEntry): void;
  getCachedWorkspace(cwd: string): WorkspaceEntry | null;
}
