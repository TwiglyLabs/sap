import type Database from 'better-sqlite3';
import chalk from 'chalk';

export interface QueryResult {
  rows: Record<string, unknown>[];
  error?: string;
}

const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE)\b/i;

export function executeQuery(db: Database.Database, sql: string): QueryResult {
  if (WRITE_PATTERN.test(sql)) {
    return { rows: [], error: 'Read-only: write statements are not allowed' };
  }

  try {
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    return { rows };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export interface QueryCliOptions {
  json?: boolean;
}

export function queryCli(db: Database.Database, sql: string, options: QueryCliOptions): void {
  const result = executeQuery(db, sql);

  if (result.error) {
    if (options.json) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      console.error(`${chalk.red('Error:')} ${result.error}`);
    }
    process.exitCode = 1;
    return;
  }

  // sap query always outputs JSON — it's meant for Claude to consume
  console.log(JSON.stringify(result.rows, null, 2));
}
