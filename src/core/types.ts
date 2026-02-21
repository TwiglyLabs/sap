export type SessionState = 'active' | 'idle' | 'attention' | 'stopped';

export type EventType =
  | 'session-start'
  | 'session-end'
  | 'turn-complete'
  | 'attention-permission'
  | 'attention-idle'
  | 'user-prompt'
  | 'tool-use';

export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact';

export interface HookPayload {
  session_id: string;
  cwd: string;
  transcript_path: string;
  permission_mode: string;
  hook_event_name: string;
  // SessionStart
  source?: SessionStartSource;
  model?: string;
  // SessionEnd
  reason?: string;
  // PostToolUse
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  // UserPromptSubmit
  prompt?: string;
  // Notification
  message?: string;
  notification_type?: string;
  // Stop
  stop_hook_active?: boolean;
}

export interface Session {
  session_id: string;
  workspace: string;
  cwd: string;
  transcript_path: string | null;
  state: SessionState;
  started_at: number;
  ended_at: number | null;
  last_event_at: number;
  last_tool: string | null;
  last_tool_detail: string | null;
  ingested_at: number | null;
}

export interface SessionStatus extends Session {
  stale: boolean;
}

export interface Turn {
  id: number;
  session_id: string;
  turn_number: number;
  prompt_text: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  model: string | null;
  tool_call_count: number;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null;
}

export interface ToolCall {
  id: number;
  session_id: string;
  turn_id: number;
  tool_use_id: string | null;
  tool_name: string;
  tool_input_summary: string | null;
  success: number | null;
  error_message: string | null;
  created_at: number;
}

export interface WorkspaceEntry {
  cwd: string;
  repo_name: string;
  branch: string;
  workspace: string;
  resolved_at: number;
}
