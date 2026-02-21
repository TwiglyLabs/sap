import { parseDuration } from '../../core/utils.ts';
import type { FilterOptions, WhereClause, AnalyticsCliOptions } from './analytics.types.ts';

export function buildWhereClause(
  filters: FilterOptions,
  timeColumn: string = 's.started_at',
): WhereClause {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.workspace) {
    conditions.push('s.workspace = ?');
    params.push(filters.workspace);
  }

  if (filters.sinceMs) {
    const cutoff = Date.now() - filters.sinceMs;
    conditions.push(`${timeColumn} >= ?`);
    params.push(cutoff);
  }

  if (conditions.length === 0) {
    return { clause: '', params: [] };
  }

  return { clause: 'WHERE ' + conditions.join(' AND '), params };
}

export function parseAnalyticsOptions(options: AnalyticsCliOptions): FilterOptions {
  return {
    workspace: options.workspace,
    sinceMs: options.since ? parseDuration(options.since) : undefined,
  };
}
