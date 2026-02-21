import type { AnalyticsRepository } from './analytics.repository.ts';
import type {
  FilterOptions,
  SummaryResult,
  ToolsResult,
  SessionsAnalyticsResult,
  PatternsResult,
  QueryResult,
} from './analytics.types.ts';

export class AnalyticsService {
  constructor(private repo: AnalyticsRepository) {}

  summary(filters: FilterOptions): SummaryResult {
    return this.repo.summaryQuery(filters);
  }

  tools(filters: FilterOptions): ToolsResult {
    return this.repo.toolsQuery(filters);
  }

  sessionsAnalytics(filters: FilterOptions, limit: number = 20): SessionsAnalyticsResult {
    return this.repo.sessionsAnalyticsQuery(filters, limit);
  }

  patterns(filters: FilterOptions): PatternsResult {
    return this.repo.patternsQuery(filters);
  }

  executeQuery(sql: string): QueryResult {
    return this.repo.executeQuery(sql);
  }
}
