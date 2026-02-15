import type Database from 'better-sqlite3';
import chalk from 'chalk';

export interface QueryResult {
  rows: Record<string, unknown>[];
  error?: string;
}

const SAFE_PATTERN = /^\s*(SELECT|WITH|EXPLAIN|PRAGMA\s+table_info|PRAGMA\s+index_list)\b/i;

export function executeQuery(db: Database.Database, sql: string): QueryResult {
  // Strip SQL comments before checking
  const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim();
  if (!SAFE_PATTERN.test(stripped)) {
    return { rows: [], error: 'Read-only: only SELECT, WITH, and EXPLAIN queries are allowed' };
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
