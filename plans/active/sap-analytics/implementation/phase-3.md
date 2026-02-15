# Phase 3: Query & Analytics Commands

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Build `sap query` for raw SQL access and `sap analytics` convenience commands (summary, tools, sessions, patterns).

**Architecture:** `sap query` opens a read-only DB connection and executes arbitrary SELECT statements, returning JSON. The `sap analytics` subcommands are canned queries that produce structured JSON output. All analytics commands share common filters (--since, --workspace).

**Tech Stack:** TypeScript, better-sqlite3, commander, chalk, vitest

**Related:** [../design/commands.md](../design/commands.md), [./phase-2.md](./phase-2.md)

**Depends on:** Phase 1 (schema), Phase 2 (ingest populates the tables)

---

### Task 1: `sap query` command

**Files:**
- Create: `src/commands/query.ts`
- Modify: `src/cli.ts`
- Test: `src/commands/query.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, insertTurn, insertToolCall } from '../db.ts';
import { executeQuery } from './query.ts';

describe('executeQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, {
      session_id: 's1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: 1000,
    });
  });

  it('executes a SELECT and returns rows as JSON-ready array', () => {
    const result = executeQuery(db, 'SELECT session_id, workspace FROM sessions');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].session_id).toBe('s1');
  });

  it('supports parameterless aggregation queries', () => {
    const result = executeQuery(db, 'SELECT count(*) as n FROM sessions');
    expect(result.rows[0].n).toBe(1);
  });

  it('rejects INSERT statements', () => {
    const result = executeQuery(db, "INSERT INTO sessions VALUES ('x','x','x',null,'active',1,null,1,null,null,null)");
    expect(result.error).toBeDefined();
    expect(result.error).toMatch(/read-only/i);
  });

  it('rejects DELETE statements', () => {
    const result = executeQuery(db, 'DELETE FROM sessions');
    expect(result.error).toBeDefined();
  });

  it('rejects DROP statements', () => {
    const result = executeQuery(db, 'DROP TABLE sessions');
    expect(result.error).toBeDefined();
  });

  it('returns error for invalid SQL', () => {
    const result = executeQuery(db, 'SELECTT * FROM sessions');
    expect(result.error).toBeDefined();
  });

  it('works with CTEs and window functions', () => {
    insertSession(db, { session_id: 's2', workspace: 'repo:dev', cwd: '/r', transcript_path: null, started_at: 2000 });

    const result = executeQuery(db, `
      WITH ranked AS (
        SELECT workspace, row_number() OVER (ORDER BY started_at DESC) as rn
        FROM sessions
      )
      SELECT workspace, rn FROM ranked ORDER BY rn
    `);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0].rn).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands/query.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement `src/commands/query.ts`**

```typescript
import type Database from 'better-sqlite3';
import chalk from 'chalk';

export interface QueryResult {
  rows: Record<string, unknown>[];
  error?: string;
}

const WRITE_PATTERN = /^\s*(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|REPLACE|TRUNCATE)\b/i;

export function executeQuery(db: Database.Database, sql: string): QueryResult {
  if (WRITE_PATTERN.test(sql)) {
    return { rows: [], error: 'Read-only: write statements are not allowed' };
  }

  try {
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    return { rows };
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export interface QueryCliOptions {
  json?: boolean;
}

export function queryCli(db: Database.Database, sql: string, options: QueryCliOptions): void {
  const result = executeQuery(db, sql);

  if (result.error) {
    if (options.json) {
      console.log(JSON.stringify({ error: result.error }));
    } else {
      console.error(`${chalk.red('Error:')} ${result.error}`);
    }
    process.exitCode = 1;
    return;
  }

  // sap query always outputs JSON — it's meant for Claude to consume
  console.log(JSON.stringify(result.rows, null, 2));
}
```

Wire in `src/cli.ts`:

```typescript
import { queryCli } from './commands/query.ts';

program
  .command('query')
  .description(
    'Execute a read-only SQL query against the sap database.\n\n' +
    'Returns results as a JSON array of row objects.\n' +
    'Write statements (INSERT, UPDATE, DELETE, etc.) are rejected.\n\n' +
    'Available tables: sessions, events, workspaces, turns, tool_calls.\n\n' +
    'Example:\n' +
    '  sap query "SELECT tool_name, count(*) as n FROM tool_calls GROUP BY tool_name ORDER BY n DESC"\n' +
    '  sap query "SELECT workspace, sum(output_tokens) FROM turns t JOIN sessions s ON t.session_id = s.session_id GROUP BY workspace"'
  )
  .argument('<sql>', 'SQL query to execute')
  .action((sql) => {
    const db = openDb();
    queryCli(db, sql, { json: true });
    db.close();
  });
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands/query.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/query.ts src/commands/query.test.ts src/cli.ts
git commit -m "feat: add sap query command for raw SQL access"
```

---

### Task 2: Common analytics filters helper

**Files:**
- Create: `src/commands/analytics-common.ts`
- Test: `src/commands/analytics-common.test.ts`

All analytics commands share `--since` and `--workspace` filters. Extract shared logic.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseDuration, buildWhereClause } from './analytics-common.ts';

describe('parseDuration', () => {
  it('parses days', () => {
    expect(parseDuration('7d')).toBe(7 * 86400 * 1000);
  });

  it('parses hours', () => {
    expect(parseDuration('24h')).toBe(24 * 3600 * 1000);
  });

  it('parses minutes', () => {
    expect(parseDuration('30m')).toBe(30 * 60 * 1000);
  });

  it('throws on invalid format', () => {
    expect(() => parseDuration('abc')).toThrow();
  });
});

describe('buildWhereClause', () => {
  it('returns empty for no filters', () => {
    const result = buildWhereClause({});
    expect(result.clause).toBe('');
    expect(result.params).toEqual([]);
  });

  it('adds workspace filter', () => {
    const result = buildWhereClause({ workspace: 'repo:main' });
    expect(result.clause).toContain('workspace = ?');
    expect(result.params).toContain('repo:main');
  });

  it('adds since filter on turns.started_at', () => {
    const before = Date.now();
    const result = buildWhereClause({ sinceMs: 86400000 }, 't.started_at');
    expect(result.clause).toContain('t.started_at >= ?');
    expect(result.params[0]).toBeGreaterThan(before - 86400000 - 1000);
  });

  it('combines workspace and since', () => {
    const result = buildWhereClause({ workspace: 'repo:main', sinceMs: 86400000 }, 't.started_at');
    expect(result.clause).toContain('AND');
    expect(result.params).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands/analytics-common.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement**

```typescript
export function parseDuration(s: string): number {
  const match = s.match(/^(\d+)([dhm])$/);
  if (!match) throw new Error(`Invalid duration: ${s}. Use format like "7d", "24h", "30m".`);
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return n * 86400 * 1000;
    case 'h': return n * 3600 * 1000;
    case 'm': return n * 60 * 1000;
    default: throw new Error(`Invalid duration unit: ${match[2]}`);
  }
}

export interface FilterOptions {
  workspace?: string;
  sinceMs?: number;
}

export interface WhereClause {
  clause: string;
  params: unknown[];
}

export function buildWhereClause(
  filters: FilterOptions,
  timeColumn: string = 's.started_at',
): WhereClause {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters.workspace) {
    conditions.push('s.workspace = ?');
    params.push(filters.workspace);
  }

  if (filters.sinceMs) {
    const cutoff = Date.now() - filters.sinceMs;
    conditions.push(`${timeColumn} >= ?`);
    params.push(cutoff);
  }

  if (conditions.length === 0) {
    return { clause: '', params: [] };
  }

  return { clause: 'WHERE ' + conditions.join(' AND '), params };
}

export interface AnalyticsCliOptions {
  since?: string;
  workspace?: string;
  json?: boolean;
}

export function parseAnalyticsOptions(options: AnalyticsCliOptions): FilterOptions {
  return {
    workspace: options.workspace,
    sinceMs: options.since ? parseDuration(options.since) : undefined,
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands/analytics-common.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/analytics-common.ts src/commands/analytics-common.test.ts
git commit -m "feat: add shared analytics filter helpers"
```

---

### Task 3: `sap analytics summary` command

**Files:**
- Create: `src/commands/analytics-summary.ts`
- Modify: `src/cli.ts`
- Test: `src/commands/analytics-summary.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, insertTurn, insertToolCall } from '../db.ts';
import { summaryQuery } from './analytics-summary.ts';

function seedData(db: Database.Database) {
  insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 3600000 });
  insertSession(db, { session_id: 's2', workspace: 'repo:dev', cwd: '/r', transcript_path: null, started_at: Date.now() - 1800000 });

  const t1 = insertTurn(db, {
    session_id: 's1', turn_number: 1, prompt_text: 'hello',
    input_tokens: 5000, output_tokens: 1000, cache_read_tokens: 2000, cache_write_tokens: 500,
    model: 'claude-sonnet-4-5-20250929', tool_call_count: 2, started_at: Date.now() - 3600000, ended_at: Date.now() - 3500000, duration_ms: 100000,
  });
  const t2 = insertTurn(db, {
    session_id: 's1', turn_number: 2, prompt_text: 'fix bug',
    input_tokens: 8000, output_tokens: 2000, cache_read_tokens: 4000, cache_write_tokens: 1000,
    model: 'claude-sonnet-4-5-20250929', tool_call_count: 1, started_at: Date.now() - 3400000, ended_at: Date.now() - 3300000, duration_ms: 100000,
  });
  const t3 = insertTurn(db, {
    session_id: 's2', turn_number: 1, prompt_text: 'deploy',
    input_tokens: 3000, output_tokens: 500, cache_read_tokens: 1000, cache_write_tokens: 200,
    model: 'claude-sonnet-4-5-20250929', tool_call_count: 1, started_at: Date.now() - 1800000, ended_at: Date.now() - 1700000, duration_ms: 100000,
  });

  insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu1', tool_name: 'Read', tool_input_summary: 'app.ts', success: 1, error_message: null, created_at: Date.now() - 3550000 });
  insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu2', tool_name: 'Edit', tool_input_summary: 'app.ts', success: 1, error_message: null, created_at: Date.now() - 3540000 });
  insertToolCall(db, { session_id: 's1', turn_id: t2, tool_use_id: 'tu3', tool_name: 'Bash', tool_input_summary: 'npm test', success: 0, error_message: 'exit code 1', created_at: Date.now() - 3350000 });
  insertToolCall(db, { session_id: 's2', turn_id: t3, tool_use_id: 'tu4', tool_name: 'Read', tool_input_summary: 'config.ts', success: 1, error_message: null, created_at: Date.now() - 1750000 });
}

describe('summaryQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    seedData(db);
  });

  it('returns session count', () => {
    const result = summaryQuery(db, {});
    expect(result.sessions.total).toBe(2);
  });

  it('returns token totals', () => {
    const result = summaryQuery(db, {});
    expect(result.tokens.total_input).toBe(16000);
    expect(result.tokens.total_output).toBe(3500);
  });

  it('returns top tools', () => {
    const result = summaryQuery(db, {});
    expect(result.tools.total_calls).toBe(4);
    const readTool = result.tools.top.find(t => t.tool === 'Read');
    expect(readTool?.count).toBe(2);
  });

  it('returns workspace breakdown', () => {
    const result = summaryQuery(db, {});
    expect(result.sessions.by_workspace).toHaveLength(2);
  });

  it('filters by workspace', () => {
    const result = summaryQuery(db, { workspace: 'repo:main' });
    expect(result.sessions.total).toBe(1);
    expect(result.tokens.total_input).toBe(13000);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands/analytics-summary.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement `src/commands/analytics-summary.ts`**

```typescript
import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { buildWhereClause, type FilterOptions, type AnalyticsCliOptions, parseAnalyticsOptions } from './analytics-common.ts';

export interface SummaryResult {
  sessions: {
    total: number;
    avg_turns: number;
    by_workspace: { workspace: string; count: number }[];
  };
  tokens: {
    total_input: number;
    total_output: number;
    total_cache_read: number;
    total_cache_write: number;
    avg_per_session: { input: number; output: number };
    avg_per_turn: { input: number; output: number };
  };
  tools: {
    total_calls: number;
    top: { tool: string; count: number; success_rate: number }[];
  };
}

export function summaryQuery(db: Database.Database, filters: FilterOptions): SummaryResult {
  const { clause, params } = buildWhereClause(filters, 't.started_at');

  // Build a join base: turns joined with sessions for workspace filter
  const joinBase = 'FROM turns t JOIN sessions s ON t.session_id = s.session_id';

  // Session count & avg turns
  const sessionStats = db.prepare(`
    SELECT count(DISTINCT t.session_id) as total_sessions,
           count(*) as total_turns
    ${joinBase} ${clause}
  `).get(...params) as { total_sessions: number; total_turns: number };

  // Token totals
  const tokenStats = db.prepare(`
    SELECT coalesce(sum(t.input_tokens), 0) as total_input,
           coalesce(sum(t.output_tokens), 0) as total_output,
           coalesce(sum(t.cache_read_tokens), 0) as total_cache_read,
           coalesce(sum(t.cache_write_tokens), 0) as total_cache_write
    ${joinBase} ${clause}
  `).get(...params) as { total_input: number; total_output: number; total_cache_read: number; total_cache_write: number };

  // By workspace
  const byWorkspace = db.prepare(`
    SELECT s.workspace, count(DISTINCT t.session_id) as count
    ${joinBase} ${clause}
    GROUP BY s.workspace ORDER BY count DESC LIMIT 10
  `).all(...params) as { workspace: string; count: number }[];

  // Tool stats - need separate where clause for tool_calls table
  const toolJoin = 'FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id';
  const toolWhere = buildWhereClause(filters, 'tc.created_at');

  const toolStats = db.prepare(`
    SELECT count(*) as total_calls
    ${toolJoin} ${toolWhere.clause}
  `).get(...toolWhere.params) as { total_calls: number };

  const topTools = db.prepare(`
    SELECT tc.tool_name as tool, count(*) as count,
           round(1.0 * sum(CASE WHEN tc.success = 1 THEN 1 ELSE 0 END) / nullif(count(tc.success), 0), 2) as success_rate
    ${toolJoin} ${toolWhere.clause}
    GROUP BY tc.tool_name ORDER BY count DESC LIMIT 10
  `).all(...toolWhere.params) as { tool: string; count: number; success_rate: number }[];

  const totalSessions = sessionStats.total_sessions || 1;  // avoid div by zero
  const totalTurns = sessionStats.total_turns || 1;

  return {
    sessions: {
      total: sessionStats.total_sessions,
      avg_turns: Math.round(sessionStats.total_turns / totalSessions * 10) / 10,
      by_workspace: byWorkspace,
    },
    tokens: {
      total_input: tokenStats.total_input,
      total_output: tokenStats.total_output,
      total_cache_read: tokenStats.total_cache_read,
      total_cache_write: tokenStats.total_cache_write,
      avg_per_session: {
        input: Math.round(tokenStats.total_input / totalSessions),
        output: Math.round(tokenStats.total_output / totalSessions),
      },
      avg_per_turn: {
        input: Math.round(tokenStats.total_input / totalTurns),
        output: Math.round(tokenStats.total_output / totalTurns),
      },
    },
    tools: {
      total_calls: toolStats.total_calls,
      top: topTools,
    },
  };
}

export function summaryCli(db: Database.Database, options: AnalyticsCliOptions): void {
  const filters = parseAnalyticsOptions(options);
  const result = summaryQuery(db, filters);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  // Human-readable output
  console.log(chalk.bold('\nUsage Summary\n'));
  console.log(`  Sessions: ${result.sessions.total}  (avg ${result.sessions.avg_turns} turns/session)`);
  console.log(`  Tokens:   ${result.tokens.total_input.toLocaleString()} in / ${result.tokens.total_output.toLocaleString()} out`);
  console.log(`  Cache:    ${result.tokens.total_cache_read.toLocaleString()} read / ${result.tokens.total_cache_write.toLocaleString()} write`);
  console.log(`  Tools:    ${result.tools.total_calls} calls\n`);

  if (result.sessions.by_workspace.length > 0) {
    console.log(chalk.bold('  Top Workspaces:'));
    for (const w of result.sessions.by_workspace) {
      console.log(`    ${w.workspace}: ${w.count} sessions`);
    }
    console.log();
  }

  if (result.tools.top.length > 0) {
    console.log(chalk.bold('  Top Tools:'));
    for (const t of result.tools.top) {
      const rate = t.success_rate !== null ? ` (${Math.round(t.success_rate * 100)}% success)` : '';
      console.log(`    ${t.tool}: ${t.count}${rate}`);
    }
    console.log();
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands/analytics-summary.test.ts`
Expected: PASS

**Step 5: Wire into CLI and commit**

Add to `src/cli.ts`:

```typescript
import { summaryCli } from './commands/analytics-summary.ts';

const analytics = program
  .command('analytics')
  .description('Analyze Claude Code usage patterns.');

analytics
  .command('summary')
  .description('High-level usage summary over a time window.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    summaryCli(db, options);
    db.close();
  });
```

```bash
git add src/commands/analytics-summary.ts src/commands/analytics-summary.test.ts src/commands/analytics-common.ts src/commands/analytics-common.test.ts src/cli.ts
git commit -m "feat: add sap analytics summary command"
```

---

### Task 4: `sap analytics tools` command

**Files:**
- Create: `src/commands/analytics-tools.ts`
- Modify: `src/cli.ts`
- Test: `src/commands/analytics-tools.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, insertTurn, insertToolCall } from '../db.ts';
import { toolsQuery } from './analytics-tools.ts';

describe('toolsQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 3600000 });
    const t1 = insertTurn(db, {
      session_id: 's1', turn_number: 1, prompt_text: 'test',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 3, started_at: Date.now() - 3600000, ended_at: Date.now() - 3500000, duration_ms: 100000,
    });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu1', tool_name: 'Read', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3580000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu2', tool_name: 'Edit', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3570000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu3', tool_name: 'Edit', tool_input_summary: 'b.ts', success: 0, error_message: 'old_string not found', created_at: Date.now() - 3560000 });
  });

  it('returns per-tool breakdown', () => {
    const result = toolsQuery(db, {});
    expect(result.tools.length).toBeGreaterThanOrEqual(2);
    const edit = result.tools.find(t => t.tool === 'Edit');
    expect(edit?.count).toBe(2);
    expect(edit?.success_rate).toBe(0.5);
    expect(edit?.error_count).toBe(1);
  });

  it('returns tool sequences', () => {
    const result = toolsQuery(db, {});
    expect(result.sequences.length).toBeGreaterThan(0);
    // Read→Edit should be a sequence
    const readEdit = result.sequences.find(s => s.sequence[0] === 'Read' && s.sequence[1] === 'Edit');
    expect(readEdit).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands/analytics-tools.test.ts`
Expected: FAIL

**Step 3: Implement `src/commands/analytics-tools.ts`**

```typescript
import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { buildWhereClause, type FilterOptions, type AnalyticsCliOptions, parseAnalyticsOptions } from './analytics-common.ts';

export interface ToolsResult {
  tools: {
    tool: string;
    count: number;
    success_rate: number;
    error_count: number;
    top_errors: string[];
  }[];
  sequences: {
    sequence: string[];
    count: number;
  }[];
}

export function toolsQuery(db: Database.Database, filters: FilterOptions): ToolsResult {
  const { clause, params } = buildWhereClause(filters, 'tc.created_at');
  const joinBase = 'FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id';

  // Per-tool breakdown
  const tools = db.prepare(`
    SELECT tc.tool_name as tool,
           count(*) as count,
           round(1.0 * sum(CASE WHEN tc.success = 1 THEN 1 ELSE 0 END) / nullif(count(tc.success), 0), 2) as success_rate,
           sum(CASE WHEN tc.success = 0 THEN 1 ELSE 0 END) as error_count
    ${joinBase} ${clause}
    GROUP BY tc.tool_name ORDER BY count DESC
  `).all(...params) as { tool: string; count: number; success_rate: number; error_count: number }[];

  // Get top errors per tool
  const toolsWithErrors = tools.map(t => {
    const errors = db.prepare(`
      SELECT DISTINCT tc.error_message
      ${joinBase} ${clause ? clause + ' AND' : 'WHERE'} tc.tool_name = ? AND tc.error_message IS NOT NULL
      LIMIT 5
    `).all(...params, t.tool) as { error_message: string }[];

    return {
      ...t,
      top_errors: errors.map(e => e.error_message),
    };
  });

  // Tool sequences (bigram analysis: consecutive tool calls within a turn)
  const sequenceQuery = `
    SELECT tc1.tool_name as first, tc2.tool_name as second, count(*) as count
    FROM tool_calls tc1
    JOIN tool_calls tc2 ON tc1.turn_id = tc2.turn_id AND tc2.id = (
      SELECT min(id) FROM tool_calls WHERE turn_id = tc1.turn_id AND id > tc1.id
    )
    JOIN sessions s ON tc1.session_id = s.session_id
    ${clause}
    GROUP BY tc1.tool_name, tc2.tool_name
    ORDER BY count DESC
    LIMIT 20
  `;

  const sequences = db.prepare(sequenceQuery).all(...params) as { first: string; second: string; count: number }[];

  return {
    tools: toolsWithErrors,
    sequences: sequences.map(s => ({ sequence: [s.first, s.second], count: s.count })),
  };
}

export function toolsCli(db: Database.Database, options: AnalyticsCliOptions): void {
  const filters = parseAnalyticsOptions(options);
  const result = toolsQuery(db, filters);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold('\nTool Usage\n'));
  for (const t of result.tools) {
    const rate = t.success_rate !== null ? ` (${Math.round(t.success_rate * 100)}% success)` : '';
    console.log(`  ${t.tool}: ${t.count} calls${rate}`);
    if (t.top_errors.length > 0) {
      for (const e of t.top_errors) {
        console.log(`    ${chalk.red('error:')} ${e}`);
      }
    }
  }

  if (result.sequences.length > 0) {
    console.log(chalk.bold('\nCommon Sequences:'));
    for (const s of result.sequences.slice(0, 10)) {
      console.log(`  ${s.sequence.join(' → ')}: ${s.count}`);
    }
  }
  console.log();
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands/analytics-tools.test.ts`
Expected: PASS

**Step 5: Wire into CLI and commit**

```typescript
import { toolsCli } from './commands/analytics-tools.ts';

analytics
  .command('tools')
  .description('Per-tool usage breakdown with sequences.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    toolsCli(db, options);
    db.close();
  });
```

```bash
git add src/commands/analytics-tools.ts src/commands/analytics-tools.test.ts src/cli.ts
git commit -m "feat: add sap analytics tools command"
```

---

### Task 5: `sap analytics sessions` command

**Files:**
- Create: `src/commands/analytics-sessions.ts`
- Modify: `src/cli.ts`
- Test: `src/commands/analytics-sessions.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, insertTurn, insertToolCall } from '../db.ts';
import { sessionsAnalyticsQuery } from './analytics-sessions.ts';

describe('sessionsAnalyticsQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 3600000 });
    const t1 = insertTurn(db, {
      session_id: 's1', turn_number: 1, prompt_text: 'test',
      input_tokens: 5000, output_tokens: 1000, cache_read_tokens: 2000, cache_write_tokens: 500,
      model: null, tool_call_count: 2, started_at: Date.now() - 3600000, ended_at: Date.now() - 3500000, duration_ms: 100000,
    });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu1', tool_name: 'Read', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3580000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu2', tool_name: 'Bash', tool_input_summary: 'git commit -m "feat"', success: 1, error_message: null, created_at: Date.now() - 3560000 });
  });

  it('returns per-session metrics', () => {
    const result = sessionsAnalyticsQuery(db, {});
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].session_id).toBe('s1');
    expect(result.sessions[0].turns).toBe(1);
    expect(result.sessions[0].input_tokens).toBe(5000);
    expect(result.sessions[0].tool_calls).toBe(2);
  });

  it('detects commit outcome', () => {
    const result = sessionsAnalyticsQuery(db, {});
    expect(result.sessions[0].outcome.committed).toBe(true);
  });

  it('respects limit', () => {
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 1800000 });
    insertTurn(db, {
      session_id: 's2', turn_number: 1, prompt_text: 'test2',
      input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 0, started_at: Date.now() - 1800000, ended_at: Date.now() - 1700000, duration_ms: 100000,
    });

    const result = sessionsAnalyticsQuery(db, {}, 1);
    expect(result.sessions).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands/analytics-sessions.test.ts`
Expected: FAIL

**Step 3: Implement `src/commands/analytics-sessions.ts`**

```typescript
import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { buildWhereClause, type FilterOptions, type AnalyticsCliOptions, parseAnalyticsOptions } from './analytics-common.ts';

interface SessionAnalytics {
  session_id: string;
  workspace: string;
  started_at: number;
  turns: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  error_count: number;
  error_rate: number;
  outcome: {
    committed: boolean;
    tests_passed: boolean | null;
  };
}

export interface SessionsAnalyticsResult {
  sessions: SessionAnalytics[];
}

export function sessionsAnalyticsQuery(
  db: Database.Database,
  filters: FilterOptions,
  limit: number = 20,
): SessionsAnalyticsResult {
  const { clause, params } = buildWhereClause(filters, 't.started_at');
  const joinBase = 'FROM turns t JOIN sessions s ON t.session_id = s.session_id';

  const rows = db.prepare(`
    SELECT s.session_id, s.workspace, s.started_at,
           count(DISTINCT t.id) as turns,
           coalesce(sum(t.input_tokens), 0) as input_tokens,
           coalesce(sum(t.output_tokens), 0) as output_tokens,
           coalesce(sum(t.cache_read_tokens), 0) as cache_read_tokens
    ${joinBase} ${clause}
    GROUP BY s.session_id
    ORDER BY s.started_at DESC
    LIMIT ?
  `).all(...params, limit) as {
    session_id: string; workspace: string; started_at: number;
    turns: number; input_tokens: number; output_tokens: number; cache_read_tokens: number;
  }[];

  const sessions: SessionAnalytics[] = rows.map(row => {
    // Get tool call stats for this session
    const toolStats = db.prepare(`
      SELECT count(*) as total,
             sum(CASE WHEN success = 0 THEN 1 ELSE 0 END) as errors
      FROM tool_calls WHERE session_id = ?
    `).get(row.session_id) as { total: number; errors: number };

    // Check for commit outcome
    const hasCommit = db.prepare(`
      SELECT 1 FROM tool_calls
      WHERE session_id = ? AND tool_name = 'Bash' AND tool_input_summary LIKE 'git commit%' AND success = 1
      LIMIT 1
    `).get(row.session_id);

    // Check for test pass outcome
    const testRuns = db.prepare(`
      SELECT success FROM tool_calls
      WHERE session_id = ? AND tool_name = 'Bash'
        AND (tool_input_summary LIKE '%test%' OR tool_input_summary LIKE '%vitest%' OR tool_input_summary LIKE '%jest%' OR tool_input_summary LIKE '%pytest%')
      ORDER BY created_at DESC LIMIT 1
    `).get(row.session_id) as { success: number } | undefined;

    return {
      session_id: row.session_id,
      workspace: row.workspace,
      started_at: row.started_at,
      turns: row.turns,
      tool_calls: toolStats.total,
      input_tokens: row.input_tokens,
      output_tokens: row.output_tokens,
      cache_read_tokens: row.cache_read_tokens,
      error_count: toolStats.errors,
      error_rate: toolStats.total > 0 ? Math.round(1000 * toolStats.errors / toolStats.total) / 1000 : 0,
      outcome: {
        committed: !!hasCommit,
        tests_passed: testRuns ? testRuns.success === 1 : null,
      },
    };
  });

  return { sessions };
}

export function sessionsAnalyticsCli(db: Database.Database, options: AnalyticsCliOptions & { limit?: string }): void {
  const filters = parseAnalyticsOptions(options);
  const limit = options.limit ? parseInt(options.limit, 10) : 20;
  const result = sessionsAnalyticsQuery(db, filters, limit);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold('\nSession Analytics\n'));
  for (const s of result.sessions) {
    const outcome = s.outcome.committed ? chalk.green('committed') : chalk.dim('no commit');
    console.log(`  ${s.session_id.slice(0, 8)}  ${s.workspace}  ${s.turns} turns  ${s.tool_calls} tools  ${s.input_tokens.toLocaleString()} in  ${outcome}`);
    if (s.error_count > 0) {
      console.log(`    ${chalk.yellow(`${s.error_count} errors (${Math.round(s.error_rate * 100)}%)`)}`);
    }
  }
  console.log();
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands/analytics-sessions.test.ts`
Expected: PASS

**Step 5: Wire into CLI and commit**

```typescript
import { sessionsAnalyticsCli } from './commands/analytics-sessions.ts';

analytics
  .command('sessions')
  .description('Per-session metrics for comparing efficiency.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--limit <n>', 'Number of sessions', '20')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    sessionsAnalyticsCli(db, options);
    db.close();
  });
```

```bash
git add src/commands/analytics-sessions.ts src/commands/analytics-sessions.test.ts src/cli.ts
git commit -m "feat: add sap analytics sessions command"
```

---

### Task 6: `sap analytics patterns` command

**Files:**
- Create: `src/commands/analytics-patterns.ts`
- Modify: `src/cli.ts`
- Test: `src/commands/analytics-patterns.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, insertTurn, insertToolCall } from '../db.ts';
import { patternsQuery } from './analytics-patterns.ts';

describe('patternsQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    // Session with Edit retry pattern
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 3600000 });
    const t1 = insertTurn(db, {
      session_id: 's1', turn_number: 1, prompt_text: 'edit file',
      input_tokens: 5000, output_tokens: 1000, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 3, started_at: Date.now() - 3600000, ended_at: Date.now() - 3500000, duration_ms: 100000,
    });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu1', tool_name: 'Edit', tool_input_summary: 'a.ts', success: 0, error_message: 'old_string not found', created_at: Date.now() - 3580000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu2', tool_name: 'Read', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3570000 });
    insertToolCall(db, { session_id: 's1', turn_id: t1, tool_use_id: 'tu3', tool_name: 'Edit', tool_input_summary: 'a.ts', success: 1, error_message: null, created_at: Date.now() - 3560000 });

    // High-token outlier session
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() - 1800000 });
    const t2 = insertTurn(db, {
      session_id: 's2', turn_number: 1, prompt_text: 'huge task',
      input_tokens: 500000, output_tokens: 100000, cache_read_tokens: 0, cache_write_tokens: 0,
      model: null, tool_call_count: 0, started_at: Date.now() - 1800000, ended_at: Date.now() - 1700000, duration_ms: 100000,
    });
  });

  it('detects edit retry anti-pattern', () => {
    const result = patternsQuery(db, {});
    const editRetry = result.anti_patterns.find(p => p.pattern === 'edit-retry');
    expect(editRetry).toBeDefined();
    expect(editRetry!.frequency).toBeGreaterThan(0);
  });

  it('identifies outlier sessions', () => {
    const result = patternsQuery(db, {});
    expect(result.outlier_sessions.length).toBeGreaterThan(0);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands/analytics-patterns.test.ts`
Expected: FAIL

**Step 3: Implement `src/commands/analytics-patterns.ts`**

```typescript
import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { buildWhereClause, type FilterOptions, type AnalyticsCliOptions, parseAnalyticsOptions } from './analytics-common.ts';

export interface PatternsResult {
  anti_patterns: {
    pattern: string;
    description: string;
    frequency: number;
    sessions_affected: number;
  }[];
  outlier_sessions: {
    session_id: string;
    workspace: string;
    reason: string;
    value: number;
  }[];
}

export function patternsQuery(db: Database.Database, filters: FilterOptions): PatternsResult {
  const { clause, params } = buildWhereClause(filters, 'tc.created_at');
  const joinBase = 'FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id';

  const anti_patterns: PatternsResult['anti_patterns'] = [];

  // Edit retry pattern: Edit failures (success=0)
  const editRetries = db.prepare(`
    SELECT count(*) as frequency, count(DISTINCT tc.session_id) as sessions_affected
    ${joinBase} ${clause ? clause + ' AND' : 'WHERE'} tc.tool_name = 'Edit' AND tc.success = 0
  `).get(...params) as { frequency: number; sessions_affected: number };

  if (editRetries.frequency > 0) {
    anti_patterns.push({
      pattern: 'edit-retry',
      description: 'Edit failures followed by retry (old_string mismatch)',
      frequency: editRetries.frequency,
      sessions_affected: editRetries.sessions_affected,
    });
  }

  // Bash error pattern: Bash commands that fail
  const bashErrors = db.prepare(`
    SELECT count(*) as frequency, count(DISTINCT tc.session_id) as sessions_affected
    ${joinBase} ${clause ? clause + ' AND' : 'WHERE'} tc.tool_name = 'Bash' AND tc.success = 0
  `).get(...params) as { frequency: number; sessions_affected: number };

  if (bashErrors.frequency > 0) {
    anti_patterns.push({
      pattern: 'bash-error',
      description: 'Bash commands that exit non-zero',
      frequency: bashErrors.frequency,
      sessions_affected: bashErrors.sessions_affected,
    });
  }

  // Outlier sessions: token usage significantly above average
  const turnWhere = buildWhereClause(filters, 't.started_at');
  const turnJoin = 'FROM turns t JOIN sessions s ON t.session_id = s.session_id';

  const avgTokens = db.prepare(`
    SELECT avg(session_input) as avg_input FROM (
      SELECT sum(t.input_tokens) as session_input
      ${turnJoin} ${turnWhere.clause}
      GROUP BY t.session_id
    )
  `).get(...turnWhere.params) as { avg_input: number | null };

  const outlier_sessions: PatternsResult['outlier_sessions'] = [];

  if (avgTokens.avg_input && avgTokens.avg_input > 0) {
    const threshold = avgTokens.avg_input * 3;
    const outliers = db.prepare(`
      SELECT s.session_id, s.workspace, sum(t.input_tokens) as total_input
      ${turnJoin} ${turnWhere.clause}
      GROUP BY s.session_id
      HAVING total_input > ?
      ORDER BY total_input DESC
      LIMIT 10
    `).all(...turnWhere.params, threshold) as { session_id: string; workspace: string; total_input: number }[];

    for (const o of outliers) {
      outlier_sessions.push({
        session_id: o.session_id,
        workspace: o.workspace,
        reason: `Token usage ${Math.round(o.total_input / avgTokens.avg_input)}x average`,
        value: o.total_input,
      });
    }
  }

  return { anti_patterns, outlier_sessions };
}

export function patternsCli(db: Database.Database, options: AnalyticsCliOptions): void {
  const filters = parseAnalyticsOptions(options);
  const result = patternsQuery(db, filters);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  console.log(chalk.bold('\nAnti-Patterns\n'));
  if (result.anti_patterns.length === 0) {
    console.log('  None detected.');
  }
  for (const p of result.anti_patterns) {
    console.log(`  ${chalk.yellow(p.pattern)}: ${p.description}`);
    console.log(`    ${p.frequency} occurrences across ${p.sessions_affected} sessions`);
  }

  console.log(chalk.bold('\nOutlier Sessions\n'));
  if (result.outlier_sessions.length === 0) {
    console.log('  None detected.');
  }
  for (const o of result.outlier_sessions) {
    console.log(`  ${o.session_id.slice(0, 8)}  ${o.workspace}  ${o.reason}`);
  }
  console.log();
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands/analytics-patterns.test.ts`
Expected: PASS

**Step 5: Wire into CLI and commit**

```typescript
import { patternsCli } from './commands/analytics-patterns.ts';

analytics
  .command('patterns')
  .description('Detect workflow patterns and anti-patterns.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    patternsCli(db, options);
    db.close();
  });
```

```bash
git add src/commands/analytics-patterns.ts src/commands/analytics-patterns.test.ts src/cli.ts
git commit -m "feat: add sap analytics patterns command"
```

---

### Task 7: Final integration test

**Files:**
- Create: `src/analytics-integration.test.ts`

**Step 1: Write an end-to-end test that covers ingest → query → analytics**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type Database from 'better-sqlite3';
import { openDb, getSessionTurns, getTurnToolCalls } from './db.ts';
import { recordEvent } from './commands/record.ts';
import { ingestSession } from './commands/ingest.ts';
import { executeQuery } from './commands/query.ts';
import { summaryQuery } from './commands/analytics-summary.ts';
import type { HookPayload } from './types.ts';

describe('analytics integration', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = openDb(':memory:');
    tmpDir = mkdtempSync(join(tmpdir(), 'sap-integration-'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it('full lifecycle: record → ingest → query → analytics', () => {
    // 1. Record a session via hooks
    const transcriptPath = join(tmpDir, 'transcript.jsonl');
    const payload: HookPayload = {
      session_id: 'int-1',
      cwd: tmpDir,
      transcript_path: transcriptPath,
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
      source: 'startup',
    };

    recordEvent(db, 'session-start', payload);
    recordEvent(db, 'user-prompt', { ...payload, prompt: 'fix the bug' });
    recordEvent(db, 'tool-use', { ...payload, tool_name: 'Read', tool_input: { file_path: '/src/app.ts' } });
    recordEvent(db, 'tool-use', { ...payload, tool_name: 'Edit', tool_input: { file_path: '/src/app.ts' } });
    recordEvent(db, 'turn-complete', payload);
    recordEvent(db, 'session-end', { ...payload, reason: 'done' });

    // 2. Write a transcript file
    const transcriptLines = [
      { type: 'user', sessionId: 'int-1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1', message: { role: 'user', content: 'fix the bug' } },
      { type: 'assistant', sessionId: 'int-1', timestamp: '2026-02-14T10:00:05.000Z', uuid: 'u2', message: {
        role: 'assistant', model: 'claude-sonnet-4-5-20250929',
        content: [
          { type: 'text', text: 'Let me read the file.' },
          { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/src/app.ts' } },
        ],
        usage: { input_tokens: 5000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 },
      }},
      { type: 'user', sessionId: 'int-1', timestamp: '2026-02-14T10:00:06.000Z', uuid: 'u3', message: {
        role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file contents' }],
      }},
      { type: 'assistant', sessionId: 'int-1', timestamp: '2026-02-14T10:00:10.000Z', uuid: 'u4', message: {
        role: 'assistant', model: 'claude-sonnet-4-5-20250929',
        content: [
          { type: 'tool_use', id: 'toolu_2', name: 'Edit', input: { file_path: '/src/app.ts', old_string: 'bug', new_string: 'fix' } },
        ],
        usage: { input_tokens: 8000, output_tokens: 100, cache_read_input_tokens: 5000, cache_creation_input_tokens: 200 },
      }},
      { type: 'user', sessionId: 'int-1', timestamp: '2026-02-14T10:00:11.000Z', uuid: 'u5', message: {
        role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_2', content: 'ok' }],
      }},
      { type: 'assistant', sessionId: 'int-1', timestamp: '2026-02-14T10:00:15.000Z', uuid: 'u6', message: {
        role: 'assistant', model: 'claude-sonnet-4-5-20250929',
        content: [{ type: 'text', text: 'Fixed the bug.' }],
        usage: { input_tokens: 10000, output_tokens: 50, cache_read_input_tokens: 8000, cache_creation_input_tokens: 100 },
      }},
    ];
    writeFileSync(transcriptPath, transcriptLines.map(l => JSON.stringify(l)).join('\n'));

    // 3. Ingest
    const ingestResult = ingestSession(db, 'int-1');
    expect(ingestResult.turns).toBe(1);
    expect(ingestResult.toolCalls).toBe(2);

    // 4. Verify turns and tool_calls
    const turns = getSessionTurns(db, 'int-1');
    expect(turns).toHaveLength(1);
    expect(turns[0].prompt_text).toBe('fix the bug');
    expect(turns[0].input_tokens).toBe(23000);

    const toolCalls = getTurnToolCalls(db, turns[0].id);
    expect(toolCalls).toHaveLength(2);
    expect(toolCalls[0].tool_name).toBe('Read');
    expect(toolCalls[1].tool_name).toBe('Edit');

    // 5. Raw query works
    const queryResult = executeQuery(db, 'SELECT count(*) as n FROM turns');
    expect(queryResult.rows[0].n).toBe(1);

    // 6. Analytics summary works
    const summary = summaryQuery(db, {});
    expect(summary.sessions.total).toBe(1);
    expect(summary.tokens.total_input).toBe(23000);
    expect(summary.tools.total_calls).toBe(2);
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run src/analytics-integration.test.ts`
Expected: PASS (if all previous phases are implemented correctly)

**Step 3: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 4: Commit**

```bash
git add src/analytics-integration.test.ts
git commit -m "test: add analytics end-to-end integration test"
```
