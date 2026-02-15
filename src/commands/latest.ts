import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { getLatestSession } from '../db.ts';
import type { Session } from '../types.ts';

export function latestQuery(db: Database.Database, workspace: string): Session | null {
  return getLatestSession(db, workspace);
}

interface LatestOptions {
  workspace: string;
  json?: boolean;
}

export function latestCommand(db: Database.Database, options: LatestOptions): void {
  const session = latestQuery(db, options.workspace);

  if (options.json) {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  if (!session) {
    console.log(`No sessions found for ${options.workspace}.`);
    return;
  }

  const stateColor = session.state === 'active' ? chalk.green
    : session.state === 'idle' ? chalk.blue
    : session.state === 'attention' ? chalk.yellow
    : chalk.gray;

  console.log(`  ${chalk.white(session.workspace)} ${stateColor(session.state)}`);
  console.log(`  Session: ${session.session_id}`);
  if (session.transcript_path) {
    console.log(`  Transcript: ${chalk.dim(session.transcript_path)}`);
  }
}
