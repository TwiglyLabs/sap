import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './db.ts';
import { recordEvent } from './commands/record.ts';
import { statusQuery } from './commands/status.ts';
import { latestQuery } from './commands/latest.ts';
import { sessionsQuery } from './commands/sessions.ts';
import { gcCommand } from './commands/gc.ts';

describe('integration: full session lifecycle', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
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
    recordEvent(db, 'session-start', { ...base, source: 'startup' as const });

    let status = statusQuery(db);
    expect(status.sessions).toHaveLength(1);
    expect(status.sessions[0].state).toBe('active');

    // 2. Tool use
    recordEvent(db, 'tool-use', {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/home/user/src/app.ts' },
    });

    status = statusQuery(db);
    expect(status.sessions[0].last_tool).toBe('Edit');
    expect(status.sessions[0].last_tool_detail).toBe('app.ts');

    // 3. Turn complete — Claude done responding
    recordEvent(db, 'turn-complete', { ...base, hook_event_name: 'Stop' });

    status = statusQuery(db);
    expect(status.sessions[0].state).toBe('idle');

    // 4. User submits another prompt
    recordEvent(db, 'user-prompt', { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'fix the bug' });

    status = statusQuery(db);
    expect(status.sessions[0].state).toBe('active');

    // 5. Permission prompt — attention needed
    recordEvent(db, 'attention-permission', { ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt' });

    status = statusQuery(db);
    expect(status.sessions[0].state).toBe('attention');

    // 6. User responds — clears attention
    recordEvent(db, 'user-prompt', { ...base, hook_event_name: 'UserPromptSubmit' });

    status = statusQuery(db);
    expect(status.sessions[0].state).toBe('active');

    // 7. Session ends
    recordEvent(db, 'session-end', { ...base, hook_event_name: 'SessionEnd', reason: 'logout' });

    status = statusQuery(db);
    expect(status.sessions).toHaveLength(0); // stopped sessions excluded

    // 8. Latest still returns it
    const latest = latestQuery(db, 'tmp:local');
    expect(latest).not.toBeNull();
    expect(latest!.state).toBe('stopped');

    // 9. Shows in history
    const history = sessionsQuery(db, { limit: 20 });
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
    recordEvent(db, 'session-start', { ...base, source: 'startup' as const });
    recordEvent(db, 'session-end', { ...base, hook_event_name: 'SessionEnd' });

    // Resume the same session
    recordEvent(db, 'session-start', { ...base, source: 'resume' as const });

    const status = statusQuery(db);
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

    recordEvent(db, 'session-start', { ...mkPayload('s1', '/tmp/repo-a'), source: 'startup' as const });
    recordEvent(db, 'session-start', { ...mkPayload('s2', '/tmp/repo-b'), source: 'startup' as const });

    const status = statusQuery(db);
    expect(status.sessions).toHaveLength(2);
  });
});
