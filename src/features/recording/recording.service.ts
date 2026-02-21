import type { EventType, HookPayload, SessionStartSource, SessionState } from '../../core/types.ts';
import { extractToolDetail } from '../ingestion/tool-detail.ts';
import type { RecordingRepository } from './recording.repository.ts';
import type { WorkspaceService } from '../workspace/workspace.service.ts';

export class RecordingService {
  constructor(
    private repo: RecordingRepository,
    private workspaceService: WorkspaceService,
  ) {}

  recordEvent(eventType: EventType, data: HookPayload): void {
    const now = Date.now();

    if (eventType === 'session-start') {
      const workspace = this.workspaceService.resolveWorkspace(data.cwd, true);
      this.repo.transaction(() => {
        this.handleSessionStart(data, now, workspace);
      });
      return;
    }

    this.repo.transaction(() => {
      switch (eventType) {
        case 'session-end':
          return this.handleStateChange(data, eventType, 'stopped', now);
        case 'turn-complete':
          return this.handleStateChange(data, eventType, 'idle', now);
        case 'attention-permission':
        case 'attention-idle':
          return this.handleStateChange(data, eventType, 'attention', now);
        case 'user-prompt':
          return this.handleStateChange(data, eventType, 'active', now);
        case 'tool-use':
          return this.handleToolUse(data, now);
      }
    });
  }

  private handleSessionStart(data: HookPayload, now: number, workspace: string): void {
    const source: SessionStartSource = data.source ?? 'startup';

    switch (source) {
      case 'startup':
      case 'clear': {
        this.repo.upsertSession({
          session_id: data.session_id,
          workspace,
          cwd: data.cwd,
          transcript_path: data.transcript_path || null,
          started_at: now,
        });
        this.repo.insertEvent({
          session_id: data.session_id,
          event_type: 'session-start',
          data: JSON.stringify({ source }),
          created_at: now,
        });
        break;
      }
      case 'resume': {
        const existing = this.repo.getSession(data.session_id);
        if (existing) {
          this.repo.updateSessionState(data.session_id, 'active', now);
        } else {
          this.repo.insertSession({
            session_id: data.session_id,
            workspace,
            cwd: data.cwd,
            transcript_path: data.transcript_path || null,
            started_at: now,
          });
        }
        this.repo.insertEvent({
          session_id: data.session_id,
          event_type: 'session-start',
          data: JSON.stringify({ source }),
          created_at: now,
        });
        break;
      }
      case 'compact': {
        const existing = this.repo.getSession(data.session_id);
        if (!existing) return;
        this.repo.updateSessionState(data.session_id, existing.state, now);
        this.repo.insertEvent({
          session_id: data.session_id,
          event_type: 'session-start',
          data: JSON.stringify({ source }),
          created_at: now,
        });
        break;
      }
    }
  }

  private handleStateChange(
    data: HookPayload,
    eventType: EventType,
    newState: SessionState,
    now: number,
  ): void {
    const session = this.repo.getSession(data.session_id);
    if (!session) return;
    if (session.state === 'stopped') return;

    this.repo.updateSessionState(data.session_id, newState, now);

    let eventData: string | null = null;
    if (data.reason) {
      eventData = JSON.stringify({ reason: data.reason });
    } else if (data.prompt) {
      eventData = JSON.stringify({ prompt: data.prompt });
    }

    this.repo.insertEvent({
      session_id: data.session_id,
      event_type: eventType,
      data: eventData,
      created_at: now,
    });
  }

  private handleToolUse(data: HookPayload, now: number): void {
    const session = this.repo.getSession(data.session_id);
    if (!session) return;
    if (session.state === 'stopped') return;

    const toolName = data.tool_name ?? 'unknown';
    const toolDetail = extractToolDetail(toolName, data.tool_input ?? null);

    this.repo.updateSessionState(data.session_id, 'active', now, { tool: toolName, detail: toolDetail });
    this.repo.insertEvent({
      session_id: data.session_id,
      event_type: 'tool-use',
      data: JSON.stringify({ tool_name: toolName, tool_detail: toolDetail }),
      created_at: now,
    });
  }
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
