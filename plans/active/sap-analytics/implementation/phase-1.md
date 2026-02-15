# Phase 1: Schema & Real-Time Enrichment

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Add the analytics tables (`turns`, `tool_calls`) and `ingested_at` column to `sessions`, plus store prompt text in real-time `user-prompt` events.

**Architecture:** Extend the existing schema string in `db.ts` with new `CREATE TABLE IF NOT EXISTS` statements and an `ALTER TABLE` migration for the existing `sessions` table. Modify the `user-prompt` event handler to store prompt text in the event data JSON.

**Tech Stack:** TypeScript, better-sqlite3, vitest

**Related:** [../design/schema.md](../design/schema.md), [../design/overview.md](../design/overview.md), [./phase-2.md](./phase-2.md)

---

### Task 1: Add `ingested_at` column to sessions table

**Files:**
- Modify: `src/db.ts` (schema string, ~line 9-43)
- Modify: `src/types.ts` (Session interface, ~line 38-49)
- Test: `src/db.test.ts`

**Step 1: Write the failing test**

In `src/db.test.ts`, add a test that checks the `ingested_at` column exists on sessions:

```typescript
it('sessions table has ingested_at column', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(sessions)").all() as { name: string }[];
  const names = cols.map(c => c.name);
  expect(names).toContain('ingested_at');
  db.close();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL — `ingested_at` not in column list

**Step 3: Add the column to the schema**

In `src/db.ts`, after the existing `SCHEMA` string (which uses `CREATE TABLE IF NOT EXISTS`), we can't use `ALTER TABLE IF NOT EXISTS` in SQLite. Instead, add a migration approach after `db.exec(SCHEMA)`:

In `src/db.ts`, add `ingested_at` to the sessions CREATE TABLE:

```typescript
// In the SCHEMA string, add to sessions table definition:
//   ingested_at      INTEGER
// after the last_tool_detail line
```

Update the sessions table in the SCHEMA constant — add `ingested_at INTEGER` after `last_tool_detail TEXT`:

```sql
CREATE TABLE IF NOT EXISTS sessions (
  session_id       TEXT PRIMARY KEY,
  workspace        TEXT NOT NULL,
  cwd              TEXT NOT NULL,
  transcript_path  TEXT,
  state            TEXT NOT NULL DEFAULT 'active',
  started_at       INTEGER NOT NULL,
  ended_at         INTEGER,
  last_event_at    INTEGER NOT NULL,
  last_tool        TEXT,
  last_tool_detail TEXT,
  ingested_at      INTEGER
);
```

**Important:** Since `CREATE TABLE IF NOT EXISTS` won't add columns to an existing table, also add a migration after `db.exec(SCHEMA)` in `openDb()`:

```typescript
// After db.exec(SCHEMA), add migration for existing databases:
try {
  db.exec('ALTER TABLE sessions ADD COLUMN ingested_at INTEGER');
} catch {
  // Column already exists — ignore
}
```

In `src/types.ts`, add to Session interface:

```typescript
ingested_at: number | null;
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db.ts src/types.ts src/db.test.ts
git commit -m "feat: add ingested_at column to sessions table"
```

---

### Task 2: Create `turns` table

**Files:**
- Modify: `src/db.ts` (schema string)
- Modify: `src/types.ts` (new Turn interface)
- Test: `src/db.test.ts`

**Step 1: Write the failing test**

```typescript
it('creates turns table with expected columns', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(turns)").all() as { name: string }[];
  const names = cols.map(c => c.name);
  expect(names).toEqual(expect.arrayContaining([
    'id', 'session_id', 'turn_number', 'prompt_text',
    'input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens',
    'model', 'tool_call_count', 'started_at', 'ended_at', 'duration_ms',
  ]));
  db.close();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL — turns table doesn't exist

**Step 3: Add turns table to SCHEMA**

In `src/db.ts`, append to the SCHEMA string:

```sql
CREATE TABLE IF NOT EXISTS turns (
  id                       INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id               TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_number              INTEGER NOT NULL,
  prompt_text              TEXT,
  input_tokens             INTEGER,
  output_tokens            INTEGER,
  cache_read_tokens        INTEGER,
  cache_write_tokens       INTEGER,
  model                    TEXT,
  tool_call_count          INTEGER NOT NULL DEFAULT 0,
  started_at               INTEGER,
  ended_at                 INTEGER,
  duration_ms              INTEGER
);

CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_started ON turns(started_at);
```

In `src/types.ts`, add:

```typescript
export interface Turn {
  id: number;
  session_id: string;
  turn_number: number;
  prompt_text: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  model: string | null;
  tool_call_count: number;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db.ts src/types.ts src/db.test.ts
git commit -m "feat: add turns table for analytics"
```

---

### Task 3: Create `tool_calls` table

**Files:**
- Modify: `src/db.ts` (schema string)
- Modify: `src/types.ts` (new ToolCall interface)
- Test: `src/db.test.ts`

**Step 1: Write the failing test**

```typescript
it('creates tool_calls table with expected columns', () => {
  const db = openDb(':memory:');
  const cols = db.prepare("PRAGMA table_info(tool_calls)").all() as { name: string }[];
  const names = cols.map(c => c.name);
  expect(names).toEqual(expect.arrayContaining([
    'id', 'session_id', 'turn_id', 'tool_use_id',
    'tool_name', 'tool_input_summary', 'success', 'error_message', 'created_at',
  ]));
  db.close();
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL — tool_calls table doesn't exist

**Step 3: Add tool_calls table to SCHEMA**

In `src/db.ts`, append to the SCHEMA string:

```sql
CREATE TABLE IF NOT EXISTS tool_calls (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id          TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  turn_id             INTEGER NOT NULL REFERENCES turns(id) ON DELETE CASCADE,
  tool_use_id         TEXT,
  tool_name           TEXT NOT NULL,
  tool_input_summary  TEXT,
  success             INTEGER,
  error_message       TEXT,
  created_at          INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_turn ON tool_calls(turn_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_name ON tool_calls(tool_name);
```

In `src/types.ts`, add:

```typescript
export interface ToolCall {
  id: number;
  session_id: string;
  turn_id: number;
  tool_use_id: string | null;
  tool_name: string;
  tool_input_summary: string | null;
  success: number | null;
  error_message: string | null;
  created_at: number;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db.ts src/types.ts src/db.test.ts
git commit -m "feat: add tool_calls table for analytics"
```

---

### Task 4: Add DB helper functions for turns and tool_calls

**Files:**
- Modify: `src/db.ts`
- Test: `src/db.test.ts`

**Step 1: Write failing tests for insert and query functions**

```typescript
describe('turns operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: 1000,
    });
  });

  it('inserts and retrieves turns for a session', () => {
    insertTurn(db, {
      session_id: 'sess-1',
      turn_number: 1,
      prompt_text: 'fix the bug',
      input_tokens: 5000,
      output_tokens: 1200,
      cache_read_tokens: 3000,
      cache_write_tokens: 500,
      model: 'claude-sonnet-4-5-20250929',
      tool_call_count: 3,
      started_at: 1000,
      ended_at: 1500,
      duration_ms: 500,
    });

    const turns = getSessionTurns(db, 'sess-1');
    expect(turns).toHaveLength(1);
    expect(turns[0].prompt_text).toBe('fix the bug');
    expect(turns[0].input_tokens).toBe(5000);
  });

  it('deletes turns when session is deleted (cascade)', () => {
    insertTurn(db, {
      session_id: 'sess-1',
      turn_number: 1,
      prompt_text: 'hello',
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      model: null,
      tool_call_count: 0,
      started_at: 1000,
      ended_at: 1100,
      duration_ms: 100,
    });

    db.prepare('DELETE FROM sessions WHERE session_id = ?').run('sess-1');
    const turns = getSessionTurns(db, 'sess-1');
    expect(turns).toHaveLength(0);
  });
});

describe('tool_calls operations', () => {
  let db: Database.Database;
  let turnId: number;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: 1000,
    });
    turnId = insertTurn(db, {
      session_id: 'sess-1',
      turn_number: 1,
      prompt_text: 'test',
      input_tokens: null,
      output_tokens: null,
      cache_read_tokens: null,
      cache_write_tokens: null,
      model: null,
      tool_call_count: 1,
      started_at: 1000,
      ended_at: 1100,
      duration_ms: 100,
    });
  });

  it('inserts and retrieves tool calls for a turn', () => {
    insertToolCall(db, {
      session_id: 'sess-1',
      turn_id: turnId,
      tool_use_id: 'toolu_123',
      tool_name: 'Edit',
      tool_input_summary: 'app.ts',
      success: 1,
      error_message: null,
      created_at: 1050,
    });

    const calls = getTurnToolCalls(db, turnId);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('Edit');
    expect(calls[0].success).toBe(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL — `insertTurn`, `getSessionTurns`, `insertToolCall`, `getTurnToolCalls` not defined

**Step 3: Implement the functions in `src/db.ts`**

```typescript
// --- Turn operations ---

interface InsertTurnParams {
  session_id: string;
  turn_number: number;
  prompt_text: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  model: string | null;
  tool_call_count: number;
  started_at: number | null;
  ended_at: number | null;
  duration_ms: number | null;
}

export function insertTurn(db: Database.Database, params: InsertTurnParams): number {
  const result = db.prepare(`
    INSERT INTO turns (session_id, turn_number, prompt_text, input_tokens, output_tokens,
      cache_read_tokens, cache_write_tokens, model, tool_call_count, started_at, ended_at, duration_ms)
    VALUES (@session_id, @turn_number, @prompt_text, @input_tokens, @output_tokens,
      @cache_read_tokens, @cache_write_tokens, @model, @tool_call_count, @started_at, @ended_at, @duration_ms)
  `).run(params);
  return Number(result.lastInsertRowid);
}

export function getSessionTurns(db: Database.Database, sessionId: string): Turn[] {
  return db.prepare(
    'SELECT * FROM turns WHERE session_id = ? ORDER BY turn_number ASC'
  ).all(sessionId) as Turn[];
}

// --- Tool call operations ---

interface InsertToolCallParams {
  session_id: string;
  turn_id: number;
  tool_use_id: string | null;
  tool_name: string;
  tool_input_summary: string | null;
  success: number | null;
  error_message: string | null;
  created_at: number;
}

export function insertToolCall(db: Database.Database, params: InsertToolCallParams): void {
  db.prepare(`
    INSERT INTO tool_calls (session_id, turn_id, tool_use_id, tool_name,
      tool_input_summary, success, error_message, created_at)
    VALUES (@session_id, @turn_id, @tool_use_id, @tool_name,
      @tool_input_summary, @success, @error_message, @created_at)
  `).run(params);
}

export function getTurnToolCalls(db: Database.Database, turnId: number): ToolCall[] {
  return db.prepare(
    'SELECT * FROM tool_calls WHERE turn_id = ? ORDER BY created_at ASC'
  ).all(turnId) as ToolCall[];
}
```

Note: `insertTurn` returns the new row ID (needed for linking tool_calls). Import `Turn` and `ToolCall` types from `types.ts`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "feat: add DB helpers for turns and tool_calls"
```

---

### Task 5: Store prompt text in user-prompt events

**Files:**
- Modify: `src/commands/record.ts` (~line 29, handleStateChange call for user-prompt)
- Test: `src/commands/record.test.ts`

**Step 1: Write the failing test**

In `src/commands/record.test.ts`, add to the `user-prompt` describe block:

```typescript
it('stores prompt text in event data', () => {
  recordEvent(db, 'session-start', payload({ source: 'startup' }));
  recordEvent(db, 'user-prompt', payload({ prompt: 'fix the login bug' }));

  const events = getSessionEvents(db, 'sess-1');
  const promptEvent = events.find(e => e.event_type === 'user-prompt');
  expect(promptEvent).toBeDefined();
  const data = JSON.parse(promptEvent!.data!);
  expect(data.prompt).toBe('fix the login bug');
});

it('handles user-prompt without prompt text', () => {
  recordEvent(db, 'session-start', payload({ source: 'startup' }));
  recordEvent(db, 'user-prompt', payload());

  const events = getSessionEvents(db, 'sess-1');
  const promptEvent = events.find(e => e.event_type === 'user-prompt');
  expect(promptEvent).toBeDefined();
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands/record.test.ts`
Expected: FAIL — event data is null for user-prompt (current `handleStateChange` only stores `reason`)

**Step 3: Modify user-prompt handling to store prompt text**

In `src/commands/record.ts`, the `user-prompt` case currently calls generic `handleStateChange`. We need to either:

(a) Add prompt-specific handling in `handleStateChange`, or
(b) Add a dedicated handler.

Option (a) is simpler. Modify `handleStateChange` to also check for `data.prompt`:

```typescript
function handleStateChange(
  db: Database.Database,
  data: HookPayload,
  eventType: EventType,
  newState: SessionState,
  now: number,
): void {
  const session = getSession(db, data.session_id);
  if (!session) return;
  if (session.state === 'stopped') return;

  updateSessionState(db, data.session_id, newState, now);

  // Build event data from available payload fields
  let eventData: string | null = null;
  if (data.reason) {
    eventData = JSON.stringify({ reason: data.reason });
  } else if (data.prompt) {
    eventData = JSON.stringify({ prompt: data.prompt });
  }

  insertEvent(db, {
    session_id: data.session_id,
    event_type: eventType,
    data: eventData,
    created_at: now,
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands/record.test.ts`
Expected: PASS (all existing tests should still pass too)

**Step 5: Run full test suite to verify no regressions**

Run: `npx vitest run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add src/commands/record.ts src/commands/record.test.ts
git commit -m "feat: store prompt text in user-prompt events"
```
