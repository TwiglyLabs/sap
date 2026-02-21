import type { AnalyticsRepository } from './analytics.repository.ts';
import type {
  FilterOptions,
  SummaryResult,
  ToolsResult,
  SessionsAnalyticsResult,
  PatternsResult,
  QueryResult,
} from './analytics.types.ts';

/** Usage analytics: aggregated metrics, tool breakdowns, per-session stats, pattern detection. */
export class AnalyticsService {
  constructor(private repo: AnalyticsRepository) {}

  /** High-level usage summary: session counts, token totals, top tools. */
  summary(filters: FilterOptions): SummaryResult {
    return this.repo.summaryQuery(filters);
  }

  /** Per-tool breakdown with success rates, errors, and common sequences. */
  tools(filters: FilterOptions): ToolsResult {
    return this.repo.toolsQuery(filters);
  }

  /** Per-session metrics for comparing efficiency across sessions. */
  sessionsAnalytics(filters: FilterOptions, limit: number = 20): SessionsAnalyticsResult {
    return this.repo.sessionsAnalyticsQuery(filters, limit);
  }

  /** Detect workflow anti-patterns and outlier sessions. */
  patterns(filters: FilterOptions): PatternsResult {
    return this.repo.patternsQuery(filters);
  }

  /** Execute a read-only SQL query against the SAP database. */
  executeQuery(sql: string): QueryResult {
    return this.repo.executeQuery(sql);
  }
}
