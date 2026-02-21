import { describe, it, expect, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { openDb } from '../src/core/storage.ts';
import { parsePayload, extractToolDetail, parseTranscriptLine, groupIntoTurns } from '../src/index.ts';
import { SessionRepositorySqlite } from '../src/features/sessions/sqlite/session.repository.sqlite.ts';
import { IngestionRepositorySqlite } from '../src/features/ingestion/sqlite/ingestion.repository.sqlite.ts';
import { IngestionService } from '../src/features/ingestion/ingestion.service.ts';
import { RecordingRepositorySqlite } from '../src/features/recording/sqlite/recording.repository.sqlite.ts';
import { RecordingService } from '../src/features/recording/recording.service.ts';
import { WorkspaceRepositorySqlite } from '../src/features/workspace/sqlite/workspace.repository.sqlite.ts';
import { WorkspaceService } from '../src/features/workspace/workspace.service.ts';
import { parseDuration } from '../src/core/utils.ts';

const TRANSCRIPT_PATH = `/tmp/sap-lib-data-transcript-${process.pid}.jsonl`;
const TRANSCRIPT_PATH_2 = `/tmp/sap-lib-data-transcript-${process.pid}-2.jsonl`;

function cleanup() {
  for (const f of [TRANSCRIPT_PATH, TRANSCRIPT_PATH_2]) {
    try { unlinkSync(f); } catch {}
  }
}

function makeTranscript(sessionId: string): string {
  return [
    { type: 'user', sessionId, timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Fix the bug' } },
    { type: 'assistant', sessionId, timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/app.ts' } }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 } } },
    { type: 'user', sessionId, timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false }] } },
  ].map(l => JSON.stringify(l)).join('\n');
}

function makeServices(db: ReturnType<typeof openDb>) {
  const sessionRepo = new SessionRepositorySqlite(db);
  const ingestionRepo = new IngestionRepositorySqlite(db);
  const workspaceRepo = new WorkspaceRepositorySqlite(db);
  const workspaceService = new WorkspaceService(workspaceRepo);
  const recordingRepo = new RecordingRepositorySqlite(db);
  const recording = new RecordingService(recordingRepo, workspaceService);
  const ingestion = new IngestionService(ingestionRepo);
  return { sessionRepo, ingestionRepo, recording, ingestion, workspaceRepo };
}

describe('library data access', () => {
  afterEach(cleanup);

  describe('turns + tool calls via ingestion', () => {
    it('retrieves turns and tool calls after ingesting a transcript', () => {
      const db = openDb(':memory:');
      writeFileSync(TRANSCRIPT_PATH, makeTranscript('test-turns'));
      const { sessionRepo, ingestionRepo, ingestion } = makeServices(db);

      sessionRepo.insertSession({ session_id: 'test-turns', workspace: 'test:main', cwd: '/test', transcript_path: TRANSCRIPT_PATH, started_at: Date.now() });
      ingestion.ingestSession('test-turns');

      const turns = ingestionRepo.getSessionTurns('test-turns');
      expect(turns).toHaveLength(1);
      expect(turns[0].turn_number).toBe(1);
      expect(turns[0].prompt_text).toBe('Fix the bug');
      expect(turns[0].input_tokens).toBe(1000);
      expect(turns[0].output_tokens).toBe(500);
      expect(turns[0].cache_read_tokens).toBe(200);
      expect(turns[0].cache_write_tokens).toBe(100);
      expect(turns[0].model).toBe('claude-sonnet-4-5-20250929');
      expect(turns[0].tool_call_count).toBe(1);

      const toolCalls = ingestionRepo.getTurnToolCalls(turns[0].id);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].tool_name).toBe('Read');
      expect(toolCalls[0].tool_use_id).toBe('tu1');
      expect(toolCalls[0].tool_input_summary).toBe('app.ts');
      expect(toolCalls[0].success).toBe(1);
      expect(toolCalls[0].error_message).toBeNull();

      db.close();
    });
  });

  describe('events via recording', () => {
    it('retrieves events after recording via recordEvent', () => {
      const db = openDb(':memory:');
      const { sessionRepo, recording } = makeServices(db);

      recording.recordEvent('session-start', {
        session_id: 'test-events', cwd: '/tmp/repo', transcript_path: '',
        permission_mode: 'default', hook_event_name: 'session-start', source: 'startup' as const,
      });
      recording.recordEvent('tool-use', {
        session_id: 'test-events', cwd: '/tmp/repo', transcript_path: '',
        permission_mode: 'default', hook_event_name: 'tool-use', tool_name: 'Bash', tool_input: { command: 'npm test' },
      });

      const events = sessionRepo.getSessionEvents('test-events');
      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe('session-start');
      expect(events[1].event_type).toBe('tool-use');

      const toolData = JSON.parse(events[1].data!);
      expect(toolData.tool_name).toBe('Bash');
      expect(toolData.tool_detail).toBe('npm test');

      db.close();
    });
  });

  describe('active sessions', () => {
    it('returns only non-stopped sessions', () => {
      const db = openDb(':memory:');
      const { sessionRepo } = makeServices(db);

      sessionRepo.insertSession({ session_id: 'active-1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: Date.now() });
      sessionRepo.insertSession({ session_id: 'active-2', workspace: 'ws-b', cwd: '/b', transcript_path: null, started_at: Date.now() });
      sessionRepo.insertSession({ session_id: 'stopped-1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: Date.now() });
      sessionRepo.updateSessionState('stopped-1', 'stopped', Date.now());

      const active = sessionRepo.getActiveSessions();
      expect(active).toHaveLength(2);
      expect(active.map(s => s.session_id).sort()).toEqual(['active-1', 'active-2']);

      db.close();
    });

    it('filters by workspace', () => {
      const db = openDb(':memory:');
      const { sessionRepo } = makeServices(db);

      sessionRepo.insertSession({ session_id: 'a1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: Date.now() });
      sessionRepo.insertSession({ session_id: 'b1', workspace: 'ws-b', cwd: '/b', transcript_path: null, started_at: Date.now() });

      const wsA = sessionRepo.getActiveSessions('ws-a');
      expect(wsA).toHaveLength(1);
      expect(wsA[0].session_id).toBe('a1');

      db.close();
    });
  });

  describe('session history', () => {
    it('retrieves history with limit', () => {
      const db = openDb(':memory:');
      const { sessionRepo } = makeServices(db);
      const now = Date.now();

      sessionRepo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/t', transcript_path: null, started_at: now - 3000 });
      sessionRepo.insertSession({ session_id: 's2', workspace: 'ws', cwd: '/t', transcript_path: null, started_at: now - 2000 });
      sessionRepo.insertSession({ session_id: 's3', workspace: 'ws', cwd: '/t', transcript_path: null, started_at: now - 1000 });

      const history = sessionRepo.getSessionHistory({ limit: 2 });
      expect(history).toHaveLength(2);
      expect(history[0].session_id).toBe('s3');
      expect(history[1].session_id).toBe('s2');

      db.close();
    });

    it('filters by workspace', () => {
      const db = openDb(':memory:');
      const { sessionRepo } = makeServices(db);
      const now = Date.now();

      sessionRepo.insertSession({ session_id: 'a1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: now - 2000 });
      sessionRepo.insertSession({ session_id: 'b1', workspace: 'ws-b', cwd: '/b', transcript_path: null, started_at: now - 1000 });
      sessionRepo.insertSession({ session_id: 'a2', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: now });

      const historyA = sessionRepo.getSessionHistory({ workspace: 'ws-a', limit: 100 });
      expect(historyA).toHaveLength(2);
      expect(historyA[0].session_id).toBe('a2');
      expect(historyA[1].session_id).toBe('a1');

      db.close();
    });
  });

  describe('batch ingestion', () => {
    it('batch ingests multiple sessions', () => {
      const db = openDb(':memory:');
      writeFileSync(TRANSCRIPT_PATH, makeTranscript('batch-1'));
      writeFileSync(TRANSCRIPT_PATH_2, makeTranscript('batch-2'));
      const { sessionRepo, ingestion } = makeServices(db);

      sessionRepo.insertSession({ session_id: 'batch-1', workspace: 'ws', cwd: '/t', transcript_path: TRANSCRIPT_PATH, started_at: Date.now() });
      sessionRepo.insertSession({ session_id: 'batch-2', workspace: 'ws', cwd: '/t', transcript_path: TRANSCRIPT_PATH_2, started_at: Date.now() });

      const result = ingestion.ingestBatch({});
      expect(result.ingested).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      db.close();
    });

    it('skips already ingested sessions', () => {
      const db = openDb(':memory:');
      writeFileSync(TRANSCRIPT_PATH, makeTranscript('skip-test'));
      const { sessionRepo, ingestion } = makeServices(db);

      sessionRepo.insertSession({ session_id: 'skip-test', workspace: 'ws', cwd: '/t', transcript_path: TRANSCRIPT_PATH, started_at: Date.now() });
      ingestion.ingestSession('skip-test');

      const result = ingestion.ingestBatch({});
      expect(result.ingested).toBe(0);
      expect(result.skipped).toBe(1);

      db.close();
    });

    it('reingests with force flag', () => {
      const db = openDb(':memory:');
      writeFileSync(TRANSCRIPT_PATH, makeTranscript('force-test'));
      const { sessionRepo, ingestion } = makeServices(db);

      sessionRepo.insertSession({ session_id: 'force-test', workspace: 'ws', cwd: '/t', transcript_path: TRANSCRIPT_PATH, started_at: Date.now() });
      ingestion.ingestSession('force-test');

      const result = ingestion.ingestBatch({ force: true });
      expect(result.ingested).toBe(1);
      expect(result.skipped).toBe(0);

      db.close();
    });
  });

  describe('upsertSession', () => {
    it('inserts a new session', () => {
      const db = openDb(':memory:');
      const { sessionRepo } = makeServices(db);
      sessionRepo.upsertSession({ session_id: 'upsert-new', workspace: 'ws', cwd: '/t', transcript_path: null, started_at: Date.now() });
      const session = sessionRepo.getSession('upsert-new');
      expect(session).not.toBeNull();
      expect(session!.workspace).toBe('ws');
      expect(session!.state).toBe('active');
      db.close();
    });

    it('updates an existing session', () => {
      const db = openDb(':memory:');
      const { sessionRepo } = makeServices(db);
      sessionRepo.insertSession({ session_id: 'upsert-exist', workspace: 'old-ws', cwd: '/old', transcript_path: null, started_at: Date.now() });
      sessionRepo.upsertSession({ session_id: 'upsert-exist', workspace: 'new-ws', cwd: '/new', transcript_path: null, started_at: Date.now() });
      const session = sessionRepo.getSession('upsert-exist');
      expect(session!.workspace).toBe('new-ws');
      expect(session!.cwd).toBe('/new');
      expect(session!.state).toBe('active');
      db.close();
    });
  });

  describe('workspace cache', () => {
    it('inserts and retrieves workspace cache', () => {
      const db = openDb(':memory:');
      const { workspaceRepo } = makeServices(db);
      workspaceRepo.upsertWorkspace({ cwd: '/project', repo_name: 'test-repo', branch: 'main', workspace: 'test-repo:main', resolved_at: Date.now() });
      const cached = workspaceRepo.getCachedWorkspace('/project');
      expect(cached).not.toBeNull();
      expect(cached!.repo_name).toBe('test-repo');
      expect(cached!.workspace).toBe('test-repo:main');
      db.close();
    });

    it('updates existing workspace cache', () => {
      const db = openDb(':memory:');
      const { workspaceRepo } = makeServices(db);
      workspaceRepo.upsertWorkspace({ cwd: '/project', repo_name: 'old', branch: 'old', workspace: 'old:old', resolved_at: Date.now() });
      workspaceRepo.upsertWorkspace({ cwd: '/project', repo_name: 'new', branch: 'feat', workspace: 'new:feat', resolved_at: Date.now() });
      const cached = workspaceRepo.getCachedWorkspace('/project');
      expect(cached!.repo_name).toBe('new');
      expect(cached!.workspace).toBe('new:feat');
      db.close();
    });

    it('returns null for non-existent workspace', () => {
      const db = openDb(':memory:');
      const { workspaceRepo } = makeServices(db);
      expect(workspaceRepo.getCachedWorkspace('/nonexistent')).toBeNull();
      db.close();
    });
  });

  describe('parsePayload', () => {
    it('parses valid JSON with required fields', () => {
      const payload = parsePayload(JSON.stringify({ session_id: 'test', cwd: '/tmp', permission_mode: 'default' }));
      expect(payload.session_id).toBe('test');
      expect(payload.cwd).toBe('/tmp');
    });

    it('extracts optional fields', () => {
      const payload = parsePayload(JSON.stringify({
        session_id: 'test', cwd: '/tmp',
        tool_name: 'Read', tool_input: { file_path: '/a.ts' },
        source: 'startup', reason: 'done',
      }));
      expect(payload.tool_name).toBe('Read');
      expect(payload.source).toBe('startup');
    });

    it('throws on invalid JSON', () => {
      expect(() => parsePayload('not json')).toThrow('Invalid JSON');
    });

    it('throws on missing required fields', () => {
      expect(() => parsePayload(JSON.stringify({ cwd: '/tmp' }))).toThrow('session_id');
      expect(() => parsePayload(JSON.stringify({ session_id: 'test' }))).toThrow('cwd');
    });
  });

  describe('parseDuration', () => {
    it('parses minutes', () => {
      expect(parseDuration('10m')).toBe(10 * 60 * 1000);
      expect(parseDuration('5m')).toBe(5 * 60 * 1000);
    });

    it('parses hours', () => {
      expect(parseDuration('1h')).toBe(3600 * 1000);
    });

    it('parses days', () => {
      expect(parseDuration('7d')).toBe(7 * 86400 * 1000);
    });

    it('throws on invalid formats', () => {
      expect(() => parseDuration('invalid')).toThrow();
    });
  });

  describe('extractToolDetail', () => {
    it('extracts basename for Read/Write/Edit', () => {
      expect(extractToolDetail('Read', { file_path: '/src/app.ts' })).toBe('app.ts');
      expect(extractToolDetail('Write', { file_path: '/src/utils/helper.ts' })).toBe('helper.ts');
      expect(extractToolDetail('Edit', { file_path: '/config/settings.json' })).toBe('settings.json');
    });

    it('extracts command for Bash', () => {
      expect(extractToolDetail('Bash', { command: 'npm test' })).toBe('npm test');
    });

    it('extracts pattern for Glob/Grep', () => {
      expect(extractToolDetail('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
      expect(extractToolDetail('Grep', { pattern: 'TODO' })).toBe('TODO');
    });

    it('extracts description for Task', () => {
      expect(extractToolDetail('Task', { description: 'explore codebase' })).toBe('explore codebase');
    });

    it('extracts hostname for WebFetch', () => {
      expect(extractToolDetail('WebFetch', { url: 'https://example.com/path' })).toBe('example.com');
    });

    it('extracts query for WebSearch', () => {
      expect(extractToolDetail('WebSearch', { query: 'vitest config' })).toBe('vitest config');
    });

    it('returns null for unknown tool', () => {
      expect(extractToolDetail('UnknownTool', { foo: 'bar' })).toBeNull();
    });

    it('returns null for null input', () => {
      expect(extractToolDetail('Read', null)).toBeNull();
    });
  });

  describe('parseTranscriptLine', () => {
    it('parses user message', () => {
      const line = parseTranscriptLine(JSON.stringify({
        type: 'user', sessionId: 'test', timestamp: new Date(1000).toISOString(), uuid: 'u1',
        message: { content: 'Hello' },
      }));
      expect(line).not.toBeNull();
      expect(line!.type).toBe('user');
      expect(line!.promptText).toBe('Hello');
    });

    it('parses assistant message with tool use', () => {
      const line = parseTranscriptLine(JSON.stringify({
        type: 'assistant', sessionId: 'test', timestamp: new Date(2000).toISOString(), uuid: 'a1',
        message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.ts' } }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 } },
      }));
      expect(line!.model).toBe('claude-sonnet-4-5-20250929');
      expect(line!.toolUses).toHaveLength(1);
      expect(line!.usage!.input_tokens).toBe(1000);
    });

    it('returns null for invalid JSON', () => {
      expect(parseTranscriptLine('not json')).toBeNull();
    });
  });

  describe('groupIntoTurns', () => {
    it('groups a conversation into turns', () => {
      const lines = [
        parseTranscriptLine(JSON.stringify({ type: 'user', sessionId: 'test', timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Fix the bug' } })),
        parseTranscriptLine(JSON.stringify({ type: 'assistant', sessionId: 'test', timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.ts' } }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })),
        parseTranscriptLine(JSON.stringify({ type: 'user', sessionId: 'test', timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }] } })),
      ].filter((l): l is NonNullable<typeof l> => l !== null);

      const turns = groupIntoTurns(lines);
      expect(turns).toHaveLength(1);
      expect(turns[0].promptText).toBe('Fix the bug');
      expect(turns[0].toolUses).toHaveLength(1);
      expect(turns[0].durationMs).toBe(1000);
    });

    it('handles empty input', () => {
      expect(groupIntoTurns([])).toHaveLength(0);
    });
  });
});
