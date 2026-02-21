export interface FilterOptions {
  workspace?: string;
  sinceMs?: number;
}

export interface WhereClause {
  clause: string;
  params: unknown[];
}

export interface AnalyticsCliOptions {
  since?: string;
  workspace?: string;
  json?: boolean;
}

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

export interface SessionAnalytics {
  session_id: string;
  workspace: string;
  started_at: number;
  duration_min: number;
  turns: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  error_count: number;
  error_rate: number;
  outcome: {
    committed: boolean;
    tests_passed: boolean | null;
  };
}

export interface SessionsAnalyticsResult {
  sessions: SessionAnalytics[];
}

export interface PatternsResult {
  anti_patterns: {
    pattern: string;
    description: string;
    frequency: number;
    sessions_affected: number;
  }[];
  outlier_sessions: {
    session_id: string;
    workspace: string;
    reason: string;
    value: number;
  }[];
}

export interface QueryResult {
  rows: Record<string, unknown>[];
  error?: string;
}
