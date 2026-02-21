import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createSap, type Sap } from '../src/sap.ts';

describe('integration: full session lifecycle', () => {
  let sap: Sap;

  beforeEach(() => {
    sap = createSap({ dbPath: ':memory:' });
  });

  afterEach(() => {
    sap.close();
  });

  it('tracks a complete session lifecycle', () => {
    const base = {
      session_id: 'int-sess-1',
      cwd: '/tmp',
      transcript_path: '/tmp/t.jsonl',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
    };

    // 1. Session starts
    sap.recording.recordEvent('session-start', { ...base, source: 'startup' as const });

    let status = sap.sessions.status();
    expect(status.sessions).toHaveLength(1);
    expect(status.sessions[0].state).toBe('active');

    // 2. Tool use
    sap.recording.recordEvent('tool-use', {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/home/user/src/app.ts' },
    });

    status = sap.sessions.status();
    expect(status.sessions[0].last_tool).toBe('Edit');
    expect(status.sessions[0].last_tool_detail).toBe('app.ts');

    // 3. Turn complete — Claude done responding
    sap.recording.recordEvent('turn-complete', { ...base, hook_event_name: 'Stop' });

    status = sap.sessions.status();
    expect(status.sessions[0].state).toBe('idle');

    // 4. User submits another prompt
    sap.recording.recordEvent('user-prompt', { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'fix the bug' });

    status = sap.sessions.status();
    expect(status.sessions[0].state).toBe('active');

    // 5. Permission prompt — attention needed
    sap.recording.recordEvent('attention-permission', { ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt' });

    status = sap.sessions.status();
    expect(status.sessions[0].state).toBe('attention');

    // 6. User responds — clears attention
    sap.recording.recordEvent('user-prompt', { ...base, hook_event_name: 'UserPromptSubmit' });

    status = sap.sessions.status();
    expect(status.sessions[0].state).toBe('active');

    // 7. Session ends
    sap.recording.recordEvent('session-end', { ...base, hook_event_name: 'SessionEnd', reason: 'logout' });

    status = sap.sessions.status();
    expect(status.sessions).toHaveLength(0); // stopped sessions excluded

    // 8. Latest still returns it
    const latest = sap.sessions.latest('tmp:local');
    expect(latest).not.toBeNull();
    expect(latest!.state).toBe('stopped');

    // 9. Shows in history
    const history = sap.sessions.sessions({ limit: 20 });
    expect(history).toHaveLength(1);
    expect(history[0].session_id).toBe('int-sess-1');
  });

  it('handles session resume correctly', () => {
    const base = {
      session_id: 'resume-sess',
      cwd: '/tmp',
      transcript_path: '/tmp/t.jsonl',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
    };

    // Start, then stop
    sap.recording.recordEvent('session-start', { ...base, source: 'startup' as const });
    sap.recording.recordEvent('session-end', { ...base, hook_event_name: 'SessionEnd' });

    // Resume the same session
    sap.recording.recordEvent('session-start', { ...base, source: 'resume' as const });

    const status = sap.sessions.status();
    expect(status.sessions).toHaveLength(1);
    expect(status.sessions[0].state).toBe('active');
    expect(status.sessions[0].session_id).toBe('resume-sess');
  });

  it('handles multiple concurrent sessions', () => {
    const mkPayload = (id: string, cwd: string) => ({
      session_id: id,
      cwd,
      transcript_path: `/tmp/${id}.jsonl`,
      permission_mode: 'default' as const,
      hook_event_name: 'SessionStart',
    });

    sap.recording.recordEvent('session-start', { ...mkPayload('s1', '/tmp/repo-a'), source: 'startup' as const });
    sap.recording.recordEvent('session-start', { ...mkPayload('s2', '/tmp/repo-b'), source: 'startup' as const });

    const status = sap.sessions.status();
    expect(status.sessions).toHaveLength(2);
  });
});
