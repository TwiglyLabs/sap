import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { buildWhereClause, type FilterOptions, type AnalyticsCliOptions, parseAnalyticsOptions } from './analytics-common.ts';

export interface ToolsResult {
  tools: {
    tool: string;
    count: number;
    success_rate: number;
    error_count: number;
    top_errors: string[];
    workspaces: { workspace: string; count: number }[];
  }[];
  sequences: {
    sequence: string[];
    count: number;
  }[];
}

export function toolsQuery(db: Database.Database, filters: FilterOptions): ToolsResult {
  const { clause, params } = buildWhereClause(filters, 'tc.created_at');
  const joinBase = 'FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id';

  // Per-tool breakdown
  const tools = db.prepare(`
    SELECT tc.tool_name as tool,
           count(*) as count,
           round(1.0 * sum(CASE WHEN tc.success = 1 THEN 1 ELSE 0 END) / nullif(count(tc.success), 0), 2) as success_rate,
           sum(CASE WHEN tc.success = 0 THEN 1 ELSE 0 END) as error_count
    ${joinBase} ${clause}
    GROUP BY tc.tool_name ORDER BY count DESC
  `).all(...params) as { tool: string; count: number; success_rate: number; error_count: number }[];

  // Get top errors and workspace breakdown per tool
  const toolsWithDetails = tools.map(t => {
    const errors = db.prepare(`
      SELECT DISTINCT tc.error_message
      ${joinBase} ${clause ? clause + ' AND' : 'WHERE'} tc.tool_name = ? AND tc.error_message IS NOT NULL
      LIMIT 5
    `).all(...params, t.tool) as { error_message: string }[];

    const workspaces = db.prepare(`
      SELECT s.workspace, count(*) as count
      ${joinBase} ${clause ? clause + ' AND' : 'WHERE'} tc.tool_name = ?
      GROUP BY s.workspace ORDER BY count DESC LIMIT 5
    `).all(...params, t.tool) as { workspace: string; count: number }[];

    return {
      ...t,
      top_errors: errors.map(e => e.error_message),
      workspaces,
    };
  });

  // Tool sequences (bigram analysis: consecutive tool calls within a turn)
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

  const sequences = db.prepare(sequenceQuery).all(...params) as { first: string; second: string; count: number }[];

  return {
    tools: toolsWithDetails,
    sequences: sequences.map(s => ({ sequence: [s.first, s.second], count: s.count })),
  };
}

export function toolsCli(db: Database.Database, options: AnalyticsCliOptions): void {
  const filters = parseAnalyticsOptions(options);
  const result = toolsQuery(db, filters);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold('\nTool Usage\n'));
  for (const t of result.tools) {
    const rate = t.success_rate !== null ? ` (${Math.round(t.success_rate * 100)}% success)` : '';
    console.log(`  ${t.tool}: ${t.count} calls${rate}`);
    if (t.top_errors.length > 0) {
      for (const e of t.top_errors) {
        console.log(`    ${chalk.red('error:')} ${e}`);
      }
    }
  }

  if (result.sequences.length > 0) {
    console.log(chalk.bold('\nCommon Sequences:'));
    for (const s of result.sequences.slice(0, 10)) {
      console.log(`  ${s.sequence.join(' → ')}: ${s.count}`);
    }
  }
  console.log();
}
