import type { WorkspaceEntry } from '../../core/types.ts';

/** Data access contract for workspace resolution cache. */
export interface WorkspaceRepository {
  upsertWorkspace(entry: WorkspaceEntry): void;
  getCachedWorkspace(cwd: string): WorkspaceEntry | null;
}
