import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { getSessionHistory } from '../db.ts';
import type { Session } from '../types.ts';

export interface SessionsQueryOptions {
  workspace?: string;
  limit: number;
}

export function sessionsQuery(db: Database.Database, options: SessionsQueryOptions): Session[] {
  return getSessionHistory(db, options);
}

interface SessionsCommandOptions {
  workspace?: string;
  limit?: number;
  json?: boolean;
}

export function sessionsCommand(db: Database.Database, options: SessionsCommandOptions): void {
  const limit = options.limit ?? 20;
  const result = sessionsQuery(db, { workspace: options.workspace, limit });

  if (options.json) {
    console.log(JSON.stringify({ sessions: result }, null, 2));
    return;
  }

  if (result.length === 0) {
    console.log('No sessions found.');
    return;
  }

  for (const s of result) {
    const stateColor = s.state === 'active' ? chalk.green
      : s.state === 'idle' ? chalk.blue
      : s.state === 'attention' ? chalk.yellow
      : chalk.gray;

    const date = new Date(s.started_at).toLocaleString();
    console.log(`  ${chalk.dim(date)} ${chalk.white(s.workspace)} ${stateColor(s.state)} ${chalk.dim(s.session_id)}`);
  }
}
