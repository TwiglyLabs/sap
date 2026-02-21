import type { SessionStatus } from '../../core/types.ts';

/** Active sessions with staleness flags. */
export interface StatusResult {
  sessions: SessionStatus[];
}

/** Active sessions grouped by workspace. */
export interface GroupedStatusResult {
  workspaces: Record<string, SessionStatus[]>;
}

/** Options for querying session history. */
export interface SessionsQueryOptions {
  workspace?: string;
  limit: number;
}
