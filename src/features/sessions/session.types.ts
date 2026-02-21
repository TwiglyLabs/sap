import type { SessionStatus } from '../../core/types.ts';

export interface StatusResult {
  sessions: SessionStatus[];
}

export interface GroupedStatusResult {
  workspaces: Record<string, SessionStatus[]>;
}

export interface SessionsQueryOptions {
  workspace?: string;
  limit: number;
}
