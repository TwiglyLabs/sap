export interface IngestResult {
  sessionId: string;
  turns: number;
  toolCalls: number;
  skipped: boolean;
  error?: string;
}

export interface IngestOptions {
  force?: boolean;
}

export interface BatchResult {
  ingested: number;
  skipped: number;
  errors: { session_id: string; error: string }[];
  results: IngestResult[];
}

export interface BatchOptions {
  sessionId?: string;
  sinceMs?: number;
  force?: boolean;
}
