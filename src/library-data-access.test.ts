import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, writeFileSync } from 'fs';
import {
  openDb,
  recordEvent,
  insertSession,
  getSession,
  updateSessionState,
  getSessionTurns,
  getTurnToolCalls,
  getSessionEvents,
  getActiveSessions,
  getSessionHistory,
  ingestSession,
  ingestBatch,
  upsertSession,
  upsertWorkspace,
  getCachedWorkspace,
  parsePayload,
  parseSweepThreshold,
  extractToolDetail,
  parseTranscriptLine,
  groupIntoTurns,
} from './index.ts';

const DB_PATH = `/tmp/sap-lib-data-${process.pid}.db`;
const TRANSCRIPT_PATH = `/tmp/sap-lib-data-transcript-${process.pid}.jsonl`;
const TRANSCRIPT_PATH_2 = `/tmp/sap-lib-data-transcript-${process.pid}-2.jsonl`;

function cleanup() {
  for (const f of [DB_PATH, DB_PATH + '-wal', DB_PATH + '-shm', TRANSCRIPT_PATH, TRANSCRIPT_PATH_2]) {
    try { unlinkSync(f); } catch {}
  }
}

/** Standard transcript with 1 turn, 1 Read tool call */
function makeTranscript(sessionId: string): string {
  return [
    { type: 'user', sessionId, timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Fix the bug' } },
    { type: 'assistant', sessionId, timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/app.ts' } }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 } } },
    { type: 'user', sessionId, timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false }] } },
  ].map(l => JSON.stringify(l)).join('\n');
}

describe('library data access', () => {
  afterEach(cleanup);

  describe('getSessionTurns + getTurnToolCalls', () => {
    it('retrieves turns and tool calls after ingesting a transcript', () => {
      const db = openDb(DB_PATH);
      writeFileSync(TRANSCRIPT_PATH, makeTranscript('test-turns'));

      insertSession(db, { session_id: 'test-turns', workspace: 'test:main', cwd: '/test', transcript_path: TRANSCRIPT_PATH, started_at: Date.now() });
      ingestSession(db, 'test-turns');

      const turns = getSessionTurns(db, 'test-turns');
      expect(turns).toHaveLength(1);
      expect(turns[0].turn_number).toBe(1);
      expect(turns[0].prompt_text).toBe('Fix the bug');
      expect(turns[0].input_tokens).toBe(1000);
      expect(turns[0].output_tokens).toBe(500);
      expect(turns[0].cache_read_tokens).toBe(200);
      expect(turns[0].cache_write_tokens).toBe(100);
      expect(turns[0].model).toBe('claude-sonnet-4-5-20250929');
      expect(turns[0].tool_call_count).toBe(1);

      const toolCalls = getTurnToolCalls(db, turns[0].id);
      expect(toolCalls).toHaveLength(1);
      expect(toolCalls[0].tool_name).toBe('Read');
      expect(toolCalls[0].tool_use_id).toBe('tu1');
      expect(toolCalls[0].tool_input_summary).toBe('app.ts');
      expect(toolCalls[0].success).toBe(1);
      expect(toolCalls[0].error_message).toBeNull();

      db.close();
    });
  });

  describe('getSessionEvents', () => {
    it('retrieves events after recording via recordEvent', () => {
      const db = openDb(DB_PATH);

      recordEvent(db, 'session-start', {
        session_id: 'test-events',
        cwd: '/tmp/repo',
        transcript_path: '',
        permission_mode: 'default',
        hook_event_name: 'session-start',
        source: 'startup' as const,
      });

      recordEvent(db, 'tool-use', {
        session_id: 'test-events',
        cwd: '/tmp/repo',
        transcript_path: '',
        permission_mode: 'default',
        hook_event_name: 'tool-use',
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
      });

      const events = getSessionEvents(db, 'test-events');
      expect(events).toHaveLength(2);
      expect(events[0].event_type).toBe('session-start');
      expect(events[1].event_type).toBe('tool-use');

      // Tool info is in the data JSON string
      const toolData = JSON.parse(events[1].data!);
      expect(toolData.tool_name).toBe('Bash');
      expect(toolData.tool_detail).toBe('npm test');

      db.close();
    });
  });

  describe('getActiveSessions', () => {
    it('returns only non-stopped sessions', () => {
      const db = openDb(DB_PATH);

      insertSession(db, { session_id: 'active-1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: Date.now() });
      insertSession(db, { session_id: 'active-2', workspace: 'ws-b', cwd: '/b', transcript_path: null, started_at: Date.now() });
      insertSession(db, { session_id: 'stopped-1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: Date.now() });
      updateSessionState(db, 'stopped-1', 'stopped', Date.now());

      const active = getActiveSessions(db);
      expect(active).toHaveLength(2);
      expect(active.map((s: any) => s.session_id).sort()).toEqual(['active-1', 'active-2']);

      db.close();
    });

    it('filters by workspace', () => {
      const db = openDb(DB_PATH);

      insertSession(db, { session_id: 'a1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: Date.now() });
      insertSession(db, { session_id: 'b1', workspace: 'ws-b', cwd: '/b', transcript_path: null, started_at: Date.now() });

      const wsA = getActiveSessions(db, 'ws-a');
      expect(wsA).toHaveLength(1);
      expect(wsA[0].session_id).toBe('a1');

      db.close();
    });
  });

  describe('getSessionHistory', () => {
    it('retrieves history with limit', () => {
      const db = openDb(DB_PATH);
      const now = Date.now();

      insertSession(db, { session_id: 's1', workspace: 'ws', cwd: '/t', transcript_path: null, started_at: now - 3000 });
      insertSession(db, { session_id: 's2', workspace: 'ws', cwd: '/t', transcript_path: null, started_at: now - 2000 });
      insertSession(db, { session_id: 's3', workspace: 'ws', cwd: '/t', transcript_path: null, started_at: now - 1000 });

      const history = getSessionHistory(db, { limit: 2 });
      expect(history).toHaveLength(2);
      // Ordered by started_at DESC
      expect(history[0].session_id).toBe('s3');
      expect(history[1].session_id).toBe('s2');

      db.close();
    });

    it('filters by workspace', () => {
      const db = openDb(DB_PATH);
      const now = Date.now();

      insertSession(db, { session_id: 'a1', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: now - 2000 });
      insertSession(db, { session_id: 'b1', workspace: 'ws-b', cwd: '/b', transcript_path: null, started_at: now - 1000 });
      insertSession(db, { session_id: 'a2', workspace: 'ws-a', cwd: '/a', transcript_path: null, started_at: now });

      const historyA = getSessionHistory(db, { workspace: 'ws-a', limit: 100 });
      expect(historyA).toHaveLength(2);
      expect(historyA[0].session_id).toBe('a2');
      expect(historyA[1].session_id).toBe('a1');

      db.close();
    });
  });

  describe('ingestBatch', () => {
    it('batch ingests multiple sessions', () => {
      const db = openDb(DB_PATH);
      writeFileSync(TRANSCRIPT_PATH, makeTranscript('batch-1'));
      writeFileSync(TRANSCRIPT_PATH_2, makeTranscript('batch-2'));

      insertSession(db, { session_id: 'batch-1', workspace: 'ws', cwd: '/t', transcript_path: TRANSCRIPT_PATH, started_at: Date.now() });
      insertSession(db, { session_id: 'batch-2', workspace: 'ws', cwd: '/t', transcript_path: TRANSCRIPT_PATH_2, started_at: Date.now() });

      const result = ingestBatch(db, {});
      expect(result.ingested).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);
      expect(result.results).toHaveLength(2);

      expect(getSession(db, 'batch-1')!.ingested_at).not.toBeNull();
      expect(getSession(db, 'batch-2')!.ingested_at).not.toBeNull();

      db.close();
    });

    it('skips already ingested sessions', () => {
      const db = openDb(DB_PATH);
      writeFileSync(TRANSCRIPT_PATH, makeTranscript('skip-test'));

      insertSession(db, { session_id: 'skip-test', workspace: 'ws', cwd: '/t', transcript_path: TRANSCRIPT_PATH, started_at: Date.now() });
      ingestSession(db, 'skip-test');

      const result = ingestBatch(db, {});
      expect(result.ingested).toBe(0);
      expect(result.skipped).toBe(1);

      db.close();
    });

    it('reingests with force flag', () => {
      const db = openDb(DB_PATH);
      writeFileSync(TRANSCRIPT_PATH, makeTranscript('force-test'));

      insertSession(db, { session_id: 'force-test', workspace: 'ws', cwd: '/t', transcript_path: TRANSCRIPT_PATH, started_at: Date.now() });
      ingestSession(db, 'force-test');

      const result = ingestBatch(db, { force: true });
      expect(result.ingested).toBe(1);
      expect(result.skipped).toBe(0);

      db.close();
    });
  });

  describe('upsertSession', () => {
    it('inserts a new session', () => {
      const db = openDb(DB_PATH);

      upsertSession(db, { session_id: 'upsert-new', workspace: 'ws', cwd: '/t', transcript_path: null, started_at: Date.now() });

      const session = getSession(db, 'upsert-new');
      expect(session).not.toBeNull();
      expect(session!.workspace).toBe('ws');
      expect(session!.state).toBe('active');

      db.close();
    });

    it('updates an existing session', () => {
      const db = openDb(DB_PATH);

      insertSession(db, { session_id: 'upsert-exist', workspace: 'old-ws', cwd: '/old', transcript_path: null, started_at: Date.now() });
      upsertSession(db, { session_id: 'upsert-exist', workspace: 'new-ws', cwd: '/new', transcript_path: null, started_at: Date.now() });

      const session = getSession(db, 'upsert-exist');
      expect(session!.workspace).toBe('new-ws');
      expect(session!.cwd).toBe('/new');
      expect(session!.state).toBe('active');

      db.close();
    });
  });

  describe('upsertWorkspace + getCachedWorkspace', () => {
    it('inserts and retrieves workspace cache', () => {
      const db = openDb(DB_PATH);

      upsertWorkspace(db, { cwd: '/project', repo_name: 'test-repo', branch: 'main', workspace: 'test-repo:main', resolved_at: Date.now() });

      const cached = getCachedWorkspace(db, '/project');
      expect(cached).not.toBeNull();
      expect(cached!.repo_name).toBe('test-repo');
      expect(cached!.branch).toBe('main');
      expect(cached!.workspace).toBe('test-repo:main');

      db.close();
    });

    it('updates existing workspace cache', () => {
      const db = openDb(DB_PATH);

      upsertWorkspace(db, { cwd: '/project', repo_name: 'old', branch: 'old', workspace: 'old:old', resolved_at: Date.now() });
      upsertWorkspace(db, { cwd: '/project', repo_name: 'new', branch: 'feat', workspace: 'new:feat', resolved_at: Date.now() });

      const cached = getCachedWorkspace(db, '/project');
      expect(cached!.repo_name).toBe('new');
      expect(cached!.branch).toBe('feat');
      expect(cached!.workspace).toBe('new:feat');

      db.close();
    });

    it('returns null for non-existent workspace', () => {
      const db = openDb(DB_PATH);
      expect(getCachedWorkspace(db, '/nonexistent')).toBeNull();
      db.close();
    });
  });

  describe('parsePayload', () => {
    it('parses valid JSON with required fields', () => {
      const payload = parsePayload(JSON.stringify({ session_id: 'test', cwd: '/tmp', permission_mode: 'default' }));
      expect(payload.session_id).toBe('test');
      expect(payload.cwd).toBe('/tmp');
      expect(payload.permission_mode).toBe('default');
    });

    it('extracts optional fields', () => {
      const payload = parsePayload(JSON.stringify({
        session_id: 'test', cwd: '/tmp',
        tool_name: 'Read', tool_input: { file_path: '/a.ts' },
        source: 'startup', reason: 'done',
      }));
      expect(payload.tool_name).toBe('Read');
      expect(payload.source).toBe('startup');
      expect(payload.reason).toBe('done');
    });

    it('throws on invalid JSON', () => {
      expect(() => parsePayload('not json')).toThrow('Invalid JSON');
    });

    it('throws on missing required fields', () => {
      expect(() => parsePayload(JSON.stringify({ cwd: '/tmp' }))).toThrow('session_id');
      expect(() => parsePayload(JSON.stringify({ session_id: 'test' }))).toThrow('cwd');
    });
  });

  describe('parseSweepThreshold', () => {
    it('parses minutes', () => {
      expect(parseSweepThreshold('10m')).toBe(10 * 60 * 1000);
      expect(parseSweepThreshold('5m')).toBe(5 * 60 * 1000);
    });

    it('throws on non-minute formats', () => {
      expect(() => parseSweepThreshold('1h')).toThrow();
      expect(() => parseSweepThreshold('7d')).toThrow();
      expect(() => parseSweepThreshold('invalid')).toThrow();
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
      expect(line!.sessionId).toBe('test');
      expect(line!.promptText).toBe('Hello');
    });

    it('parses assistant message with tool use', () => {
      const line = parseTranscriptLine(JSON.stringify({
        type: 'assistant', sessionId: 'test', timestamp: new Date(2000).toISOString(), uuid: 'a1',
        message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.ts' } }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 } },
      }));
      expect(line).not.toBeNull();
      expect(line!.type).toBe('assistant');
      expect(line!.model).toBe('claude-sonnet-4-5-20250929');
      expect(line!.toolUses).toHaveLength(1);
      expect(line!.toolUses![0].name).toBe('Read');
      expect(line!.usage!.input_tokens).toBe(1000);
      expect(line!.usage!.cache_read_tokens).toBe(200);
    });

    it('parses tool result', () => {
      const line = parseTranscriptLine(JSON.stringify({
        type: 'user', sessionId: 'test', timestamp: new Date(3000).toISOString(), uuid: 'u2',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false }] },
      }));
      expect(line).not.toBeNull();
      expect(line!.toolResults).toHaveLength(1);
      expect(line!.toolResults![0].tool_use_id).toBe('tu1');
      expect(line!.toolResults![0].is_error).toBe(false);
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
      expect(turns[0].model).toBe('claude-sonnet-4-5-20250929');
      expect(turns[0].toolUses).toHaveLength(1);
      expect(turns[0].toolUses[0].name).toBe('Read');
      expect(turns[0].toolResults).toHaveLength(1);
      expect(turns[0].assistantUsage!.input_tokens).toBe(1000);
      // durationMs = endedAt - startedAt; endedAt is the last assistant timestamp (2000), not tool_result (3000)
      expect(turns[0].durationMs).toBe(1000);
    });

    it('handles empty input', () => {
      expect(groupIntoTurns([])).toHaveLength(0);
    });

    it('creates separate turns for separate user prompts', () => {
      const lines = [
        parseTranscriptLine(JSON.stringify({ type: 'user', sessionId: 'test', timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'First prompt' } })),
        parseTranscriptLine(JSON.stringify({ type: 'assistant', sessionId: 'test', timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: 'Done', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })),
        parseTranscriptLine(JSON.stringify({ type: 'user', sessionId: 'test', timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: 'Second prompt' } })),
        parseTranscriptLine(JSON.stringify({ type: 'assistant', sessionId: 'test', timestamp: new Date(4000).toISOString(), uuid: 'a2', message: { model: 'claude-sonnet-4-5-20250929', content: 'Also done', usage: { input_tokens: 200, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } })),
      ].filter((l): l is NonNullable<typeof l> => l !== null);

      const turns = groupIntoTurns(lines);
      expect(turns).toHaveLength(2);
      expect(turns[0].promptText).toBe('First prompt');
      expect(turns[1].promptText).toBe('Second prompt');
    });
  });
});
