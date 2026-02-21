import type Database from 'better-sqlite3';
import type { AnalyticsRepository } from '../analytics.repository.ts';
import type {
  FilterOptions,
  SummaryResult,
  ToolsResult,
  SessionAnalytics,
  SessionsAnalyticsResult,
  PatternsResult,
  QueryResult,
} from '../analytics.types.ts';
import { buildWhereClause } from '../analytics.utils.ts';

const SAFE_PATTERN = /^\s*(SELECT|WITH|EXPLAIN|PRAGMA\s+table_info|PRAGMA\s+index_list)\b/i;

export class AnalyticsRepositorySqlite implements AnalyticsRepository {
  constructor(private db: Database.Database) {}

  summaryQuery(filters: FilterOptions): SummaryResult {
    const { clause, params } = buildWhereClause(filters, 't.started_at');
    const joinBase = 'FROM turns t JOIN sessions s ON t.session_id = s.session_id';

    const sessionStats = this.db.prepare(`
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

    const tokenStats = this.db.prepare(`
      SELECT coalesce(sum(t.input_tokens), 0) as total_input,
             coalesce(sum(t.output_tokens), 0) as total_output,
             coalesce(sum(t.cache_read_tokens), 0) as total_cache_read,
             coalesce(sum(t.cache_write_tokens), 0) as total_cache_write
      ${joinBase} ${clause}
    `).get(...params) as { total_input: number; total_output: number; total_cache_read: number; total_cache_write: number };

    const byWorkspace = this.db.prepare(`
      SELECT s.workspace, count(DISTINCT t.session_id) as count
      ${joinBase} ${clause}
      GROUP BY s.workspace ORDER BY count DESC LIMIT 10
    `).all(...params) as { workspace: string; count: number }[];

    const toolJoin = 'FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id';
    const toolWhere = buildWhereClause(filters, 'tc.created_at');

    const toolStats = this.db.prepare(`
      SELECT count(*) as total_calls
      ${toolJoin} ${toolWhere.clause}
    `).get(...toolWhere.params) as { total_calls: number };

    const topTools = this.db.prepare(`
      SELECT tc.tool_name as tool, count(*) as count,
             round(1.0 * sum(CASE WHEN tc.success = 1 THEN 1 ELSE 0 END) / nullif(count(tc.success), 0), 2) as success_rate
      ${toolJoin} ${toolWhere.clause}
      GROUP BY tc.tool_name ORDER BY count DESC LIMIT 10
    `).all(...toolWhere.params) as { tool: string; count: number; success_rate: number }[];

    const totalSessions = sessionStats.total_sessions || 1;
    const totalTurns = sessionStats.total_turns || 1;

    const now = new Date();
    const since = filters.sinceMs ? new Date(now.getTime() - filters.sinceMs).toISOString() : null;

    return {
      period: { since, until: now.toISOString() },
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
      tools: { total_calls: toolStats.total_calls, top: topTools },
    };
  }

  toolsQuery(filters: FilterOptions): ToolsResult {
    const { clause, params } = buildWhereClause(filters, 'tc.created_at');
    const joinBase = 'FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id';

    const tools = this.db.prepare(`
      SELECT tc.tool_name as tool,
             count(*) as count,
             round(1.0 * sum(CASE WHEN tc.success = 1 THEN 1 ELSE 0 END) / nullif(count(tc.success), 0), 2) as success_rate,
             sum(CASE WHEN tc.success = 0 THEN 1 ELSE 0 END) as error_count
      ${joinBase} ${clause}
      GROUP BY tc.tool_name ORDER BY count DESC
    `).all(...params) as { tool: string; count: number; success_rate: number; error_count: number }[];

    const toolsWithDetails = tools.map(t => {
      const errors = this.db.prepare(`
        SELECT DISTINCT tc.error_message
        ${joinBase} ${clause ? clause + ' AND' : 'WHERE'} tc.tool_name = ? AND tc.error_message IS NOT NULL
        LIMIT 5
      `).all(...params, t.tool) as { error_message: string }[];

      const workspaces = this.db.prepare(`
        SELECT s.workspace, count(*) as count
        ${joinBase} ${clause ? clause + ' AND' : 'WHERE'} tc.tool_name = ?
        GROUP BY s.workspace ORDER BY count DESC LIMIT 5
      `).all(...params, t.tool) as { workspace: string; count: number }[];

      return { ...t, top_errors: errors.map(e => e.error_message), workspaces };
    });

    const sequenceQuery = `
      SELECT tc1.tool_name as first, tc2.tool_name as second, count(*) as count
      FROM tool_calls tc1
      JOIN tool_calls tc2 ON tc1.turn_id = tc2.turn_id AND tc2.id = (
        SELECT min(id) FROM tool_calls WHERE turn_id = tc1.turn_id AND id > tc1.id
      )
      JOIN sessions s ON tc1.session_id = s.session_id
      ${clause}
      GROUP BY tc1.tool_name, tc2.tool_name
      ORDER BY count DESC
      LIMIT 20
    `;

    const sequences = this.db.prepare(sequenceQuery).all(...params) as { first: string; second: string; count: number }[];

    return {
      tools: toolsWithDetails,
      sequences: sequences.map(s => ({ sequence: [s.first, s.second], count: s.count })),
    };
  }

  sessionsAnalyticsQuery(filters: FilterOptions, limit: number = 20): SessionsAnalyticsResult {
    const { clause, params } = buildWhereClause(filters, 't.started_at');
    const joinBase = 'FROM turns t JOIN sessions s ON t.session_id = s.session_id';

    const rows = this.db.prepare(`
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
      const toolStats = this.db.prepare(`
        SELECT count(*) as total,
               sum(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
        FROM tool_calls WHERE session_id = ?
      `).get(row.session_id) as { total: number; errors: number };

      const hasCommit = this.db.prepare(`
        SELECT 1 FROM tool_calls
        WHERE session_id = ? AND tool_name = 'Bash' AND tool_input_summary LIKE 'git commit%' AND success = 1
        LIMIT 1
      `).get(row.session_id);

      const testRuns = this.db.prepare(`
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

  patternsQuery(filters: FilterOptions): PatternsResult {
    const { clause, params } = buildWhereClause(filters, 'tc.created_at');
    const joinBase = 'FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id';

    const anti_patterns: PatternsResult['anti_patterns'] = [];

    const editRetries = this.db.prepare(`
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

    const bashErrors = this.db.prepare(`
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

    const turnWhere = buildWhereClause(filters, 't.started_at');
    const turnJoin = 'FROM turns t JOIN sessions s ON t.session_id = s.session_id';

    const avgTokens = this.db.prepare(`
      SELECT avg(session_input) as avg_input FROM (
        SELECT sum(t.input_tokens) as session_input
        ${turnJoin} ${turnWhere.clause}
        GROUP BY t.session_id
      )
    `).get(...turnWhere.params) as { avg_input: number | null };

    const outlier_sessions: PatternsResult['outlier_sessions'] = [];

    if (avgTokens.avg_input && avgTokens.avg_input > 0) {
      const threshold = avgTokens.avg_input * 3;
      const outliers = this.db.prepare(`
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

  executeQuery(sql: string): QueryResult {
    const stripped = sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '').trim();
    if (!SAFE_PATTERN.test(stripped)) {
      return { rows: [], error: 'Read-only: only SELECT, WITH, and EXPLAIN queries are allowed' };
    }

    try {
      const rows = this.db.prepare(sql).all() as Record<string, unknown>[];
      return { rows };
    } catch (err) {
      return { rows: [], error: err instanceof Error ? err.message : String(err) };
    }
  }
}
