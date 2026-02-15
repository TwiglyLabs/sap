import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { buildWhereClause, type FilterOptions, type AnalyticsCliOptions, parseAnalyticsOptions } from './analytics-common.ts';

export interface SummaryResult {
  period: {
    since: string | null;
    until: string;
  };
  sessions: {
    total: number;
    avg_turns: number;
    avg_duration_min: number;
    by_workspace: { workspace: string; count: number }[];
  };
  tokens: {
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_cache_write: number;
    avg_per_session: { input: number; output: number };
    avg_per_turn: { input: number; output: number };
  };
  tools: {
    total_calls: number;
    top: { tool: string; count: number; success_rate: number }[];
  };
}

export function summaryQuery(db: Database.Database, filters: FilterOptions): SummaryResult {
  const { clause, params } = buildWhereClause(filters, 't.started_at');

  // Build a join base: turns joined with sessions for workspace filter
  const joinBase = 'FROM turns t JOIN sessions s ON t.session_id = s.session_id';

  // Session count, avg turns, and avg duration
  const sessionStats = db.prepare(`
    SELECT count(DISTINCT t.session_id) as total_sessions,
           count(*) as total_turns,
           coalesce(avg(session_dur.duration_ms), 0) as avg_duration_ms
    ${joinBase}
    LEFT JOIN (
      SELECT session_id, sum(duration_ms) as duration_ms
      FROM turns GROUP BY session_id
    ) session_dur ON session_dur.session_id = t.session_id
    ${clause}
  `).get(...params) as { total_sessions: number; total_turns: number; avg_duration_ms: number };

  // Token totals
  const tokenStats = db.prepare(`
    SELECT coalesce(sum(t.input_tokens), 0) as total_input,
           coalesce(sum(t.output_tokens), 0) as total_output,
           coalesce(sum(t.cache_read_tokens), 0) as total_cache_read,
           coalesce(sum(t.cache_write_tokens), 0) as total_cache_write
    ${joinBase} ${clause}
  `).get(...params) as { total_input: number; total_output: number; total_cache_read: number; total_cache_write: number };

  // By workspace
  const byWorkspace = db.prepare(`
    SELECT s.workspace, count(DISTINCT t.session_id) as count
    ${joinBase} ${clause}
    GROUP BY s.workspace ORDER BY count DESC LIMIT 10
  `).all(...params) as { workspace: string; count: number }[];

  // Tool stats - need separate where clause for tool_calls table
  const toolJoin = 'FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id';
  const toolWhere = buildWhereClause(filters, 'tc.created_at');

  const toolStats = db.prepare(`
    SELECT count(*) as total_calls
    ${toolJoin} ${toolWhere.clause}
  `).get(...toolWhere.params) as { total_calls: number };

  const topTools = db.prepare(`
    SELECT tc.tool_name as tool, count(*) as count,
           round(1.0 * sum(CASE WHEN tc.success = 1 THEN 1 ELSE 0 END) / nullif(count(tc.success), 0), 2) as success_rate
    ${toolJoin} ${toolWhere.clause}
    GROUP BY tc.tool_name ORDER BY count DESC LIMIT 10
  `).all(...toolWhere.params) as { tool: string; count: number; success_rate: number }[];

  const totalSessions = sessionStats.total_sessions || 1;
  const totalTurns = sessionStats.total_turns || 1;

  // Period metadata
  const now = new Date();
  const since = filters.sinceMs ? new Date(now.getTime() - filters.sinceMs).toISOString() : null;

  return {
    period: {
      since,
      until: now.toISOString(),
    },
    sessions: {
      total: sessionStats.total_sessions,
      avg_turns: Math.round(sessionStats.total_turns / totalSessions * 10) / 10,
      avg_duration_min: Math.round(sessionStats.avg_duration_ms / 60000 * 10) / 10,
      by_workspace: byWorkspace,
    },
    tokens: {
      total_input: tokenStats.total_input,
      total_output: tokenStats.total_output,
      total_cache_read: tokenStats.total_cache_read,
      total_cache_write: tokenStats.total_cache_write,
      avg_per_session: {
        input: Math.round(tokenStats.total_input / totalSessions),
        output: Math.round(tokenStats.total_output / totalSessions),
      },
      avg_per_turn: {
        input: Math.round(tokenStats.total_input / totalTurns),
        output: Math.round(tokenStats.total_output / totalTurns),
      },
    },
    tools: {
      total_calls: toolStats.total_calls,
      top: topTools,
    },
  };
}

export function summaryCli(db: Database.Database, options: AnalyticsCliOptions): void {
  const filters = parseAnalyticsOptions(options);
  const result = summaryQuery(db, filters);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold('\nUsage Summary\n'));
  console.log(`  Sessions: ${result.sessions.total}  (avg ${result.sessions.avg_turns} turns, ${result.sessions.avg_duration_min} min)`);
  console.log(`  Tokens:   ${result.tokens.total_input.toLocaleString()} in / ${result.tokens.total_output.toLocaleString()} out`);
  console.log(`  Cache:    ${result.tokens.total_cache_read.toLocaleString()} read / ${result.tokens.total_cache_write.toLocaleString()} write`);
  console.log(`  Tools:    ${result.tools.total_calls} calls\n`);

  if (result.sessions.by_workspace.length > 0) {
    console.log(chalk.bold('  Top Workspaces:'));
    for (const w of result.sessions.by_workspace) {
      console.log(`    ${w.workspace}: ${w.count} sessions`);
    }
    console.log();
  }

  if (result.tools.top.length > 0) {
    console.log(chalk.bold('  Top Tools:'));
    for (const t of result.tools.top) {
      const rate = t.success_rate !== null ? ` (${Math.round(t.success_rate * 100)}% success)` : '';
      console.log(`    ${t.tool}: ${t.count}${rate}`);
    }
    console.log();
  }
}
