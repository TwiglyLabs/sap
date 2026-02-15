# Phase 3: Integration Tests and Parity Verification

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Verify complete parity between the CLI interface and the library API. Every operation the CLI can do, the library can do — with the same data, same results.

**Architecture:** Tests use the library API directly (no subprocess spawning), exercise every public function, and verify return types match the documented interfaces. A parity table test cross-references CLI commands to library functions.

**Tech Stack:** vitest, TypeScript, better-sqlite3

**Related:** [../design/overview.md](../design/overview.md), [./phase-1.md](./phase-1.md), [./phase-2.md](./phase-2.md)

---

### Task 1: Analytics integration test via library API

The existing `src/analytics-integration.test.ts` tests analytics through
the CLI functions. This task adds a parallel test that exercises the same
analytics through the library API to verify parity.

**Files:**
- Create: `src/library-analytics.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync, writeFileSync } from 'fs';
import {
  openDb,
  recordEvent,
  ingestSession,
  summaryQuery,
  toolsQuery,
  sessionsAnalyticsQuery,
  patternsQuery,
  getSession,
  parseDuration,
  buildWhereClause,
} from './index.ts';

describe('library analytics parity', () => {
  const tmpDb = `/tmp/sap-lib-analytics-${process.pid}.db`;
  const tmpTranscript = `/tmp/sap-lib-transcript-${process.pid}.jsonl`;

  afterEach(() => {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm', tmpTranscript]) {
      try { unlinkSync(f); } catch {}
    }
  });

  function makeTranscript(): string {
    const lines = [
      {
        type: 'user',
        sessionId: 'analytics-test',
        timestamp: new Date(1000).toISOString(),
        uuid: 'u1',
        message: { content: 'Fix the bug' },
      },
      {
        type: 'assistant',
        sessionId: 'analytics-test',
        timestamp: new Date(2000).toISOString(),
        uuid: 'a1',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: '/src/app.ts' } },
          ],
          usage: {
            input_tokens: 1000,
            output_tokens: 500,
            cache_read_input_tokens: 200,
            cache_creation_input_tokens: 100,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'analytics-test',
        timestamp: new Date(3000).toISOString(),
        uuid: 'u2',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu1', content: 'file contents', is_error: false },
          ],
        },
      },
      {
        type: 'assistant',
        sessionId: 'analytics-test',
        timestamp: new Date(4000).toISOString(),
        uuid: 'a2',
        message: {
          model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'tool_use', id: 'tu2', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'a', new_string: 'b' } },
          ],
          usage: {
            input_tokens: 800,
            output_tokens: 300,
            cache_read_input_tokens: 150,
            cache_creation_input_tokens: 50,
          },
        },
      },
      {
        type: 'user',
        sessionId: 'analytics-test',
        timestamp: new Date(5000).toISOString(),
        uuid: 'u3',
        message: {
          content: [
            { type: 'tool_result', tool_use_id: 'tu2', content: 'ok', is_error: false },
          ],
        },
      },
    ];

    return lines.map(l => JSON.stringify(l)).join('\n');
  }

  it('summaryQuery returns correct structure', () => {
    writeFileSync(tmpTranscript, makeTranscript());
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 'analytics-test',
      cwd: '/tmp/repo',
      transcript_path: tmpTranscript,
      permission_mode: 'default',
      hook_event_name: 'session-start',
      source: 'startup',
    });

    const result = ingestSession(db, 'analytics-test');
    expect(result.turns).toBe(1);
    expect(result.toolCalls).toBe(2);

    const summary = summaryQuery(db, {});
    expect(summary.period.until).toBeDefined();
    expect(summary.sessions.total).toBe(1);
    expect(summary.tokens.total_input).toBe(1800);
    expect(summary.tokens.total_output).toBe(800);
    expect(summary.tools.total_calls).toBe(2);
    expect(summary.tools.top.length).toBeGreaterThan(0);

    db.close();
  });

  it('toolsQuery returns per-tool breakdown', () => {
    writeFileSync(tmpTranscript, makeTranscript());
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 'analytics-test',
      cwd: '/tmp/repo',
      transcript_path: tmpTranscript,
      permission_mode: 'default',
      hook_event_name: 'session-start',
      source: 'startup',
    });

    ingestSession(db, 'analytics-test');

    const tools = toolsQuery(db, {});
    expect(tools.tools.length).toBe(2);

    const readTool = tools.tools.find(t => t.tool === 'Read');
    expect(readTool).toBeDefined();
    expect(readTool!.count).toBe(1);
    expect(readTool!.success_rate).toBe(1);

    db.close();
  });

  it('sessionsAnalyticsQuery returns per-session metrics', () => {
    writeFileSync(tmpTranscript, makeTranscript());
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 'analytics-test',
      cwd: '/tmp/repo',
      transcript_path: tmpTranscript,
      permission_mode: 'default',
      hook_event_name: 'session-start',
      source: 'startup',
    });

    ingestSession(db, 'analytics-test');

    const result = sessionsAnalyticsQuery(db, {}, 10);
    expect(result.sessions.length).toBe(1);
    expect(result.sessions[0].session_id).toBe('analytics-test');
    expect(result.sessions[0].turns).toBe(1);
    expect(result.sessions[0].tool_calls).toBe(2);
    expect(result.sessions[0].input_tokens).toBe(1800);

    db.close();
  });

  it('patternsQuery returns anti-patterns and outliers', () => {
    const db = openDb(tmpDb);
    const patterns = patternsQuery(db, {});
    expect(patterns.anti_patterns).toEqual([]);
    expect(patterns.outlier_sessions).toEqual([]);
    db.close();
  });

  it('parseDuration handles all units', () => {
    expect(parseDuration('7d')).toBe(7 * 86400 * 1000);
    expect(parseDuration('24h')).toBe(24 * 3600 * 1000);
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
    expect(() => parseDuration('bad')).toThrow();
  });

  it('buildWhereClause generates correct SQL', () => {
    const empty = buildWhereClause({});
    expect(empty.clause).toBe('');
    expect(empty.params).toEqual([]);

    const withWorkspace = buildWhereClause({ workspace: 'repo:main' });
    expect(withWorkspace.clause).toContain('s.workspace = ?');
    expect(withWorkspace.params).toContain('repo:main');

    const withBoth = buildWhereClause({ workspace: 'repo:main', sinceMs: 86400000 });
    expect(withBoth.clause).toContain('AND');
    expect(withBoth.params.length).toBe(2);
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run src/library-analytics.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/library-analytics.test.ts
git commit -m "test: library analytics parity tests"
```

---

### Task 2: Lifecycle operations test via library API

**Files:**
- Create: `src/library-lifecycle.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { unlinkSync } from 'fs';
import {
  openDb,
  recordEvent,
  statusQuery,
  statusQueryGrouped,
  latestQuery,
  sessionsQuery,
  gcCommand,
  sweepCommand,
  getSession,
  insertSession,
  updateSessionState,
} from './index.ts';

describe('library lifecycle parity', () => {
  const tmpDb = `/tmp/sap-lib-lifecycle-${process.pid}.db`;

  afterEach(() => {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) {
      try { unlinkSync(f); } catch {}
    }
  });

  it('full session lifecycle: start → tool-use → idle → attention → end', () => {
    const db = openDb(tmpDb);
    const payload = {
      session_id: 'lifecycle-001',
      cwd: '/tmp/repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: '',
    };

    // Start
    recordEvent(db, 'session-start', { ...payload, source: 'startup' as const });
    expect(getSession(db, 'lifecycle-001')!.state).toBe('active');

    // Tool use
    recordEvent(db, 'tool-use', { ...payload, tool_name: 'Bash', tool_input: { command: 'npm test' } });
    const s1 = getSession(db, 'lifecycle-001')!;
    expect(s1.state).toBe('active');
    expect(s1.last_tool).toBe('Bash');
    expect(s1.last_tool_detail).toBe('npm test');

    // Turn complete → idle
    recordEvent(db, 'turn-complete', payload);
    expect(getSession(db, 'lifecycle-001')!.state).toBe('idle');

    // User prompt → active again
    recordEvent(db, 'user-prompt', { ...payload, prompt: 'now fix the CSS' });
    expect(getSession(db, 'lifecycle-001')!.state).toBe('active');

    // Attention permission
    recordEvent(db, 'attention-permission', payload);
    expect(getSession(db, 'lifecycle-001')!.state).toBe('attention');

    // End
    recordEvent(db, 'session-end', { ...payload, reason: 'user_exit' });
    expect(getSession(db, 'lifecycle-001')!.state).toBe('stopped');

    db.close();
  });

  it('statusQuery returns only non-stopped sessions', () => {
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 'active-one', cwd: '/tmp/a', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });
    recordEvent(db, 'session-start', {
      session_id: 'stopped-one', cwd: '/tmp/b', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });
    recordEvent(db, 'session-end', {
      session_id: 'stopped-one', cwd: '/tmp/b', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', reason: 'done',
    });

    const status = statusQuery(db);
    expect(status.sessions.length).toBe(1);
    expect(status.sessions[0].session_id).toBe('active-one');

    db.close();
  });

  it('statusQueryGrouped groups by workspace', () => {
    const db = openDb(tmpDb);

    recordEvent(db, 'session-start', {
      session_id: 's1', cwd: '/tmp/a', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });
    recordEvent(db, 'session-start', {
      session_id: 's2', cwd: '/tmp/a', transcript_path: '',
      permission_mode: 'default', hook_event_name: '', source: 'startup' as const,
    });

    const grouped = statusQueryGrouped(db);
    const workspaces = Object.keys(grouped.workspaces);
    expect(workspaces.length).toBeGreaterThan(0);

    // Both sessions should be under the same workspace
    const ws = grouped.workspaces[workspaces[0]];
    expect(ws.length).toBe(2);

    db.close();
  });

  it('sweepCommand marks stale sessions as stopped', () => {
    const db = openDb(tmpDb);

    // Insert a session with old last_event_at
    insertSession(db, {
      session_id: 'stale-one',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: Date.now() - 20 * 60 * 1000, // 20 min ago
    });
    updateSessionState(db, 'stale-one', 'active', Date.now() - 20 * 60 * 1000);

    const swept = sweepCommand(db, 10 * 60 * 1000); // 10 min threshold
    expect(swept).toBe(1);
    expect(getSession(db, 'stale-one')!.state).toBe('stopped');

    db.close();
  });

  it('gcCommand deletes old stopped sessions', () => {
    const db = openDb(tmpDb);

    // Insert a session that ended 40 days ago
    const fortyDaysAgo = Date.now() - 40 * 24 * 60 * 60 * 1000;
    insertSession(db, {
      session_id: 'old-one',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: fortyDaysAgo,
    });
    updateSessionState(db, 'old-one', 'stopped', fortyDaysAgo);

    const deleted = gcCommand(db, 30 * 24 * 60 * 60 * 1000); // 30 day threshold
    expect(deleted).toBe(1);
    expect(getSession(db, 'old-one')).toBeNull();

    db.close();
  });

  it('sessionsQuery respects workspace filter and limit', () => {
    const db = openDb(tmpDb);

    for (let i = 0; i < 5; i++) {
      insertSession(db, {
        session_id: `s${i}`,
        workspace: i < 3 ? 'repo:main' : 'repo:dev',
        cwd: '/tmp',
        transcript_path: null,
        started_at: Date.now() - i * 1000,
      });
    }

    const all = sessionsQuery(db, { limit: 100 });
    expect(all.length).toBe(5);

    const mainOnly = sessionsQuery(db, { workspace: 'repo:main', limit: 100 });
    expect(mainOnly.length).toBe(3);

    const limited = sessionsQuery(db, { limit: 2 });
    expect(limited.length).toBe(2);

    db.close();
  });

  it('latestQuery returns most recent session for workspace', () => {
    const db = openDb(tmpDb);

    insertSession(db, {
      session_id: 'older',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: 1000,
    });
    insertSession(db, {
      session_id: 'newer',
      workspace: 'repo:main',
      cwd: '/tmp',
      transcript_path: null,
      started_at: 2000,
    });

    const latest = latestQuery(db, 'repo:main');
    expect(latest).not.toBeNull();
    expect(latest!.session_id).toBe('newer');

    const none = latestQuery(db, 'nonexistent:workspace');
    expect(none).toBeNull();

    db.close();
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run src/library-lifecycle.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/library-lifecycle.test.ts
git commit -m "test: library lifecycle parity tests"
```

---

### Task 3: End-to-end test of the built library artifact

The previous tests import from `./index.ts` (source). This task tests the
actual built `dist/index.js` artifact — the thing a real consumer would import.
This catches build-time issues: missing exports after bundling, broken
sourcemaps, module format problems, or esbuild stripping something it shouldn't.

**Files:**
- Create: `src/library-e2e.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, unlinkSync, readFileSync } from 'fs';
import { join } from 'path';

/**
 * E2E test: imports from the built dist/index.js artifact.
 * Requires `npm run test:e2e` (which runs build first) or a manual
 * `node build.mjs` before running this test directly.
 */
describe('library e2e (built artifact)', () => {
  const distPath = join(__dirname, '..', 'dist', 'index.js');
  const tmpDb = `/tmp/sap-e2e-${process.pid}.db`;
  let lib: Record<string, any>;

  beforeAll(async () => {
    if (!existsSync(distPath)) {
      throw new Error(
        'dist/index.js not found. Run "npm run test:e2e" or "node build.mjs" first.',
      );
    }
    lib = await import(distPath);
  });

  afterAll(() => {
    for (const f of [tmpDb, tmpDb + '-wal', tmpDb + '-shm']) {
      try { unlinkSync(f); } catch {}
    }
  });

  it('dist/index.js exports all expected functions', () => {
    // Core database
    expect(typeof lib.openDb).toBe('function');
    expect(typeof lib.DEFAULT_DB_PATH).toBe('string');
    expect(typeof lib.insertSession).toBe('function');
    expect(typeof lib.getSession).toBe('function');

    // Commands
    expect(typeof lib.recordEvent).toBe('function');
    expect(typeof lib.statusQuery).toBe('function');
    expect(typeof lib.latestQuery).toBe('function');
    expect(typeof lib.sessionsQuery).toBe('function');
    expect(typeof lib.gcCommand).toBe('function');
    expect(typeof lib.sweepCommand).toBe('function');
    expect(typeof lib.ingestSession).toBe('function');
    expect(typeof lib.executeQuery).toBe('function');

    // Analytics
    expect(typeof lib.summaryQuery).toBe('function');
    expect(typeof lib.toolsQuery).toBe('function');
    expect(typeof lib.sessionsAnalyticsQuery).toBe('function');
    expect(typeof lib.patternsQuery).toBe('function');

    // Utilities
    expect(typeof lib.resolveWorkspace).toBe('function');
    expect(typeof lib.parseTranscriptLine).toBe('function');
    expect(typeof lib.extractToolDetail).toBe('function');
  });

  it('full workflow through built artifact', () => {
    const db = lib.openDb(tmpDb);

    // Start a session
    lib.recordEvent(db, 'session-start', {
      session_id: 'e2e-001',
      cwd: '/tmp/e2e-repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'session-start',
      source: 'startup',
    });

    // Query via library
    const status = lib.statusQuery(db);
    expect(status.sessions.length).toBe(1);
    expect(status.sessions[0].session_id).toBe('e2e-001');

    // Tool use
    lib.recordEvent(db, 'tool-use', {
      session_id: 'e2e-001',
      cwd: '/tmp/e2e-repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'tool-use',
      tool_name: 'Read',
      tool_input: { file_path: '/tmp/e2e-repo/index.ts' },
    });

    const session = lib.getSession(db, 'e2e-001');
    expect(session.last_tool).toBe('Read');

    // Raw query
    const qr = lib.executeQuery(db, 'SELECT count(*) as n FROM sessions');
    expect(qr.rows[0].n).toBe(1);
    expect(qr.error).toBeUndefined();

    // Write query blocked
    const bad = lib.executeQuery(db, 'DELETE FROM sessions');
    expect(bad.error).toBeDefined();

    // End session
    lib.recordEvent(db, 'session-end', {
      session_id: 'e2e-001',
      cwd: '/tmp/e2e-repo',
      transcript_path: '',
      permission_mode: 'default',
      hook_event_name: 'session-end',
      reason: 'user_exit',
    });

    expect(lib.getSession(db, 'e2e-001').state).toBe('stopped');
    db.close();
  });

  it('dist/index.js does not contain chalk or commander', () => {
    const content = readFileSync(distPath, 'utf-8');
    // These strings would appear if CLI deps leaked into the library bundle
    expect(content).not.toContain('chalk');
    expect(content).not.toContain('commander');
  });

  it('dist/index.d.ts exists and contains key exports', () => {
    const dtsPath = distPath.replace('.js', '.d.ts');
    expect(existsSync(dtsPath)).toBe(true);

    const content = readFileSync(dtsPath, 'utf-8');
    expect(content).toContain('openDb');
    expect(content).toContain('Session');
    expect(content).toContain('StatusResult');
    expect(content).toContain('SummaryResult');
  });

  it('dist/index.js.map exists (sourcemap)', () => {
    expect(existsSync(distPath + '.map')).toBe(true);
  });
});
```

**Step 2: Run the build, then the test**

Run: `npm run test:e2e`
(This runs `node build.mjs && npx vitest run src/library-e2e.test.ts`.)
Expected: PASS — the built artifact exports everything, runs a full workflow,
contains no CLI dependencies, has declarations, and has a sourcemap.

**Step 3: Commit**

```bash
git add src/library-e2e.test.ts
git commit -m "test: e2e test of built library artifact"
```

---

### Task 4: Run the full test suite

**Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass — existing CLI tests, library contract tests (Phase 1),
library parity tests (Phase 3 Tasks 1-2), and e2e artifact test (Phase 3 Task 3).

**Step 2: Run the build**

Run: `node build.mjs`
Expected: All artifacts produced without errors.

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No errors.

**Step 4: Final commit if any cleanup was needed**

If any fixes were required, commit them. Otherwise, no commit needed.
