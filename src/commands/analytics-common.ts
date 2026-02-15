export function parseDuration(s: string): number {
  const match = s.match(/^(\d+)([dhm])$/);
  if (!match) throw new Error(`Invalid duration: ${s}. Use format like "7d", "24h", "30m".`);
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return n * 86400 * 1000;
    case 'h': return n * 3600 * 1000;
    case 'm': return n * 60 * 1000;
    default: throw new Error(`Invalid duration unit: ${match[2]}`);
  }
}

export interface FilterOptions {
  workspace?: string;
  sinceMs?: number;
}

export interface WhereClause {
  clause: string;
  params: unknown[];
}

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

export interface AnalyticsCliOptions {
  since?: string;
  workspace?: string;
  json?: boolean;
}

export function parseAnalyticsOptions(options: AnalyticsCliOptions): FilterOptions {
  return {
    workspace: options.workspace,
    sinceMs: options.since ? parseDuration(options.since) : undefined,
  };
}
