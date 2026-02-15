import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { getActiveSessions } from '../db.ts';
import type { SessionStatus } from '../types.ts';

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

interface StatusResult {
  sessions: SessionStatus[];
}

export function statusQuery(db: Database.Database, workspace?: string): StatusResult {
  const sessions = getActiveSessions(db, workspace);
  const now = Date.now();

  return {
    sessions: sessions.map(s => ({
      ...s,
      stale: (now - s.last_event_at) > STALE_THRESHOLD_MS,
    })),
  };
}

interface StatusOptions {
  workspace?: string;
  json?: boolean;
}

export function statusCommand(db: Database.Database, options: StatusOptions): void {
  const result = statusQuery(db, options.workspace);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.sessions.length === 0) {
    console.log('No active sessions.');
    return;
  }

  for (const s of result.sessions) {
    const stateColor = s.state === 'active' ? chalk.green
      : s.state === 'idle' ? chalk.blue
      : s.state === 'attention' ? chalk.yellow
      : chalk.gray;

    const staleTag = s.stale ? chalk.red(' [stale]') : '';
    const toolInfo = s.last_tool ? ` ${chalk.dim(s.last_tool)}${s.last_tool_detail ? chalk.dim(`:${s.last_tool_detail}`) : ''}` : '';

    console.log(`  ${chalk.white(s.workspace)} ${stateColor(s.state)}${staleTag}${toolInfo}`);
  }
}
