import type {
  FilterOptions,
  SummaryResult,
  ToolsResult,
  SessionsAnalyticsResult,
  PatternsResult,
  QueryResult,
} from './analytics.types.ts';

export interface AnalyticsRepository {
  summaryQuery(filters: FilterOptions): SummaryResult;
  toolsQuery(filters: FilterOptions): ToolsResult;
  sessionsAnalyticsQuery(filters: FilterOptions, limit: number): SessionsAnalyticsResult;
  patternsQuery(filters: FilterOptions): PatternsResult;
  executeQuery(sql: string): QueryResult;
}
