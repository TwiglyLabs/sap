import type { Session } from '../../core/types.ts';
import { STALE_THRESHOLD_MS } from '../../core/config.ts';
import type { SessionRepository } from './session.repository.ts';
import type { StatusResult, GroupedStatusResult, SessionsQueryOptions } from './session.types.ts';

export class SessionService {
  constructor(private repo: SessionRepository) {}

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

  latest(workspace: string): Session | null {
    return this.repo.getLatestSession(workspace);
  }

  sessions(options: SessionsQueryOptions): Session[] {
    return this.repo.getSessionHistory(options);
  }

  gc(olderThanMs: number): number {
    return this.repo.deleteStaleSessions(olderThanMs);
  }

  sweep(thresholdMs: number): number {
    return this.repo.markStaleSessions(thresholdMs);
  }
}
