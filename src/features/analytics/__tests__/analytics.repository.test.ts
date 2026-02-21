import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, unlinkSync } from 'fs';
import { openDb } from '../../../core/storage.ts';
import { SessionRepositorySqlite } from '../../sessions/sqlite/session.repository.sqlite.ts';
import { IngestionRepositorySqlite } from '../../ingestion/sqlite/ingestion.repository.sqlite.ts';
import { IngestionService } from '../../ingestion/ingestion.service.ts';
import { AnalyticsRepositorySqlite } from '../sqlite/analytics.repository.sqlite.ts';
import { AnalyticsService } from '../analytics.service.ts';
import type Database from 'better-sqlite3';

const TMP_PREFIX = `/tmp/sap-analytics-test-${process.pid}`;
const tmpFiles: string[] = [];

function tmpFile(suffix: string): string {
  const path = `${TMP_PREFIX}-${suffix}.jsonl`;
  tmpFiles.push(path);
  return path;
}

function makeTranscript(sessionId: string, opts?: { toolName?: string; errorTool?: boolean; inputTokens?: number }): string {
  const toolName = opts?.toolName ?? 'Read';
  const inputTokens = opts?.inputTokens ?? 1000;
  const lines = [
    { type: 'user', sessionId, timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Fix the bug' } },
    { type: 'assistant', sessionId, timestamp: new Date(2000).toISOString(), uuid: 'a1', message: {
      model: 'claude-sonnet-4-5-20250929',
      content: [{ type: 'tool_use', id: 'tu1', name: toolName, input: toolName === 'Bash' ? { command: 'npm test' } : { file_path: '/src/app.ts' } }],
      usage: { input_tokens: inputTokens, output_tokens: 500, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 },
    }},
    { type: 'user', sessionId, timestamp: new Date(3000).toISOString(), uuid: 'u2', message: {
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: opts?.errorTool ? 'Edit failed' : 'ok', is_error: opts?.errorTool ?? false }],
    }},
  ];
  return lines.map(l => JSON.stringify(l)).join('\n');
}

function makeCommitTranscript(sessionId: string): string {
  return [
    { type: 'user', sessionId, timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Fix and commit' } },
    { type: 'assistant', sessionId, timestamp: new Date(2000).toISOString(), uuid: 'a1', message: {
      model: 'claude-sonnet-4-5-20250929',
      content: [{ type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'git commit -m "fix"' } }],
      usage: { input_tokens: 500, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }},
    { type: 'user', sessionId, timestamp: new Date(3000).toISOString(), uuid: 'u2', message: {
      content: [{ type: 'tool_result', tool_use_id: 'tu1', content: '[main abc123] fix', is_error: false }],
    }},
  ].map(l => JSON.stringify(l)).join('\n');
}

function setupServices(db: Database.Database) {
  const sessionRepo = new SessionRepositorySqlite(db);
  const ingestionRepo = new IngestionRepositorySqlite(db);
  const analyticsRepo = new AnalyticsRepositorySqlite(db);
  const ingestion = new IngestionService(ingestionRepo);
  const analytics = new AnalyticsService(analyticsRepo);
  return { sessionRepo, ingestion, analytics };
}

describe('AnalyticsRepositorySqlite + AnalyticsService', () => {
  let db: Database.Database;
  let sessionRepo: SessionRepositorySqlite;
  let ingestion: IngestionService;
  let analytics: AnalyticsService;

  beforeEach(() => {
    db = openDb(':memory:');
    const s = setupServices(db);
    sessionRepo = s.sessionRepo;
    ingestion = s.ingestion;
    analytics = s.analytics;
  });

  afterEach(() => {
    db.close();
    for (const f of tmpFiles.splice(0)) {
      try { unlinkSync(f); } catch {}
    }
  });

  describe('summaryQuery', () => {
    it('returns session count, turns, and duration', () => {
      const t = tmpFile('summary-1');
      writeFileSync(t, makeTranscript('s1'));
      sessionRepo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('s1');

      const summary = analytics.summary({});
      expect(summary.sessions.total).toBe(1);
      expect(summary.sessions.avg_turns).toBeGreaterThan(0);
    });

    it('returns period metadata', () => {
      const summary = analytics.summary({});
      expect(summary.period.until).toBeDefined();
      expect(summary.period.since).toBeNull(); // no sinceMs filter
    });

    it('returns token totals', () => {
      const t = tmpFile('summary-tokens');
      writeFileSync(t, makeTranscript('s1'));
      sessionRepo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('s1');

      const summary = analytics.summary({});
      expect(summary.tokens.total_input).toBe(1000);
      expect(summary.tokens.total_output).toBe(500);
      expect(summary.tokens.total_cache_read).toBe(200);
      expect(summary.tokens.total_cache_write).toBe(100);
    });

    it('returns top tools by usage', () => {
      const t = tmpFile('summary-tools');
      writeFileSync(t, makeTranscript('s1'));
      sessionRepo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('s1');

      const summary = analytics.summary({});
      expect(summary.tools.total_calls).toBe(1);
      expect(summary.tools.top.length).toBeGreaterThan(0);
      expect(summary.tools.top[0].tool).toBe('Read');
    });

    it('returns workspace breakdown', () => {
      const t = tmpFile('summary-ws');
      writeFileSync(t, makeTranscript('s1'));
      sessionRepo.insertSession({ session_id: 's1', workspace: 'repo:main', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('s1');

      const summary = analytics.summary({});
      expect(summary.sessions.by_workspace.length).toBeGreaterThan(0);
      expect(summary.sessions.by_workspace[0].workspace).toBe('repo:main');
    });

    it('filters by workspace', () => {
      const t1 = tmpFile('ws-a');
      const t2 = tmpFile('ws-b');
      writeFileSync(t1, makeTranscript('sa'));
      writeFileSync(t2, makeTranscript('sb', { inputTokens: 2000 }));
      sessionRepo.insertSession({ session_id: 'sa', workspace: 'ws-a', cwd: '/a', transcript_path: t1, started_at: 1000 });
      sessionRepo.insertSession({ session_id: 'sb', workspace: 'ws-b', cwd: '/b', transcript_path: t2, started_at: 2000 });
      ingestion.ingestSession('sa');
      ingestion.ingestSession('sb');

      const summaryA = analytics.summary({ workspace: 'ws-a' });
      expect(summaryA.sessions.total).toBe(1);
      expect(summaryA.tokens.total_input).toBe(1000);

      const summaryAll = analytics.summary({});
      expect(summaryAll.sessions.total).toBe(2);
    });
  });

  describe('toolsQuery', () => {
    it('returns per-tool breakdown with success rates', () => {
      const t = tmpFile('tools-basic');
      writeFileSync(t, makeTranscript('s1'));
      sessionRepo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('s1');

      const tools = analytics.tools({});
      expect(tools.tools.length).toBe(1);
      expect(tools.tools[0].tool).toBe('Read');
      expect(tools.tools[0].count).toBe(1);
      expect(tools.tools[0].success_rate).toBe(1);
    });

    it('returns tool sequences', () => {
      // Create a transcript with two tool uses in one turn
      const sessionId = 'seq-test';
      const transcript = [
        { type: 'user', sessionId, timestamp: new Date(1000).toISOString(), uuid: 'u1', message: { content: 'Test' } },
        { type: 'assistant', sessionId, timestamp: new Date(2000).toISOString(), uuid: 'a1', message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/a.ts' } },
            { type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/a.ts', old_string: 'x', new_string: 'y' } },
          ],
          usage: { input_tokens: 1000, output_tokens: 500, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        }},
        { type: 'user', sessionId, timestamp: new Date(3000).toISOString(), uuid: 'u2', message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'ok', is_error: false },
            { type: 'tool_result', tool_use_id: 'tu2', content: 'ok', is_error: false },
          ],
        }},
      ].map(l => JSON.stringify(l)).join('\n');

      const t = tmpFile('tools-seq');
      writeFileSync(t, transcript);
      sessionRepo.insertSession({ session_id: sessionId, workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession(sessionId);

      const tools = analytics.tools({});
      expect(tools.sequences.length).toBeGreaterThan(0);
      expect(tools.sequences[0].sequence).toEqual(['Read', 'Edit']);
    });

    it('reports errors in tool breakdown', () => {
      const t = tmpFile('tools-errors');
      writeFileSync(t, makeTranscript('s1', { toolName: 'Edit', errorTool: true }));
      sessionRepo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('s1');

      const tools = analytics.tools({});
      const editTool = tools.tools.find(t => t.tool === 'Edit');
      expect(editTool!.error_count).toBe(1);
      expect(editTool!.success_rate).toBe(0);
      expect(editTool!.top_errors.length).toBeGreaterThan(0);
    });
  });

  describe('sessionsAnalyticsQuery', () => {
    it('returns per-session metrics', () => {
      const t = tmpFile('sa-basic');
      writeFileSync(t, makeTranscript('s1'));
      sessionRepo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('s1');

      const result = analytics.sessionsAnalytics({}, 10);
      expect(result.sessions.length).toBe(1);
      expect(result.sessions[0].session_id).toBe('s1');
      expect(result.sessions[0].turns).toBe(1);
      expect(result.sessions[0].tool_calls).toBe(1);
      expect(result.sessions[0].input_tokens).toBe(1000);
    });

    it('detects commit outcome', () => {
      const t = tmpFile('sa-commit');
      writeFileSync(t, makeCommitTranscript('commit-session'));
      sessionRepo.insertSession({ session_id: 'commit-session', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('commit-session');

      const result = analytics.sessionsAnalytics({}, 10);
      expect(result.sessions[0].outcome.committed).toBe(true);
    });

    it('respects limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        const t = tmpFile(`sa-limit-${i}`);
        writeFileSync(t, makeTranscript(`lim-${i}`));
        sessionRepo.insertSession({ session_id: `lim-${i}`, workspace: 'ws', cwd: '/', transcript_path: t, started_at: i * 1000 });
        ingestion.ingestSession(`lim-${i}`);
      }

      const result = analytics.sessionsAnalytics({}, 2);
      expect(result.sessions.length).toBe(2);
    });
  });

  describe('patternsQuery', () => {
    it('returns empty patterns for clean sessions', () => {
      const patterns = analytics.patterns({});
      expect(patterns.anti_patterns).toEqual([]);
      expect(patterns.outlier_sessions).toEqual([]);
    });

    it('detects edit retry anti-pattern', () => {
      const t = tmpFile('ap-edit');
      writeFileSync(t, makeTranscript('edit-fail', { toolName: 'Edit', errorTool: true }));
      sessionRepo.insertSession({ session_id: 'edit-fail', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('edit-fail');

      const patterns = analytics.patterns({});
      const editRetry = patterns.anti_patterns.find(p => p.pattern === 'edit-retry');
      expect(editRetry).toBeDefined();
      expect(editRetry!.frequency).toBeGreaterThan(0);
      expect(editRetry!.sessions_affected).toBe(1);
    });

    it('detects bash error anti-pattern', () => {
      const t = tmpFile('ap-bash');
      writeFileSync(t, makeTranscript('bash-fail', { toolName: 'Bash', errorTool: true }));
      sessionRepo.insertSession({ session_id: 'bash-fail', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 1000 });
      ingestion.ingestSession('bash-fail');

      const patterns = analytics.patterns({});
      const bashError = patterns.anti_patterns.find(p => p.pattern === 'bash-error');
      expect(bashError).toBeDefined();
      expect(bashError!.frequency).toBeGreaterThan(0);
    });

    it('identifies outlier sessions by token usage', () => {
      // Create 5 normal sessions
      for (let i = 0; i < 5; i++) {
        const t = tmpFile(`normal-${i}`);
        writeFileSync(t, makeTranscript(`normal-${i}`, { inputTokens: 1000 }));
        sessionRepo.insertSession({ session_id: `normal-${i}`, workspace: 'ws', cwd: '/', transcript_path: t, started_at: i * 1000 });
        ingestion.ingestSession(`normal-${i}`);
      }

      // Create 1 outlier
      const t = tmpFile('outlier');
      writeFileSync(t, makeTranscript('outlier', { inputTokens: 50000 }));
      sessionRepo.insertSession({ session_id: 'outlier', workspace: 'ws', cwd: '/', transcript_path: t, started_at: 10000 });
      ingestion.ingestSession('outlier');

      const patterns = analytics.patterns({});
      expect(patterns.outlier_sessions.length).toBeGreaterThan(0);
      const outlier = patterns.outlier_sessions.find(s => s.session_id === 'outlier');
      expect(outlier).toBeDefined();
      expect(outlier!.value).toBe(50000);
      expect(outlier!.reason).toContain('average');
    });
  });

  describe('executeQuery', () => {
    it('executes SELECT and returns rows', () => {
      sessionRepo.insertSession({ session_id: 's1', workspace: 'ws', cwd: '/', transcript_path: null, started_at: 1000 });

      const result = analytics.executeQuery('SELECT count(*) as n FROM sessions');
      expect(result.rows[0].n).toBe(1);
      expect(result.error).toBeUndefined();
    });

    it('supports aggregation queries', () => {
      const result = analytics.executeQuery('SELECT count(*) as n, max(started_at) as latest FROM sessions');
      expect(result.rows).toHaveLength(1);
    });

    it('rejects INSERT statements', () => {
      const result = analytics.executeQuery("INSERT INTO sessions VALUES ('x','y','z',null,'active',0,null,0,null,null,null)");
      expect(result.error).toBeDefined();
      expect(result.error).toContain('Read-only');
    });

    it('rejects DELETE statements', () => {
      const result = analytics.executeQuery('DELETE FROM sessions');
      expect(result.error).toContain('Read-only');
    });

    it('rejects DROP statements', () => {
      const result = analytics.executeQuery('DROP TABLE sessions');
      expect(result.error).toContain('Read-only');
    });

    it('rejects write statements hidden behind SQL comments', () => {
      const result = analytics.executeQuery('/* harmless */ DELETE FROM sessions');
      expect(result.error).toContain('Read-only');
    });

    it('rejects ATTACH DATABASE', () => {
      const result = analytics.executeQuery("ATTACH DATABASE '/tmp/evil.db' AS evil");
      expect(result.error).toContain('Read-only');
    });

    it('allows read-only PRAGMA table_info', () => {
      const result = analytics.executeQuery('PRAGMA table_info(sessions)');
      expect(result.error).toBeUndefined();
      expect(result.rows.length).toBeGreaterThan(0);
    });

    it('returns error for invalid SQL', () => {
      const result = analytics.executeQuery('SELECT * FROM nonexistent_table');
      expect(result.error).toBeDefined();
    });

    it('allows CTEs (WITH queries)', () => {
      const result = analytics.executeQuery('WITH cte AS (SELECT 1 as n) SELECT * FROM cte');
      expect(result.error).toBeUndefined();
      expect(result.rows[0].n).toBe(1);
    });
  });
});
