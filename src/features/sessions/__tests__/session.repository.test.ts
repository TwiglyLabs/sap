import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../../../core/storage.ts';
import { SessionRepositorySqlite } from '../sqlite/session.repository.sqlite.ts';
import { SessionService } from '../session.service.ts';
import type Database from 'better-sqlite3';

describe('SessionRepositorySqlite', () => {
  let db: Database.Database;
  let repo: SessionRepositorySqlite;

  beforeEach(() => {
    db = openDb(':memory:');
    repo = new SessionRepositorySqlite(db);
  });

  describe('session CRUD', () => {
    it('inserts and retrieves a session', () => {
      repo.insertSession({
        session_id: 's1', workspace: 'repo:main', cwd: '/project',
        transcript_path: '/tmp/t.jsonl', started_at: 1000,
      });
      const session = repo.getSession('s1');
      expect(session).not.toBeNull();
      expect(session!.session_id).toBe('s1');
      expect(session!.workspace).toBe('repo:main');
      expect(session!.state).toBe('active');
      expect(session!.transcript_path).toBe('/tmp/t.jsonl');
    });

    it('returns null for nonexistent session', () => {
      expect(repo.getSession('nonexistent')).toBeNull();
    });

    it('upserts session on duplicate session_id', () => {
      repo.insertSession({ session_id: 's1', workspace: 'old:ws', cwd: '/old', transcript_path: null, started_at: 1000 });
      repo.updateSessionState('s1', 'idle', 2000);

      repo.upsertSession({ session_id: 's1', workspace: 'new:ws', cwd: '/new', transcript_path: '/new/t.jsonl', started_at: 3000 });

      const session = repo.getSession('s1');
      expect(session!.workspace).toBe('new:ws');
      expect(session!.cwd).toBe('/new');
      expect(session!.state).toBe('active');
      expect(session!.last_tool).toBeNull();
      expect(session!.last_tool_detail).toBeNull();
      expect(session!.ended_at).toBeNull();
    });
  });

  describe('updateSessionState', () => {
    it('updates state', () => {
      repo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });
      repo.updateSessionState('s1', 'idle', 2000);
      expect(repo.getSession('s1')!.state).toBe('idle');
    });

    it('updates state with tool info', () => {
      repo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });
      repo.updateSessionState('s1', 'active', 2000, { tool: 'Bash', detail: 'npm test' });

      const session = repo.getSession('s1');
      expect(session!.last_tool).toBe('Bash');
      expect(session!.last_tool_detail).toBe('npm test');
    });

    it('sets ended_at when state is stopped', () => {
      repo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });
      repo.updateSessionState('s1', 'stopped', 5000);

      const session = repo.getSession('s1');
      expect(session!.state).toBe('stopped');
      expect(session!.ended_at).toBe(5000);
    });
  });

  describe('getActiveSessions', () => {
    it('returns active and non-stopped sessions', () => {
      repo.insertSession({ session_id: 'active', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });
      repo.insertSession({ session_id: 'idle', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 2000 });
      repo.updateSessionState('idle', 'idle', 3000);
      repo.insertSession({ session_id: 'attention', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 3000 });
      repo.updateSessionState('attention', 'attention', 4000);
      repo.insertSession({ session_id: 'stopped', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 4000 });
      repo.updateSessionState('stopped', 'stopped', 5000);

      const active = repo.getActiveSessions();
      expect(active).toHaveLength(3);
      expect(active.map(s => s.session_id).sort()).toEqual(['active', 'attention', 'idle']);
    });

    it('filters by workspace', () => {
      repo.insertSession({ session_id: 'a', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: 1000 });
      repo.insertSession({ session_id: 'b', workspace: 'ws-b', cwd: '/b', transcript_path: null, started_at: 2000 });

      const wsA = repo.getActiveSessions('ws-a');
      expect(wsA).toHaveLength(1);
      expect(wsA[0].session_id).toBe('a');
    });
  });

  describe('getLatestSession', () => {
    it('returns the most recent session for a workspace', () => {
      repo.insertSession({ session_id: 'older', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });
      repo.insertSession({ session_id: 'newer', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 2000 });

      expect(repo.getLatestSession('ws')!.session_id).toBe('newer');
    });

    it('returns stopped session if it is the most recent', () => {
      repo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });
      repo.updateSessionState('s1', 'stopped', 2000);

      expect(repo.getLatestSession('ws')!.state).toBe('stopped');
    });

    it('returns null for unknown workspace', () => {
      expect(repo.getLatestSession('nonexistent')).toBeNull();
    });
  });

  describe('getSessionHistory', () => {
    it('returns sessions in reverse chronological order', () => {
      repo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });
      repo.insertSession({ session_id: 's2', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 2000 });
      repo.insertSession({ session_id: 's3', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 3000 });

      const history = repo.getSessionHistory({ limit: 10 });
      expect(history.map(s => s.session_id)).toEqual(['s3', 's2', 's1']);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        repo.insertSession({ session_id: `s${i}`, workspace: 'ws', cwd: '/', transcript_path: null, started_at: i * 1000 });
      }
      expect(repo.getSessionHistory({ limit: 2 })).toHaveLength(2);
    });

    it('filters by workspace', () => {
      repo.insertSession({ session_id: 'a1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: 1000 });
      repo.insertSession({ session_id: 'b1', workspace: 'ws-b', cwd: '/b', transcript_path: null, started_at: 2000 });
      repo.insertSession({ session_id: 'a2', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: 3000 });

      const history = repo.getSessionHistory({ workspace: 'ws-a', limit: 10 });
      expect(history).toHaveLength(2);
      expect(history[0].session_id).toBe('a2');
    });
  });

  describe('events', () => {
    it('inserts and retrieves events', () => {
      repo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });
      repo.insertEvent({ session_id: 's1', event_type: 'session-start', data: '{"source":"startup"}', created_at: 1000 });

      const events = repo.getSessionEvents('s1');
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('session-start');
      expect(JSON.parse(events[0].data!).source).toBe('startup');
    });

    it('returns events in chronological order', () => {
      repo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });
      repo.insertEvent({ session_id: 's1', event_type: 'session-start', data: null, created_at: 1000 });
      repo.insertEvent({ session_id: 's1', event_type: 'tool-use', data: null, created_at: 2000 });
      repo.insertEvent({ session_id: 's1', event_type: 'turn-complete', data: null, created_at: 3000 });

      const events = repo.getSessionEvents('s1');
      expect(events.map(e => e.event_type)).toEqual(['session-start', 'tool-use', 'turn-complete']);
    });
  });

  describe('markStaleSessions', () => {
    it('sweeps stale active sessions to stopped', () => {
      const old = Date.now() - 20 * 60 * 1000;
      repo.insertSession({ session_id: 'stale', workspace: 'ws', cwd: '/', transcript_path: null, started_at: old });
      repo.updateSessionState('stale', 'active', old);

      const swept = repo.markStaleSessions(10 * 60 * 1000);
      expect(swept).toBe(1);
      expect(repo.getSession('stale')!.state).toBe('stopped');
    });

    it('sweeps stale idle sessions', () => {
      const old = Date.now() - 20 * 60 * 1000;
      repo.insertSession({ session_id: 'idle', workspace: 'ws', cwd: '/', transcript_path: null, started_at: old });
      repo.updateSessionState('idle', 'idle', old);

      expect(repo.markStaleSessions(10 * 60 * 1000)).toBe(1);
      expect(repo.getSession('idle')!.state).toBe('stopped');
    });

    it('sweeps stale attention sessions', () => {
      const old = Date.now() - 20 * 60 * 1000;
      repo.insertSession({ session_id: 'attn', workspace: 'ws', cwd: '/', transcript_path: null, started_at: old });
      repo.updateSessionState('attn', 'attention', old);

      expect(repo.markStaleSessions(10 * 60 * 1000)).toBe(1);
      expect(repo.getSession('attn')!.state).toBe('stopped');
    });

    it('does not sweep fresh sessions', () => {
      repo.insertSession({ session_id: 'fresh', workspace: 'ws', cwd: '/', transcript_path: null, started_at: Date.now() });

      expect(repo.markStaleSessions(10 * 60 * 1000)).toBe(0);
      expect(repo.getSession('fresh')!.state).toBe('active');
    });

    it('does not sweep already stopped sessions', () => {
      const old = Date.now() - 20 * 60 * 1000;
      repo.insertSession({ session_id: 'stopped', workspace: 'ws', cwd: '/', transcript_path: null, started_at: old });
      repo.updateSessionState('stopped', 'stopped', old);

      expect(repo.markStaleSessions(10 * 60 * 1000)).toBe(0);
    });

    it('sets ended_at to last_event_at when sweeping', () => {
      const eventTime = Date.now() - 20 * 60 * 1000;
      repo.insertSession({ session_id: 'stale', workspace: 'ws', cwd: '/', transcript_path: null, started_at: eventTime });
      repo.updateSessionState('stale', 'active', eventTime);

      repo.markStaleSessions(10 * 60 * 1000);
      const session = repo.getSession('stale');
      expect(session!.ended_at).toBe(session!.last_event_at);
    });
  });

  describe('deleteStaleSessions', () => {
    it('deletes stopped sessions older than threshold', () => {
      const old = Date.now() - 40 * 86400 * 1000;
      repo.insertSession({ session_id: 'old', workspace: 'ws', cwd: '/', transcript_path: null, started_at: old });
      repo.updateSessionState('old', 'stopped', old);

      expect(repo.deleteStaleSessions(30 * 86400 * 1000)).toBe(1);
      expect(repo.getSession('old')).toBeNull();
    });

    it('deletes orphaned active sessions older than threshold', () => {
      const old = Date.now() - 40 * 86400 * 1000;
      repo.insertSession({ session_id: 'orphan', workspace: 'ws', cwd: '/', transcript_path: null, started_at: old });
      // Still "active" but last_event_at is very old

      expect(repo.deleteStaleSessions(30 * 86400 * 1000)).toBe(1);
      expect(repo.getSession('orphan')).toBeNull();
    });

    it('keeps recent sessions', () => {
      repo.insertSession({ session_id: 'recent', workspace: 'ws', cwd: '/', transcript_path: null, started_at: Date.now() });

      expect(repo.deleteStaleSessions(30 * 86400 * 1000)).toBe(0);
      expect(repo.getSession('recent')).not.toBeNull();
    });

    it('cascades deletion to events', () => {
      const old = Date.now() - 40 * 86400 * 1000;
      repo.insertSession({ session_id: 'cascade', workspace: 'ws', cwd: '/', transcript_path: null, started_at: old });
      repo.insertEvent({ session_id: 'cascade', event_type: 'session-start', data: null, created_at: old });
      repo.updateSessionState('cascade', 'stopped', old);

      repo.deleteStaleSessions(30 * 86400 * 1000);
      expect(repo.getSessionEvents('cascade')).toHaveLength(0);
    });
  });
});

describe('SessionService', () => {
  let db: Database.Database;
  let repo: SessionRepositorySqlite;
  let service: SessionService;

  beforeEach(() => {
    db = openDb(':memory:');
    repo = new SessionRepositorySqlite(db);
    service = new SessionService(repo);
  });

  describe('status', () => {
    it('returns active sessions with stale=false', () => {
      repo.insertSession({ session_id: 'fresh', workspace: 'ws', cwd: '/', transcript_path: null, started_at: Date.now() });

      const result = service.status();
      expect(result.sessions).toHaveLength(1);
      expect(result.sessions[0].stale).toBe(false);
    });

    it('marks sessions older than STALE_THRESHOLD_MS as stale', () => {
      const old = Date.now() - 15 * 60 * 1000;
      repo.insertSession({ session_id: 'stale', workspace: 'ws', cwd: '/', transcript_path: null, started_at: old });

      const result = service.status();
      expect(result.sessions[0].stale).toBe(true);
    });

    it('excludes stopped sessions', () => {
      repo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: null, started_at: Date.now() });
      repo.insertSession({ session_id: 's2', workspace: 'ws', cwd: '/', transcript_path: null, started_at: Date.now() });
      repo.updateSessionState('s2', 'stopped', Date.now());

      expect(service.status().sessions).toHaveLength(1);
    });

    it('includes idle and attention sessions', () => {
      repo.insertSession({ session_id: 'idle', workspace: 'ws', cwd: '/', transcript_path: null, started_at: Date.now() });
      repo.updateSessionState('idle', 'idle', Date.now());
      repo.insertSession({ session_id: 'attn', workspace: 'ws', cwd: '/', transcript_path: null, started_at: Date.now() });
      repo.updateSessionState('attn', 'attention', Date.now());

      const states = service.status().sessions.map(s => s.state);
      expect(states.sort()).toEqual(['attention', 'idle']);
    });
  });

  describe('statusGrouped', () => {
    it('groups sessions by workspace', () => {
      repo.insertSession({ session_id: 'a1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: Date.now() });
      repo.insertSession({ session_id: 'a2', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: Date.now() });
      repo.insertSession({ session_id: 'b1', workspace: 'ws-b', cwd: '/b', transcript_path: null, started_at: Date.now() });

      const grouped = service.statusGrouped();
      expect(Object.keys(grouped.workspaces).sort()).toEqual(['ws-a', 'ws-b']);
      expect(grouped.workspaces['ws-a']).toHaveLength(2);
      expect(grouped.workspaces['ws-b']).toHaveLength(1);
    });

    it('returns empty workspaces when no sessions', () => {
      expect(service.statusGrouped().workspaces).toEqual({});
    });
  });
});
