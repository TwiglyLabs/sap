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
}

export interface SessionStatus extends Session {
  stale: boolean;
}

export interface WorkspaceEntry {
  cwd: string;
  repo_name: string;
  branch: string;
  workspace: string;
  resolved_at: number;
}
