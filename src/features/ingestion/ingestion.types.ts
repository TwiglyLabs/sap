/** Result of ingesting a single session's transcript. */
export interface IngestResult {
  sessionId: string;
  turns: number;
  toolCalls: number;
  skipped: boolean;
}

/** Options for single-session ingestion. */
export interface IngestOptions {
  force?: boolean;
}

/** Aggregated result of batch ingestion across multiple sessions. */
export interface BatchResult {
  ingested: number;
  skipped: number;
  errors: { session_id: string; error: string }[];
  results: IngestResult[];
}

/** Options for batch ingestion: filter by session, time window, or force re-ingestion. */
export interface BatchOptions {
  sessionId?: string;
  sinceMs?: number;
  force?: boolean;
}
