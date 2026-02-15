import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { buildWhereClause, type FilterOptions, type AnalyticsCliOptions, parseAnalyticsOptions } from './analytics-common.ts';

interface SessionAnalytics {
  session_id: string;
  workspace: string;
  started_at: number;
  duration_min: number;
  turns: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  error_count: number;
  error_rate: number;
  outcome: {
    committed: boolean;
    tests_passed: boolean | null;
  };
}

export interface SessionsAnalyticsResult {
  sessions: SessionAnalytics[];
}

export function sessionsAnalyticsQuery(
  db: Database.Database,
  filters: FilterOptions,
  limit: number = 20,
): SessionsAnalyticsResult {
  const { clause, params } = buildWhereClause(filters, 't.started_at');
  const joinBase = 'FROM turns t JOIN sessions s ON t.session_id = s.session_id';

  const rows = db.prepare(`
    SELECT s.session_id, s.workspace, s.started_at,
           count(DISTINCT t.id) as turns,
           coalesce(sum(t.input_tokens), 0) as input_tokens,
           coalesce(sum(t.output_tokens), 0) as output_tokens,
           coalesce(sum(t.cache_read_tokens), 0) as cache_read_tokens,
           coalesce(sum(t.duration_ms), 0) as total_duration_ms
    ${joinBase} ${clause}
    GROUP BY s.session_id
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(...params, limit) as {
    session_id: string; workspace: string; started_at: number;
    turns: number; input_tokens: number; output_tokens: number; cache_read_tokens: number;
    total_duration_ms: number;
  }[];

  const sessions: SessionAnalytics[] = rows.map(row => {
    // Get tool call stats for this session
    const toolStats = db.prepare(`
      SELECT count(*) as total,
             sum(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
      FROM tool_calls WHERE session_id = ?
    `).get(row.session_id) as { total: number; errors: number };

    // Check for commit outcome
    const hasCommit = db.prepare(`
      SELECT 1 FROM tool_calls
      WHERE session_id = ? AND tool_name = 'Bash' AND tool_input_summary LIKE 'git commit%' AND success = 1
      LIMIT 1
    `).get(row.session_id);

    // Check for test pass outcome
    const testRuns = db.prepare(`
      SELECT success FROM tool_calls
      WHERE session_id = ? AND tool_name = 'Bash'
        AND (tool_input_summary LIKE '%test%' OR tool_input_summary LIKE '%vitest%' OR tool_input_summary LIKE '%jest%' OR tool_input_summary LIKE '%pytest%')
      ORDER BY created_at DESC LIMIT 1
    `).get(row.session_id) as { success: number } | undefined;

    return {
      session_id: row.session_id,
      workspace: row.workspace,
      started_at: row.started_at,
      duration_min: Math.round(row.total_duration_ms / 60000 * 10) / 10,
      turns: row.turns,
      tool_calls: toolStats.total,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_tokens: row.cache_read_tokens,
      error_count: toolStats.errors,
      error_rate: toolStats.total > 0 ? Math.round(1000 * toolStats.errors / toolStats.total) / 1000 : 0,
      outcome: {
        committed: !!hasCommit,
        tests_passed: testRuns ? testRuns.success === 1 : null,
      },
    };
  });

  return { sessions };
}

export function sessionsAnalyticsCli(db: Database.Database, options: AnalyticsCliOptions & { limit?: string }): void {
  const filters = parseAnalyticsOptions(options);
  const limit = options.limit ? parseInt(options.limit, 10) : 20;
  const result = sessionsAnalyticsQuery(db, filters, limit);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold('\nSession Analytics\n'));
  for (const s of result.sessions) {
    const outcome = s.outcome.committed ? chalk.green('committed') : chalk.dim('no commit');
    console.log(`  ${s.session_id.slice(0, 8)}  ${s.workspace}  ${s.duration_min}min  ${s.turns} turns  ${s.tool_calls} tools  ${s.input_tokens.toLocaleString()} in  ${outcome}`);
    if (s.error_count > 0) {
      console.log(`    ${chalk.yellow(`${s.error_count} errors (${Math.round(s.error_rate * 100)}%)`)}`);
    }
  }
  console.log();
}
