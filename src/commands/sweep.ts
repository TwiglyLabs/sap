import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { markStaleSessions } from '../db.ts';

const DEFAULT_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export function parseSweepThreshold(s: string): number {
  const match = s.match(/^(\d+)m$/);
  if (!match) throw new Error(`Invalid threshold: ${s}. Use format like "10m".`);
  return parseInt(match[1], 10) * 60 * 1000;
}

export function sweepCommand(db: Database.Database, thresholdMs: number): number {
  return markStaleSessions(db, thresholdMs);
}

interface SweepOptions {
  threshold?: string;
  json?: boolean;
}

export function sweepCli(db: Database.Database, options: SweepOptions): void {
  const thresholdMs = options.threshold
    ? parseSweepThreshold(options.threshold)
    : DEFAULT_THRESHOLD_MS;
  const swept = sweepCommand(db, thresholdMs);

  if (options.json) {
    console.log(JSON.stringify({ swept }));
    return;
  }

  if (swept === 0) {
    console.log('No stale sessions found.');
  } else {
    console.log(`${chalk.green('Swept')} ${swept} stale session${swept === 1 ? '' : 's'}.`);
  }
}
