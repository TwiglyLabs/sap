import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { openDb } from '../../../core/storage.ts';
import { SessionRepositorySqlite } from '../../sessions/sqlite/session.repository.sqlite.ts';
import { IngestionRepositorySqlite } from '../sqlite/ingestion.repository.sqlite.ts';
import { IngestionService } from '../ingestion.service.ts';
import type Database from 'better-sqlite3';

const TRANSCRIPT = `/tmp/sap-ingest-test-${process.pid}.jsonl`;

function makeTranscript(sessionId: string = 'test-ingest'): string {
  return [
    { type: 'user', sessionId, timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Fix the bug' } },
    { type: 'assistant', sessionId, timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/app.ts' } }], usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 } } },
    { type: 'user', sessionId, timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false }] } },
    { type: 'assistant', sessionId, timestamp: new Date(4000).toISOString(), uuid: 'a2', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'bad', new_string: 'good' } }], usage: { input_tokens: 800, output_tokens: 300, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: 'user', sessionId, timestamp: new Date(5000).toISOString(), uuid: 'u3', message: { content: [{ type: 'tool_result', tool_use_id: 'tu2', content: 'ok', is_error: false }] } },
  ].map(l => JSON.stringify(l)).join('\n');
}

function makeErrorTranscript(sessionId: string = 'test-errors'): string {
  return [
    { type: 'user', sessionId, timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Fix the bug' } },
    { type: 'assistant', sessionId, timestamp: new Date(2000).toISOString(), uuid: 'a1', message: { model: 'claude-sonnet-4-5-20250929', content: [{ type: 'tool_use', id: 'tu1', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'wrong', new_string: 'right' } }], usage: { input_tokens: 500, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } },
    { type: 'user', sessionId, timestamp: new Date(3000).toISOString(), uuid: 'u2', message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'Edit failed: string not found', is_error: true }] } },
  ].map(l => JSON.stringify(l)).join('\n');
}

describe('IngestionService', () => {
  let db: Database.Database;
  let sessionRepo: SessionRepositorySqlite;
  let ingestionRepo: IngestionRepositorySqlite;
  let ingestion: IngestionService;

  beforeEach(() => {
    db = openDb(':memory:');
    sessionRepo = new SessionRepositorySqlite(db);
    ingestionRepo = new IngestionRepositorySqlite(db);
    ingestion = new IngestionService(ingestionRepo);
  });

  afterEach(() => {
    try { unlinkSync(TRANSCRIPT); } catch {}
    db.close();
  });

  describe('ingestSession', () => {
    it('ingests a transcript with turns and tool calls', () => {
      writeFileSync(TRANSCRIPT, makeTranscript());
      sessionRepo.insertSession({ session_id: 'test-ingest', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });

      const result = ingestion.ingestSession('test-ingest');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.turns).toBe(1);
      expect(result.data.toolCalls).toBe(2);
      expect(result.data.skipped).toBe(false);
    });

    it('stores correct turn data', () => {
      writeFileSync(TRANSCRIPT, makeTranscript());
      sessionRepo.insertSession({ session_id: 'test-ingest', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });
      ingestion.ingestSession('test-ingest');

      const turns = ingestionRepo.getSessionTurns('test-ingest');
      expect(turns).toHaveLength(1);
      expect(turns[0].turn_number).toBe(1);
      expect(turns[0].prompt_text).toBe('Fix the bug');
      expect(turns[0].model).toBe('claude-sonnet-4-5-20250929');
      expect(turns[0].input_tokens).toBe(1800);
      expect(turns[0].output_tokens).toBe(800);
      expect(turns[0].cache_read_tokens).toBe(200);
      expect(turns[0].cache_write_tokens).toBe(100);
      expect(turns[0].tool_call_count).toBe(2);
    });

    it('stores correct tool call data with input summary', () => {
      writeFileSync(TRANSCRIPT, makeTranscript());
      sessionRepo.insertSession({ session_id: 'test-ingest', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });
      ingestion.ingestSession('test-ingest');

      const turns = ingestionRepo.getSessionTurns('test-ingest');
      const toolCalls = ingestionRepo.getTurnToolCalls(turns[0].id);
      expect(toolCalls).toHaveLength(2);

      const readCall = toolCalls.find(tc => tc.tool_name === 'Read');
      expect(readCall!.tool_use_id).toBe('tu1');
      expect(readCall!.tool_input_summary).toBe('app.ts');
      expect(readCall!.success).toBe(1);
      expect(readCall!.error_message).toBeNull();

      const editCall = toolCalls.find(tc => tc.tool_name === 'Edit');
      expect(editCall!.success).toBe(1);
    });

    it('detects tool call errors', () => {
      writeFileSync(TRANSCRIPT, makeErrorTranscript());
      sessionRepo.insertSession({ session_id: 'test-errors', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });
      ingestion.ingestSession('test-errors');

      const turns = ingestionRepo.getSessionTurns('test-errors');
      const toolCalls = ingestionRepo.getTurnToolCalls(turns[0].id);
      expect(toolCalls[0].success).toBe(0);
      expect(toolCalls[0].error_message).toContain('Edit failed');
    });

    it('marks session as ingested', () => {
      writeFileSync(TRANSCRIPT, makeTranscript());
      sessionRepo.insertSession({ session_id: 'test-ingest', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });
      ingestion.ingestSession('test-ingest');

      const session = sessionRepo.getSession('test-ingest');
      expect(session!.ingested_at).not.toBeNull();
    });

    it('skips already-ingested sessions without force', () => {
      writeFileSync(TRANSCRIPT, makeTranscript());
      sessionRepo.insertSession({ session_id: 'test-ingest', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });
      ingestion.ingestSession('test-ingest');

      const result = ingestion.ingestSession('test-ingest');
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.skipped).toBe(true);
      expect(result.data.turns).toBe(0);
    });

    it('re-ingests with force flag', () => {
      writeFileSync(TRANSCRIPT, makeTranscript());
      sessionRepo.insertSession({ session_id: 'test-ingest', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });
      ingestion.ingestSession('test-ingest');

      const result = ingestion.ingestSession('test-ingest', { force: true });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.skipped).toBe(false);
      expect(result.data.turns).toBe(1);
      expect(result.data.toolCalls).toBe(2);

      // Should not duplicate - old data deleted before reingest
      const turns = ingestionRepo.getSessionTurns('test-ingest');
      expect(turns).toHaveLength(1);
    });

    it('returns error for nonexistent session', () => {
      const result = ingestion.ingestSession('nonexistent');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('Session not found');
    });

    it('returns error for session with no transcript path', () => {
      sessionRepo.insertSession({ session_id: 'no-path', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });

      const result = ingestion.ingestSession('no-path');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toBe('No transcript path');
    });

    it('returns error for missing transcript file', () => {
      sessionRepo.insertSession({ session_id: 'missing', workspace: 'ws', cwd: '/', transcript_path: '/tmp/does-not-exist.jsonl', started_at: 1000 });

      const result = ingestion.ingestSession('missing');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.error).toContain('Transcript file not found');
    });
  });

  describe('ingestBatch', () => {
    it('ingests all uninigested sessions', () => {
      writeFileSync(TRANSCRIPT, makeTranscript('batch-1'));
      const t2 = TRANSCRIPT + '.2';
      writeFileSync(t2, makeTranscript('batch-2'));

      sessionRepo.insertSession({ session_id: 'batch-1', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });
      sessionRepo.insertSession({ session_id: 'batch-2', workspace: 'ws', cwd: '/', transcript_path: t2, started_at: 2000 });

      const result = ingestion.ingestBatch({});
      expect(result.ingested).toBe(2);
      expect(result.skipped).toBe(0);
      expect(result.errors).toHaveLength(0);

      try { unlinkSync(t2); } catch {}
    });

    it('skips already-ingested sessions in batch', () => {
      writeFileSync(TRANSCRIPT, makeTranscript('batch-skip'));
      sessionRepo.insertSession({ session_id: 'batch-skip', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });
      ingestion.ingestSession('batch-skip');

      const result = ingestion.ingestBatch({});
      expect(result.ingested).toBe(0);
      expect(result.skipped).toBe(1);
    });

    it('respects sinceMs filter', () => {
      writeFileSync(TRANSCRIPT, makeTranscript('old-session'));
      const t2 = TRANSCRIPT + '.2';
      writeFileSync(t2, makeTranscript('new-session'));

      const now = Date.now();
      sessionRepo.insertSession({ session_id: 'old-session', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: now - 10 * 86400 * 1000 });
      sessionRepo.insertSession({ session_id: 'new-session', workspace: 'ws', cwd: '/', transcript_path: t2, started_at: now });

      const result = ingestion.ingestBatch({ sinceMs: 7 * 86400 * 1000 });
      expect(result.ingested).toBe(1);
      expect(result.results.find(r => r.sessionId === 'new-session')).toBeDefined();

      try { unlinkSync(t2); } catch {}
    });

    it('ingests specific session by id', () => {
      writeFileSync(TRANSCRIPT, makeTranscript('specific'));
      sessionRepo.insertSession({ session_id: 'specific', workspace: 'ws', cwd: '/', transcript_path: TRANSCRIPT, started_at: 1000 });
      sessionRepo.insertSession({ session_id: 'other', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 2000 });

      const result = ingestion.ingestBatch({ sessionId: 'specific' });
      expect(result.ingested).toBe(1);
      expect(result.results).toHaveLength(1);
      expect(result.results[0].sessionId).toBe('specific');
    });

    it('reports errors in batch results', () => {
      sessionRepo.insertSession({ session_id: 'bad', workspace: 'ws', cwd: '/', transcript_path: '/nonexistent.jsonl', started_at: 1000 });

      const result = ingestion.ingestBatch({ sessionId: 'bad' });
      expect(result.ingested).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].session_id).toBe('bad');
    });
  });
});
