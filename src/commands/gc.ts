import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { deleteStaleSessions } from '../db.ts';

export function gcCommand(db: Database.Database, olderThanMs: number): number {
  return deleteStaleSessions(db, olderThanMs);
}

function parseDuration(s: string): number {
  const match = s.match(/^(\d+)d$/);
  if (!match) throw new Error(`Invalid duration: ${s}. Use format like "30d".`);
  return parseInt(match[1], 10) * 24 * 60 * 60 * 1000;
}

interface GcOptions {
  olderThan?: string;
  json?: boolean;
}

export function gcCli(db: Database.Database, options: GcOptions): void {
  const threshold = parseDuration(options.olderThan ?? '30d');
  const deleted = gcCommand(db, threshold);

  if (options.json) {
    console.log(JSON.stringify({ deleted }));
    return;
  }

  if (deleted === 0) {
    console.log('Nothing to clean up.');
  } else {
    console.log(`${chalk.green('Cleaned up')} ${deleted} session${deleted === 1 ? '' : 's'}.`);
  }
}
