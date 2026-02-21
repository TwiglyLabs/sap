import type { Session } from '../../core/types.ts';
import { STALE_THRESHOLD_MS } from '../../core/config.ts';
import type { SessionRepository } from './session.repository.ts';
import type { StatusResult, GroupedStatusResult, SessionsQueryOptions } from './session.types.ts';

/** Session lifecycle management: status queries, history, garbage collection, and stale sweep. */
export class SessionService {
  constructor(private repo: SessionRepository) {}

  /** Get all non-stopped sessions with computed staleness. */
  status(workspace?: string): StatusResult {
    const sessions = this.repo.getActiveSessions(workspace);
    const now = Date.now();

    return {
      sessions: sessions.map(s => ({
        ...s,
        stale: (now - s.last_event_at) > STALE_THRESHOLD_MS,
      })),
    };
  }

  /** Get active sessions grouped by workspace. */
  statusGrouped(workspace?: string): GroupedStatusResult {
    const { sessions } = this.status(workspace);
    const workspaces: Record<string, typeof sessions> = {};

    for (const s of sessions) {
      if (!workspaces[s.workspace]) {
        workspaces[s.workspace] = [];
      }
      workspaces[s.workspace].push(s);
    }

    return { workspaces };
  }

  /** Get the most recent session for a workspace. */
  latest(workspace: string): Session | null {
    return this.repo.getLatestSession(workspace);
  }

  /** Get session history, ordered by most recent first. */
  sessions(options: SessionsQueryOptions): Session[] {
    return this.repo.getSessionHistory(options);
  }

  /** Delete sessions older than the given threshold. Returns count deleted. */
  gc(olderThanMs: number): number {
    return this.repo.deleteStaleSessions(olderThanMs);
  }

  /** Mark stale sessions as stopped. Returns count swept. */
  sweep(thresholdMs: number): number {
    return this.repo.markStaleSessions(thresholdMs);
  }
}
