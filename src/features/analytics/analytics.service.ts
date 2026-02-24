import type { AnalyticsRepository } from './analytics.repository.ts';
import type {
  FilterOptions,
  SummaryResult,
  ToolsResult,
  SessionsAnalyticsResult,
  PatternsResult,
  QueryResult,
} from './analytics.types.ts';
import { noopLogger } from '@twiglylabs/log';
import type { Logger } from '@twiglylabs/log';

/** Usage analytics: aggregated metrics, tool breakdowns, per-session stats, pattern detection. */
export class AnalyticsService {
  private log: Logger;

  constructor(
    private repo: AnalyticsRepository,
    logger: Logger = noopLogger,
  ) {
    this.log = logger.child('sap:analytics');
  }

  /** High-level usage summary: session counts, token totals, top tools. */
  summary(filters: FilterOptions): SummaryResult {
    const start = Date.now();
    const result = this.repo.summaryQuery(filters);
    this.log.debug('analytics.summary', { durationMs: Date.now() - start });
    return result;
  }

  /** Per-tool breakdown with success rates, errors, and common sequences. */
  tools(filters: FilterOptions): ToolsResult {
    const start = Date.now();
    const result = this.repo.toolsQuery(filters);
    this.log.debug('analytics.tools', { durationMs: Date.now() - start });
    return result;
  }

  /** Per-session metrics for comparing efficiency across sessions. */
  sessionsAnalytics(filters: FilterOptions, limit: number = 20): SessionsAnalyticsResult {
    const start = Date.now();
    const result = this.repo.sessionsAnalyticsQuery(filters, limit);
    this.log.debug('analytics.sessionsAnalytics', { durationMs: Date.now() - start });
    return result;
  }

  /** Detect workflow anti-patterns and outlier sessions. */
  patterns(filters: FilterOptions): PatternsResult {
    const start = Date.now();
    const result = this.repo.patternsQuery(filters);
    this.log.debug('analytics.patterns', { durationMs: Date.now() - start });
    return result;
  }

  /** Execute a read-only SQL query against the SAP database. */
  executeQuery(sql: string): QueryResult {
    const start = Date.now();
    const result = this.repo.executeQuery(sql);
    this.log.debug('analytics.executeQuery', { durationMs: Date.now() - start });
    return result;
  }
}
