import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, getSession, getSessionEvents } from '../db.ts';
import { recordEvent, parsePayload } from './record.ts';
import type { HookPayload } from '../types.ts';

// Helper: build a minimal payload
function payload(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    session_id: 'sess-1',
    cwd: '/tmp/fakerepo',
    transcript_path: '/tmp/transcript.jsonl',
    permission_mode: 'default',
    hook_event_name: 'SessionStart',
    ...overrides,
  };
}

describe('recordEvent', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  describe('session-start', () => {
    it('creates a new session on startup', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));

      const session = getSession(db, 'sess-1');
      expect(session).not.toBeNull();
      expect(session!.state).toBe('active');
      expect(session!.workspace).toMatch(/:/);
    });

    it('records a session-start event', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));

      const events = getSessionEvents(db, 'sess-1');
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('session-start');
    });

    it('resumes existing session on resume source', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'turn-complete', payload());

      recordEvent(db, 'session-start', payload({ source: 'resume' }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('active');
    });

    it('creates new session if resume for unknown session_id', () => {
      recordEvent(db, 'session-start', payload({ session_id: 'new-sess', source: 'resume' }));

      const session = getSession(db, 'new-sess');
      expect(session).not.toBeNull();
      expect(session!.state).toBe('active');
    });

    it('updates last_event_at on compact without changing state', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'turn-complete', payload());

      const before = getSession(db, 'sess-1');
      expect(before!.state).toBe('idle');

      recordEvent(db, 'session-start', payload({ source: 'compact' }));

      const after = getSession(db, 'sess-1');
      expect(after!.state).toBe('idle');
      expect(after!.last_event_at).toBeGreaterThanOrEqual(before!.last_event_at);
    });

    it('ignores compact for unknown session', () => {
      recordEvent(db, 'session-start', payload({ session_id: 'unknown', source: 'compact' }));
      expect(getSession(db, 'unknown')).toBeNull();
    });
  });

  describe('session-end', () => {
    it('stops the session and sets ended_at', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'session-end', payload({ reason: 'logout' }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('stopped');
      expect(session!.ended_at).not.toBeNull();
    });

    it('ignores session-end for unknown session', () => {
      recordEvent(db, 'session-end', payload({ session_id: 'ghost' }));
    });
  });

  describe('turn-complete', () => {
    it('sets session to idle', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'turn-complete', payload());

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('idle');
    });
  });

  describe('attention events', () => {
    it('sets session to attention on permission prompt', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'attention-permission', payload({ hook_event_name: 'Notification' }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('attention');
    });

    it('sets session to attention on idle', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'attention-idle', payload({ hook_event_name: 'Notification' }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('attention');
    });
  });

  describe('user-prompt', () => {
    it('clears attention state back to active', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'attention-permission', payload());
      expect(getSession(db, 'sess-1')!.state).toBe('attention');

      recordEvent(db, 'user-prompt', payload());
      expect(getSession(db, 'sess-1')!.state).toBe('active');
    });

    it('clears idle state back to active', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'turn-complete', payload());
      expect(getSession(db, 'sess-1')!.state).toBe('idle');

      recordEvent(db, 'user-prompt', payload());
      expect(getSession(db, 'sess-1')!.state).toBe('active');
    });
  });

  describe('tool-use', () => {
    it('sets state to active and records tool info', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'tool-use', payload({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: '/home/user/src/app.ts' },
      }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('active');
      expect(session!.last_tool).toBe('Edit');
      expect(session!.last_tool_detail).toBe('app.ts');
    });

    it('records tool-use event with tool data', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'tool-use', payload({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
      }));

      const events = getSessionEvents(db, 'sess-1');
      const toolEvent = events.find(e => e.event_type === 'tool-use');
      expect(toolEvent).toBeDefined();
      const data = JSON.parse(toolEvent!.data!);
      expect(data.tool_name).toBe('Bash');
      expect(data.tool_detail).toBe('npm test');
    });

    it('handles missing tool_name gracefully', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'tool-use', payload());

      const session = getSession(db, 'sess-1');
      expect(session!.last_tool).toBe('unknown');
    });
  });
});

describe('parsePayload', () => {
  it('parses valid JSON', () => {
    const result = parsePayload('{"session_id": "s1", "cwd": "/tmp", "transcript_path": "/t", "permission_mode": "default", "hook_event_name": "SessionStart"}');
    expect(result.session_id).toBe('s1');
  });

  it('throws on invalid JSON', () => {
    expect(() => parsePayload('not json')).toThrow();
  });

  it('throws on missing session_id', () => {
    expect(() => parsePayload('{"cwd": "/tmp"}')).toThrow(/session_id/);
  });

  it('throws on missing cwd', () => {
    expect(() => parsePayload('{"session_id": "s1"}')).toThrow(/cwd/);
  });
});
