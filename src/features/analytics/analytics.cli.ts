import chalk from 'chalk';
import type { AnalyticsService } from './analytics.service.ts';
import type { AnalyticsCliOptions } from './analytics.types.ts';
import { parseAnalyticsOptions } from './analytics.utils.ts';

export function summaryCli(service: AnalyticsService, options: AnalyticsCliOptions): void {
  const filters = parseAnalyticsOptions(options);
  const result = service.summary(filters);

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

export function toolsCli(service: AnalyticsService, options: AnalyticsCliOptions): void {
  const filters = parseAnalyticsOptions(options);
  const result = service.tools(filters);

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

export function sessionsAnalyticsCli(service: AnalyticsService, options: AnalyticsCliOptions & { limit?: string }): void {
  const filters = parseAnalyticsOptions(options);
  const limit = options.limit ? parseInt(options.limit, 10) : 20;
  const result = service.sessionsAnalytics(filters, limit);

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

export function patternsCli(service: AnalyticsService, options: AnalyticsCliOptions): void {
  const filters = parseAnalyticsOptions(options);
  const result = service.patterns(filters);

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

export function queryCli(service: AnalyticsService, sql: string, options: { json?: boolean }): void {
  const result = service.executeQuery(sql);

  if (result.error) {
    if (options.json) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      console.error(`${chalk.red('Error:')} ${result.error}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log(JSON.stringify(result.rows, null, 2));
}
