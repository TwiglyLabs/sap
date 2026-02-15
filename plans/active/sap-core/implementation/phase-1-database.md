# Phase 1: Database Layer

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Build the SQLite persistence layer — schema creation, session CRUD, event logging, workspace caching.

**Architecture:** Single `db.ts` module exposes a typed API over better-sqlite3. All functions take an explicit `Database` instance (dependency injection for testability). In-memory databases for tests.

**Tech Stack:** better-sqlite3 (WAL mode), vitest

**Related:** [../design/approach.md](../design/approach.md) (schema section), [setup.md](./setup.md) (prerequisite), [phase-2-workspace.md](./phase-2-workspace.md) (next)

---

### Task 1: Write failing test for database initialization

**Files:**
- Create: `src/db.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { openDb } from './db.ts';

describe('openDb', () => {
  it('creates tables in a new database', () => {
    const db = openDb(':memory:');
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map(t => t.name);
    expect(names).toContain('sessions');
    expect(names).toContain('events');
    expect(names).toContain('workspaces');
    db.close();
  });

  it('enables WAL mode on file-based database', () => {
    const tmpPath = `/tmp/sap-test-${Date.now()}.db`;
    const db = openDb(tmpPath);
    const result = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    expect(result.journal_mode).toBe('wal');
    db.close();
    // Clean up
    const { unlinkSync } = require('fs');
    try { unlinkSync(tmpPath); unlinkSync(tmpPath + '-wal'); unlinkSync(tmpPath + '-shm'); } catch {}
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL — `Cannot find module './db.ts'`

---

### Task 2: Implement openDb

**Files:**
- Create: `src/db.ts`

**Step 1: Write minimal implementation**

```typescript
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

export const DEFAULT_DB_PATH = join(homedir(), '.sap', 'sap.db');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  cwd         TEXT PRIMARY KEY,
  repo_name   TEXT NOT NULL,
  branch      TEXT NOT NULL,
  workspace   TEXT NOT NULL,
  resolved_at INTEGER NOT NULL
);

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
  last_tool_detail TEXT
);

CREATE TABLE IF NOT EXISTS events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id  TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
  event_type  TEXT NOT NULL,
  data        TEXT,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_workspace ON sessions(workspace);
CREATE INDEX IF NOT EXISTS idx_sessions_state ON sessions(state);
CREATE INDEX IF NOT EXISTS idx_events_session ON events(session_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(event_type);
`;

export function openDb(path: string = DEFAULT_DB_PATH): Database.Database {
  if (path !== ':memory:') {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/db.test.ts`
Expected: PASS (2 tests)

**Step 3: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "feat: add database initialization with schema"
```

---

### Task 3: Write failing tests for session operations

**Files:**
- Modify: `src/db.test.ts`

**Step 1: Add session operation tests**

Append to `src/db.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDb, insertSession, getSession, updateSessionState, getActiveSessions } from './db.ts';
import type { SessionState } from './types.ts';

describe('session operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('inserts and retrieves a session', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: '/tmp/transcript.jsonl',
      started_at: 1000,
    });

    const session = getSession(db, 'sess-1');
    expect(session).not.toBeNull();
    expect(session!.session_id).toBe('sess-1');
    expect(session!.workspace).toBe('myrepo:main');
    expect(session!.state).toBe('active');
    expect(session!.started_at).toBe(1000);
    expect(session!.last_event_at).toBe(1000);
  });

  it('updates session state', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: null,
      started_at: 1000,
    });

    updateSessionState(db, 'sess-1', 'attention', 2000);
    const session = getSession(db, 'sess-1');
    expect(session!.state).toBe('attention');
    expect(session!.last_event_at).toBe(2000);
  });

  it('updates session state with tool info', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: null,
      started_at: 1000,
    });

    updateSessionState(db, 'sess-1', 'active', 2000, { tool: 'Edit', detail: 'app.ts' });
    const session = getSession(db, 'sess-1');
    expect(session!.last_tool).toBe('Edit');
    expect(session!.last_tool_detail).toBe('app.ts');
  });

  it('sets ended_at when state is stopped', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: null,
      started_at: 1000,
    });

    updateSessionState(db, 'sess-1', 'stopped', 3000);
    const session = getSession(db, 'sess-1');
    expect(session!.state).toBe('stopped');
    expect(session!.ended_at).toBe(3000);
  });

  it('returns active and non-stopped sessions', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'repo-a:main',
      cwd: '/a',
      transcript_path: null,
      started_at: 1000,
    });
    insertSession(db, {
      session_id: 'sess-2',
      workspace: 'repo-b:main',
      cwd: '/b',
      transcript_path: null,
      started_at: 2000,
    });
    updateSessionState(db, 'sess-1', 'stopped', 3000);

    const active = getActiveSessions(db);
    expect(active).toHaveLength(1);
    expect(active[0].session_id).toBe('sess-2');
  });

  it('filters sessions by workspace', () => {
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'repo-a:main',
      cwd: '/a',
      transcript_path: null,
      started_at: 1000,
    });
    insertSession(db, {
      session_id: 'sess-2',
      workspace: 'repo-b:dev',
      cwd: '/b',
      transcript_path: null,
      started_at: 2000,
    });

    const filtered = getActiveSessions(db, 'repo-a:main');
    expect(filtered).toHaveLength(1);
    expect(filtered[0].session_id).toBe('sess-1');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL — `insertSession is not a function`

---

### Task 4: Implement session operations

**Files:**
- Modify: `src/db.ts`

**Step 1: Add session functions to db.ts**

Append to `src/db.ts`:

```typescript
import type { Session, SessionState } from './types.ts';

interface InsertSessionParams {
  session_id: string;
  workspace: string;
  cwd: string;
  transcript_path: string | null;
  started_at: number;
}

export function insertSession(db: Database.Database, params: InsertSessionParams): void {
  db.prepare(`
    INSERT INTO sessions (session_id, workspace, cwd, transcript_path, state, started_at, last_event_at)
    VALUES (@session_id, @workspace, @cwd, @transcript_path, 'active', @started_at, @started_at)
  `).run(params);
}

export function getSession(db: Database.Database, sessionId: string): Session | null {
  return db.prepare('SELECT * FROM sessions WHERE session_id = ?').get(sessionId) as Session | null;
}

export function updateSessionState(
  db: Database.Database,
  sessionId: string,
  state: SessionState,
  eventTime: number,
  tool?: { tool: string; detail: string | null },
): void {
  if (state === 'stopped') {
    db.prepare(`
      UPDATE sessions SET state = ?, last_event_at = ?, ended_at = ? WHERE session_id = ?
    `).run(state, eventTime, eventTime, sessionId);
  } else if (tool) {
    db.prepare(`
      UPDATE sessions SET state = ?, last_event_at = ?, last_tool = ?, last_tool_detail = ?
      WHERE session_id = ?
    `).run(state, eventTime, tool.tool, tool.detail, sessionId);
  } else {
    db.prepare(`
      UPDATE sessions SET state = ?, last_event_at = ? WHERE session_id = ?
    `).run(state, eventTime, sessionId);
  }
}

export function getActiveSessions(db: Database.Database, workspace?: string): Session[] {
  if (workspace) {
    return db.prepare(
      "SELECT * FROM sessions WHERE state != 'stopped' AND workspace = ? ORDER BY last_event_at DESC"
    ).all(workspace) as Session[];
  }
  return db.prepare(
    "SELECT * FROM sessions WHERE state != 'stopped' ORDER BY last_event_at DESC"
  ).all() as Session[];
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/db.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "feat: add session CRUD operations"
```

---

### Task 5: Write failing tests for event operations

**Files:**
- Modify: `src/db.test.ts`

**Step 1: Add event operation tests**

Append to `src/db.test.ts`:

```typescript
import { insertEvent, getSessionEvents } from './db.ts';

describe('event operations', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    insertSession(db, {
      session_id: 'sess-1',
      workspace: 'myrepo:main',
      cwd: '/home/user/myrepo',
      transcript_path: null,
      started_at: 1000,
    });
  });

  it('inserts and retrieves events', () => {
    insertEvent(db, {
      session_id: 'sess-1',
      event_type: 'tool-use',
      data: JSON.stringify({ tool_name: 'Edit' }),
      created_at: 2000,
    });

    const events = getSessionEvents(db, 'sess-1');
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('tool-use');
    expect(events[0].session_id).toBe('sess-1');
  });

  it('returns events in chronological order', () => {
    insertEvent(db, { session_id: 'sess-1', event_type: 'tool-use', data: null, created_at: 2000 });
    insertEvent(db, { session_id: 'sess-1', event_type: 'user-prompt', data: null, created_at: 3000 });
    insertEvent(db, { session_id: 'sess-1', event_type: 'tool-use', data: null, created_at: 4000 });

    const events = getSessionEvents(db, 'sess-1');
    expect(events).toHaveLength(3);
    expect(events[0].created_at).toBe(2000);
    expect(events[2].created_at).toBe(4000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL — `insertEvent is not a function`

---

### Task 6: Implement event operations

**Files:**
- Modify: `src/db.ts`

**Step 1: Add event functions to db.ts**

```typescript
interface InsertEventParams {
  session_id: string;
  event_type: string;
  data: string | null;
  created_at: number;
}

interface EventRow {
  id: number;
  session_id: string;
  event_type: string;
  data: string | null;
  created_at: number;
}

export function insertEvent(db: Database.Database, params: InsertEventParams): void {
  db.prepare(`
    INSERT INTO events (session_id, event_type, data, created_at)
    VALUES (@session_id, @event_type, @data, @created_at)
  `).run(params);
}

export function getSessionEvents(db: Database.Database, sessionId: string): EventRow[] {
  return db.prepare(
    'SELECT * FROM events WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as EventRow[];
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/db.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "feat: add event insert and query operations"
```

---

### Task 7: Write failing tests for workspace cache

**Files:**
- Modify: `src/db.test.ts`

**Step 1: Add workspace cache tests**

Append to `src/db.test.ts`:

```typescript
import { upsertWorkspace, getCachedWorkspace } from './db.ts';

describe('workspace cache', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('caches and retrieves a workspace mapping', () => {
    upsertWorkspace(db, {
      cwd: '/home/user/myrepo',
      repo_name: 'myrepo',
      branch: 'main',
      workspace: 'myrepo:main',
      resolved_at: 1000,
    });

    const cached = getCachedWorkspace(db, '/home/user/myrepo');
    expect(cached).not.toBeNull();
    expect(cached!.workspace).toBe('myrepo:main');
  });

  it('returns null for uncached cwd', () => {
    const cached = getCachedWorkspace(db, '/nowhere');
    expect(cached).toBeNull();
  });

  it('upserts on conflict (branch change)', () => {
    upsertWorkspace(db, {
      cwd: '/home/user/myrepo',
      repo_name: 'myrepo',
      branch: 'main',
      workspace: 'myrepo:main',
      resolved_at: 1000,
    });
    upsertWorkspace(db, {
      cwd: '/home/user/myrepo',
      repo_name: 'myrepo',
      branch: 'dev',
      workspace: 'myrepo:dev',
      resolved_at: 2000,
    });

    const cached = getCachedWorkspace(db, '/home/user/myrepo');
    expect(cached!.workspace).toBe('myrepo:dev');
    expect(cached!.resolved_at).toBe(2000);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL — `upsertWorkspace is not a function`

---

### Task 8: Implement workspace cache

**Files:**
- Modify: `src/db.ts`

**Step 1: Add workspace cache functions to db.ts**

```typescript
import type { WorkspaceEntry } from './types.ts';

export function upsertWorkspace(db: Database.Database, entry: WorkspaceEntry): void {
  db.prepare(`
    INSERT INTO workspaces (cwd, repo_name, branch, workspace, resolved_at)
    VALUES (@cwd, @repo_name, @branch, @workspace, @resolved_at)
    ON CONFLICT(cwd) DO UPDATE SET
      repo_name = excluded.repo_name,
      branch = excluded.branch,
      workspace = excluded.workspace,
      resolved_at = excluded.resolved_at
  `).run(entry);
}

export function getCachedWorkspace(db: Database.Database, cwd: string): WorkspaceEntry | null {
  return db.prepare('SELECT * FROM workspaces WHERE cwd = ?').get(cwd) as WorkspaceEntry | null;
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/db.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "feat: add workspace cache operations"
```

---

### Task 9: Write failing tests for query helpers

These helpers support `sap latest`, `sap sessions`, and `sap gc`.

**Files:**
- Modify: `src/db.test.ts`

**Step 1: Add query helper tests**

Append to `src/db.test.ts`:

```typescript
import { getLatestSession, getSessionHistory, deleteStaleSessions } from './db.ts';

describe('query helpers', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('getLatestSession returns most recent session for workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: 2000 });
    updateSessionState(db, 's1', 'stopped', 1500);

    const latest = getLatestSession(db, 'repo:main');
    expect(latest!.session_id).toBe('s2');
  });

  it('getLatestSession returns stopped session if most recent', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: 1000 });
    updateSessionState(db, 's1', 'stopped', 2000);

    const latest = getLatestSession(db, 'repo:main');
    expect(latest!.state).toBe('stopped');
  });

  it('getSessionHistory returns N most recent sessions', () => {
    for (let i = 1; i <= 5; i++) {
      insertSession(db, { session_id: `s${i}`, workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: i * 1000 });
    }

    const history = getSessionHistory(db, { limit: 3 });
    expect(history).toHaveLength(3);
    expect(history[0].session_id).toBe('s5');
    expect(history[2].session_id).toBe('s3');
  });

  it('getSessionHistory filters by workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo-a:main', cwd: '/a', transcript_path: null, started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo-b:main', cwd: '/b', transcript_path: null, started_at: 2000 });

    const history = getSessionHistory(db, { workspace: 'repo-a:main', limit: 20 });
    expect(history).toHaveLength(1);
    expect(history[0].session_id).toBe('s1');
  });

  it('deleteStaleSessions removes old stopped sessions and their events', () => {
    const now = Date.now();
    const oldTime = now - 60000; // 60 seconds ago
    insertSession(db, { session_id: 's-old', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: oldTime });
    updateSessionState(db, 's-old', 'stopped', oldTime + 100);
    insertEvent(db, { session_id: 's-old', event_type: 'tool-use', data: null, created_at: oldTime + 50 });

    insertSession(db, { session_id: 's-new', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: now });

    const deleted = deleteStaleSessions(db, 50000); // 50 seconds — old session is 60s ago
    expect(deleted).toBe(1);
    expect(getSession(db, 's-old')).toBeNull();
    expect(getSessionEvents(db, 's-old')).toHaveLength(0);
    expect(getSession(db, 's-new')).not.toBeNull();
  });

  it('deleteStaleSessions removes orphaned active sessions', () => {
    const oldTime = Date.now() - 60000; // 60 seconds ago
    insertSession(db, { session_id: 's-orphan', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: oldTime });
    // Never stopped, last_event_at is oldTime (from started_at)

    const deleted = deleteStaleSessions(db, 50000); // 50 seconds — orphan is 60s ago
    expect(deleted).toBe(1);
    expect(getSession(db, 's-orphan')).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/db.test.ts`
Expected: FAIL — `getLatestSession is not a function`

---

### Task 10: Implement query helpers

**Files:**
- Modify: `src/db.ts`

**Step 1: Add query helper functions**

```typescript
export function getLatestSession(db: Database.Database, workspace: string): Session | null {
  return db.prepare(
    'SELECT * FROM sessions WHERE workspace = ? ORDER BY started_at DESC LIMIT 1'
  ).get(workspace) as Session | null;
}

interface SessionHistoryParams {
  workspace?: string;
  limit: number;
}

export function getSessionHistory(db: Database.Database, params: SessionHistoryParams): Session[] {
  if (params.workspace) {
    return db.prepare(
      'SELECT * FROM sessions WHERE workspace = ? ORDER BY started_at DESC LIMIT ?'
    ).all(params.workspace, params.limit) as Session[];
  }
  return db.prepare(
    'SELECT * FROM sessions ORDER BY started_at DESC LIMIT ?'
  ).all(params.limit) as Session[];
}

export function deleteStaleSessions(db: Database.Database, olderThan: number): number {
  const now = Date.now();
  const cutoff = now - olderThan;

  // Delete sessions older than cutoff: stopped with ended_at before cutoff, OR
  // non-stopped with last_event_at before cutoff (orphaned).
  // Events are cascade-deleted via ON DELETE CASCADE on the foreign key.
  const result = db.prepare(`
    DELETE FROM sessions
    WHERE (state = 'stopped' AND ended_at < ?)
       OR (state != 'stopped' AND last_event_at < ?)
  `).run(cutoff, cutoff);

  return result.changes;
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/db.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/db.ts src/db.test.ts
git commit -m "feat: add latest, history, and gc query helpers"
```
