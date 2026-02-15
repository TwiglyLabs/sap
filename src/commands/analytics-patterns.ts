import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { buildWhereClause, type FilterOptions, type AnalyticsCliOptions, parseAnalyticsOptions } from './analytics-common.ts';

export interface PatternsResult {
  anti_patterns: {
    pattern: string;
    description: string;
    frequency: number;
    sessions_affected: number;
  }[];
  outlier_sessions: {
    session_id: string;
    workspace: string;
    reason: string;
    value: number;
  }[];
}

export function patternsQuery(db: Database.Database, filters: FilterOptions): PatternsResult {
  const { clause, params } = buildWhereClause(filters, 'tc.created_at');
  const joinBase = 'FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id';

  const anti_patterns: PatternsResult['anti_patterns'] = [];

  // Edit retry pattern: Edit failures (success=0)
  const editRetries = db.prepare(`
    SELECT count(*) as frequency, count(DISTINCT tc.session_id) as sessions_affected
    ${joinBase} ${clause ? clause + ' AND' : 'WHERE'} tc.tool_name = 'Edit' AND tc.success = 0
  `).get(...params) as { frequency: number; sessions_affected: number };

  if (editRetries.frequency > 0) {
    anti_patterns.push({
      pattern: 'edit-retry',
      description: 'Edit failures followed by retry (old_string mismatch)',
      frequency: editRetries.frequency,
      sessions_affected: editRetries.sessions_affected,
    });
  }

  // Bash error pattern: Bash commands that fail
  const bashErrors = db.prepare(`
    SELECT count(*) as frequency, count(DISTINCT tc.session_id) as sessions_affected
    ${joinBase} ${clause ? clause + ' AND' : 'WHERE'} tc.tool_name = 'Bash' AND tc.success = 0
  `).get(...params) as { frequency: number; sessions_affected: number };

  if (bashErrors.frequency > 0) {
    anti_patterns.push({
      pattern: 'bash-error',
      description: 'Bash commands that exit non-zero',
      frequency: bashErrors.frequency,
      sessions_affected: bashErrors.sessions_affected,
    });
  }

  // Outlier sessions: token usage significantly above average
  const turnWhere = buildWhereClause(filters, 't.started_at');
  const turnJoin = 'FROM turns t JOIN sessions s ON t.session_id = s.session_id';

  const avgTokens = db.prepare(`
    SELECT avg(session_input) as avg_input FROM (
      SELECT sum(t.input_tokens) as session_input
      ${turnJoin} ${turnWhere.clause}
      GROUP BY t.session_id
    )
  `).get(...turnWhere.params) as { avg_input: number | null };

  const outlier_sessions: PatternsResult['outlier_sessions'] = [];

  if (avgTokens.avg_input && avgTokens.avg_input > 0) {
    const threshold = avgTokens.avg_input * 3;
    const outliers = db.prepare(`
      SELECT s.session_id, s.workspace, sum(t.input_tokens) as total_input
      ${turnJoin} ${turnWhere.clause}
      GROUP BY s.session_id
      HAVING total_input > ?
      ORDER BY total_input DESC
      LIMIT 10
    `).all(...turnWhere.params, threshold) as { session_id: string; workspace: string; total_input: number }[];

    for (const o of outliers) {
      outlier_sessions.push({
        session_id: o.session_id,
        workspace: o.workspace,
        reason: `Token usage ${Math.round(o.total_input / avgTokens.avg_input!)}x average`,
        value: o.total_input,
      });
    }
  }

  return { anti_patterns, outlier_sessions };
}

export function patternsCli(db: Database.Database, options: AnalyticsCliOptions): void {
  const filters = parseAnalyticsOptions(options);
  const result = patternsQuery(db, filters);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold('\nAnti-Patterns\n'));
  if (result.anti_patterns.length === 0) {
    console.log('  None detected.');
  }
  for (const p of result.anti_patterns) {
    console.log(`  ${chalk.yellow(p.pattern)}: ${p.description}`);
    console.log(`    ${p.frequency} occurrences across ${p.sessions_affected} sessions`);
  }

  console.log(chalk.bold('\nOutlier Sessions\n'));
  if (result.outlier_sessions.length === 0) {
    console.log('  None detected.');
  }
  for (const o of result.outlier_sessions) {
    console.log(`  ${o.session_id.slice(0, 8)}  ${o.workspace}  ${o.reason}`);
  }
  console.log();
}
