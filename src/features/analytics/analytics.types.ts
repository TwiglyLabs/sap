/** Time and workspace filters for analytics queries. */
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

/** High-level usage metrics: session counts, token totals, top tools. */
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

/** Per-tool breakdown: usage counts, success rates, error details, and common sequences. */
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

/** Per-session metrics for comparing efficiency and outcomes. */
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

/** Collection of per-session analytics. */
export interface SessionsAnalyticsResult {
  sessions: SessionAnalytics[];
}

/** Detected anti-patterns and outlier sessions. */
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

/** Raw SQL query result: array of row objects. */
export interface QueryResult {
  rows: Record<string, unknown>[];
  error?: string;
}
