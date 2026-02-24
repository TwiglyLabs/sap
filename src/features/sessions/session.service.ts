import type { Session } from '../../core/types.ts';
import { STALE_THRESHOLD_MS } from '../../core/config.ts';
import type { SessionRepository } from './session.repository.ts';
import type { StatusResult, GroupedStatusResult, SessionsQueryOptions } from './session.types.ts';
import { noopLogger } from '@twiglylabs/log';
import type { Logger } from '@twiglylabs/log';

/** Session lifecycle management: status queries, history, garbage collection, and stale sweep. */
export class SessionService {
  private log: Logger;

  constructor(
    private repo: SessionRepository,
    logger: Logger = noopLogger,
  ) {
    this.log = logger.child('sap:sessions');
  }

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
    const deleted = this.repo.deleteStaleSessions(olderThanMs);
    this.log.debug('gc complete', { olderThanMs, deleted });
    return deleted;
  }

  /** Mark stale sessions as stopped. Returns count swept. */
  sweep(thresholdMs: number): number {
    const swept = this.repo.markStaleSessions(thresholdMs);
    this.log.debug('sweep complete', { thresholdMs, swept });
    return swept;
  }
}
