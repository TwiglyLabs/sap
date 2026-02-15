import type Database from 'better-sqlite3';
import type { EventType, HookPayload, SessionStartSource, SessionState } from '../types.ts';
import { insertSession, getSession, updateSessionState, insertEvent } from '../db.ts';
import { resolveWorkspace } from '../workspace.ts';
import { extractToolDetail } from '../tool-detail.ts';

export function recordEvent(db: Database.Database, eventType: EventType, data: HookPayload): void {
  const now = Date.now();

  const run = db.transaction(() => {
    switch (eventType) {
      case 'session-start':
        return handleSessionStart(db, data, now);
      case 'session-end':
        return handleStateChange(db, data, eventType, 'stopped', now);
      case 'turn-complete':
        return handleStateChange(db, data, eventType, 'idle', now);
      case 'attention-permission':
      case 'attention-idle':
        return handleStateChange(db, data, eventType, 'attention', now);
      case 'user-prompt':
        return handleStateChange(db, data, eventType, 'active', now);
      case 'tool-use':
        return handleToolUse(db, data, now);
    }
  });
  run();
}

function handleSessionStart(db: Database.Database, data: HookPayload, now: number): void {
  const source: SessionStartSource = data.source ?? 'startup';
  // session-start always force-resolves workspace (catches branch changes)
  const workspace = resolveWorkspace(db, data.cwd, true);

  switch (source) {
    case 'startup':
    case 'clear': {
      insertSession(db, {
        session_id: data.session_id,
        workspace,
        cwd: data.cwd,
        transcript_path: data.transcript_path || null,
        started_at: now,
      });
      insertEvent(db, {
        session_id: data.session_id,
        event_type: 'session-start',
        data: JSON.stringify({ source }),
        created_at: now,
      });
      break;
    }
    case 'resume': {
      const existing = getSession(db, data.session_id);
      if (existing) {
        updateSessionState(db, data.session_id, 'active', now);
      } else {
        insertSession(db, {
          session_id: data.session_id,
          workspace,
          cwd: data.cwd,
          transcript_path: data.transcript_path || null,
          started_at: now,
        });
      }
      insertEvent(db, {
        session_id: data.session_id,
        event_type: 'session-start',
        data: JSON.stringify({ source }),
        created_at: now,
      });
      break;
    }
    case 'compact': {
      const existing = getSession(db, data.session_id);
      if (!existing) return; // Ignore compact for unknown session
      updateSessionState(db, data.session_id, existing.state, now);
      insertEvent(db, {
        session_id: data.session_id,
        event_type: 'session-start',
        data: JSON.stringify({ source }),
        created_at: now,
      });
      break;
    }
  }
}

function handleStateChange(
  db: Database.Database,
  data: HookPayload,
  eventType: EventType,
  newState: SessionState,
  now: number,
): void {
  const session = getSession(db, data.session_id);
  if (!session) return;
  if (session.state === 'stopped') return;

  updateSessionState(db, data.session_id, newState, now);
  insertEvent(db, {
    session_id: data.session_id,
    event_type: eventType,
    data: data.reason ? JSON.stringify({ reason: data.reason }) : null,
    created_at: now,
  });
}

function handleToolUse(db: Database.Database, data: HookPayload, now: number): void {
  const session = getSession(db, data.session_id);
  if (!session) return;
  if (session.state === 'stopped') return;

  const toolName = data.tool_name ?? 'unknown';
  const toolDetail = extractToolDetail(toolName, data.tool_input ?? null);

  updateSessionState(db, data.session_id, 'active', now, { tool: toolName, detail: toolDetail });
  insertEvent(db, {
    session_id: data.session_id,
    event_type: 'tool-use',
    data: JSON.stringify({ tool_name: toolName, tool_detail: toolDetail }),
    created_at: now,
  });
}

export function parsePayload(raw: string): HookPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON input');
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.session_id !== 'string') throw new Error('Missing required field: session_id');
  if (typeof obj.cwd !== 'string') throw new Error('Missing required field: cwd');

  return {
    session_id: obj.session_id as string,
    cwd: obj.cwd as string,
    transcript_path: (obj.transcript_path as string) || '',
    permission_mode: (obj.permission_mode as string) ?? 'default',
    hook_event_name: (obj.hook_event_name as string) ?? '',
    source: obj.source as SessionStartSource | undefined,
    reason: obj.reason as string | undefined,
    tool_name: obj.tool_name as string | undefined,
    tool_input: obj.tool_input as Record<string, unknown> | undefined,
    tool_response: obj.tool_response as Record<string, unknown> | undefined,
    prompt: obj.prompt as string | undefined,
    message: obj.message as string | undefined,
    notification_type: obj.notification_type as string | undefined,
    stop_hook_active: obj.stop_hook_active as boolean | undefined,
  };
}
