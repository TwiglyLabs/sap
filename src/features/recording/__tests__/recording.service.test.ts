import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../../core/storage.ts';
import { RecordingRepositorySqlite } from '../sqlite/recording.repository.sqlite.ts';
import { RecordingService, parsePayload } from '../recording.service.ts';
import { WorkspaceRepositorySqlite } from '../../workspace/sqlite/workspace.repository.sqlite.ts';
import { WorkspaceService } from '../../workspace/workspace.service.ts';
import { SessionRepositorySqlite } from '../../sessions/sqlite/session.repository.sqlite.ts';
import type { EventType, HookPayload } from '../../../core/types.ts';
import type Database from 'better-sqlite3';

function makeServices(db: Database.Database) {
  const recordingRepo = new RecordingRepositorySqlite(db);
  const workspaceRepo = new WorkspaceRepositorySqlite(db);
  const workspaceService = new WorkspaceService(workspaceRepo);
  const sessionRepo = new SessionRepositorySqlite(db);
  const recording = new RecordingService(recordingRepo, workspaceService);
  return { recording, sessionRepo, recordingRepo };
}

function basePayload(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    session_id: 'test-session',
    cwd: '/tmp/test-repo',
    transcript_path: '/tmp/test-repo/transcript.jsonl',
    permission_mode: 'default',
    hook_event_name: '',
    ...overrides,
  };
}

describe('RecordingService', () => {
  let db: Database.Database;
  let recording: RecordingService;
  let sessionRepo: SessionRepositorySqlite;

  beforeEach(() => {
    db = openDb(':memory:');
    const services = makeServices(db);
    recording = services.recording;
    sessionRepo = services.sessionRepo;
  });

  describe('session-start events', () => {
    it('creates a new session on startup', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));

      const session = sessionRepo.getSession('test-session');
      expect(session).not.toBeNull();
      expect(session!.state).toBe('active');
    });

    it('records session-start event', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));

      const events = sessionRepo.getSessionEvents('test-session');
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('session-start');
      expect(JSON.parse(events[0].data!).source).toBe('startup');
    });

    it('upserts session on duplicate session_id with startup', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('session-end', basePayload({ reason: 'done' }));

      // Re-start same session_id
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      const session = sessionRepo.getSession('test-session');
      expect(session!.state).toBe('active');
      expect(session!.ended_at).toBeNull();
    });

    it('upserts session on duplicate session_id with clear', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('tool-use', basePayload({ tool_name: 'Read' }));

      recording.recordEvent('session-start', basePayload({ source: 'clear' }));
      const session = sessionRepo.getSession('test-session');
      expect(session!.state).toBe('active');
      expect(session!.last_tool).toBeNull();
      expect(session!.last_tool_detail).toBeNull();
    });

    it('resumes existing session on resume source', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('session-end', basePayload({ reason: 'logout' }));

      recording.recordEvent('session-start', basePayload({ source: 'resume' }));
      const session = sessionRepo.getSession('test-session');
      expect(session!.state).toBe('active');
    });

    it('creates new session if resume for unknown session_id', () => {
      recording.recordEvent('session-start', basePayload({
        session_id: 'unknown-resume',
        source: 'resume',
      }));

      const session = sessionRepo.getSession('unknown-resume');
      expect(session).not.toBeNull();
      expect(session!.state).toBe('active');
    });

    it('updates last_event_at on compact without changing state', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('turn-complete', basePayload());

      const before = sessionRepo.getSession('test-session');
      expect(before!.state).toBe('idle');

      recording.recordEvent('session-start', basePayload({ source: 'compact' }));
      const after = sessionRepo.getSession('test-session');
      expect(after!.state).toBe('idle');
      expect(after!.last_event_at).toBeGreaterThanOrEqual(before!.last_event_at);
    });

    it('ignores compact for unknown session', () => {
      recording.recordEvent('session-start', basePayload({
        session_id: 'no-such-session',
        source: 'compact',
      }));
      expect(sessionRepo.getSession('no-such-session')).toBeNull();
    });
  });

  describe('session-end events', () => {
    it('stops the session and sets ended_at', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('session-end', basePayload({ reason: 'user_exit' }));

      const session = sessionRepo.getSession('test-session');
      expect(session!.state).toBe('stopped');
      expect(session!.ended_at).not.toBeNull();
    });

    it('records reason in event data', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('session-end', basePayload({ reason: 'user_exit' }));

      const events = sessionRepo.getSessionEvents('test-session');
      const endEvent = events.find(e => e.event_type === 'session-end');
      expect(endEvent).toBeDefined();
      expect(JSON.parse(endEvent!.data!).reason).toBe('user_exit');
    });

    it('ignores session-end for unknown session', () => {
      recording.recordEvent('session-end', basePayload({
        session_id: 'nonexistent',
        reason: 'done',
      }));
      expect(sessionRepo.getSession('nonexistent')).toBeNull();
    });

    it('ignores duplicate session-end', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('session-end', basePayload({ reason: 'first' }));
      recording.recordEvent('session-end', basePayload({ reason: 'second' }));

      const events = sessionRepo.getSessionEvents('test-session');
      const endEvents = events.filter(e => e.event_type === 'session-end');
      expect(endEvents).toHaveLength(1);
    });
  });

  describe('turn-complete events', () => {
    it('sets session to idle on turn-complete', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('turn-complete', basePayload());

      const session = sessionRepo.getSession('test-session');
      expect(session!.state).toBe('idle');
    });

    it('ignores turn-complete for unknown session_id', () => {
      recording.recordEvent('turn-complete', basePayload({ session_id: 'ghost' }));
      expect(sessionRepo.getSession('ghost')).toBeNull();
    });
  });

  describe('attention events', () => {
    it('sets session to attention on permission prompt', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('attention-permission', basePayload());

      expect(sessionRepo.getSession('test-session')!.state).toBe('attention');
    });

    it('sets session to attention on idle notification', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('attention-idle', basePayload());

      expect(sessionRepo.getSession('test-session')!.state).toBe('attention');
    });

    it('ignores attention for unknown session_id', () => {
      recording.recordEvent('attention-permission', basePayload({ session_id: 'ghost' }));
      expect(sessionRepo.getSession('ghost')).toBeNull();
    });
  });

  describe('user-prompt events', () => {
    it('clears attention state back to active', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('attention-permission', basePayload());
      recording.recordEvent('user-prompt', basePayload({ prompt: 'fix it' }));

      expect(sessionRepo.getSession('test-session')!.state).toBe('active');
    });

    it('clears idle state back to active', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('turn-complete', basePayload());
      recording.recordEvent('user-prompt', basePayload({ prompt: 'next task' }));

      expect(sessionRepo.getSession('test-session')!.state).toBe('active');
    });

    it('stores prompt text in event data', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('user-prompt', basePayload({ prompt: 'fix the CSS' }));

      const events = sessionRepo.getSessionEvents('test-session');
      const promptEvent = events.find(e => e.event_type === 'user-prompt');
      expect(JSON.parse(promptEvent!.data!).prompt).toBe('fix the CSS');
    });

    it('handles user-prompt without prompt text', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('user-prompt', basePayload());

      const events = sessionRepo.getSessionEvents('test-session');
      const promptEvent = events.find(e => e.event_type === 'user-prompt');
      expect(promptEvent!.data).toBeNull();
    });
  });

  describe('tool-use events', () => {
    it('sets state to active and records tool info', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('tool-use', basePayload({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
      }));

      const session = sessionRepo.getSession('test-session');
      expect(session!.state).toBe('active');
      expect(session!.last_tool).toBe('Bash');
      expect(session!.last_tool_detail).toBe('npm test');
    });

    it('records tool-use event with tool data', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('tool-use', basePayload({
        tool_name: 'Read',
        tool_input: { file_path: '/src/app.ts' },
      }));

      const events = sessionRepo.getSessionEvents('test-session');
      const toolEvent = events.find(e => e.event_type === 'tool-use');
      const data = JSON.parse(toolEvent!.data!);
      expect(data.tool_name).toBe('Read');
      expect(data.tool_detail).toBe('app.ts');
    });

    it('handles missing tool_name gracefully', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('tool-use', basePayload());

      const session = sessionRepo.getSession('test-session');
      expect(session!.last_tool).toBe('unknown');
    });

    it('ignores tool-use for unknown session_id', () => {
      recording.recordEvent('tool-use', basePayload({
        session_id: 'ghost',
        tool_name: 'Bash',
      }));
      expect(sessionRepo.getSession('ghost')).toBeNull();
    });
  });

  describe('events after session-end', () => {
    it('ignores events after session-end', () => {
      recording.recordEvent('session-start', basePayload({ source: 'startup' }));
      recording.recordEvent('session-end', basePayload({ reason: 'done' }));

      // These should all be silently ignored
      recording.recordEvent('tool-use', basePayload({ tool_name: 'Read' }));
      recording.recordEvent('turn-complete', basePayload());
      recording.recordEvent('user-prompt', basePayload({ prompt: 'hello' }));

      const session = sessionRepo.getSession('test-session');
      expect(session!.state).toBe('stopped');

      const events = sessionRepo.getSessionEvents('test-session');
      expect(events).toHaveLength(2); // only start + end
    });
  });

  describe('parsePayload', () => {
    it('parses valid JSON with required fields', () => {
      const payload = parsePayload(JSON.stringify({
        session_id: 'test', cwd: '/tmp',
      }));
      expect(payload.session_id).toBe('test');
      expect(payload.cwd).toBe('/tmp');
    });

    it('extracts optional fields', () => {
      const payload = parsePayload(JSON.stringify({
        session_id: 'test', cwd: '/tmp',
        tool_name: 'Read', tool_input: { file_path: '/a.ts' },
        source: 'startup', reason: 'done',
        prompt: 'hello', model: 'claude-sonnet-4-5-20250929',
      }));
      expect(payload.tool_name).toBe('Read');
      expect(payload.source).toBe('startup');
      expect(payload.reason).toBe('done');
      expect(payload.prompt).toBe('hello');
    });

    it('throws on invalid JSON', () => {
      expect(() => parsePayload('not json')).toThrow('Invalid JSON');
    });

    it('throws on missing session_id', () => {
      expect(() => parsePayload(JSON.stringify({ cwd: '/tmp' }))).toThrow('session_id');
    });

    it('throws on missing cwd', () => {
      expect(() => parsePayload(JSON.stringify({ session_id: 'test' }))).toThrow('cwd');
    });
  });
});
