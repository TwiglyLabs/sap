# Phase 4: Query Commands

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Implement the read-path CLI commands: `sap status`, `sap latest`, `sap sessions`, `sap gc`.

**Architecture:** Each command is a separate module in `src/commands/`. Each exports a function for CLI wiring and uses db helpers from phase 1. All commands support `--json` for structured output (Emacs consumption) and fall back to human-readable chalk output.

**Tech Stack:** better-sqlite3, chalk, vitest

**Related:** [../design/approach.md](../design/approach.md) (command specs), [phase-3-record.md](./phase-3-record.md) (prerequisite), [phase-5-cli.md](./phase-5-cli.md) (next)

---

### Task 1: Write failing test for status command

**Files:**
- Create: `src/commands/status.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, updateSessionState } from '../db.ts';
import { statusQuery } from './status.ts';

describe('statusQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('returns active sessions with stale=false', () => {
    insertSession(db, {
      session_id: 's1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: Date.now() - 5000,
    });
    // Update last_event_at to recent
    updateSessionState(db, 's1', 'active', Date.now());

    const result = statusQuery(db);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].stale).toBe(false);
  });

  it('marks sessions older than 10 minutes as stale', () => {
    const tenMinAgo = Date.now() - 11 * 60 * 1000;
    insertSession(db, {
      session_id: 's1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: tenMinAgo - 1000,
    });
    // last_event_at stays at started_at (tenMinAgo - 1000)

    const result = statusQuery(db);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].stale).toBe(true);
  });

  it('excludes stopped sessions', () => {
    insertSession(db, {
      session_id: 's1',
      workspace: 'repo:main',
      cwd: '/r',
      transcript_path: null,
      started_at: Date.now(),
    });
    updateSessionState(db, 's1', 'stopped', Date.now());

    const result = statusQuery(db);
    expect(result.sessions).toHaveLength(0);
  });

  it('filters by workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo-a:main', cwd: '/a', transcript_path: null, started_at: Date.now() });
    insertSession(db, { session_id: 's2', workspace: 'repo-b:dev', cwd: '/b', transcript_path: null, started_at: Date.now() });

    const result = statusQuery(db, 'repo-a:main');
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].workspace).toBe('repo-a:main');
  });

  it('includes idle and attention sessions', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() });
    updateSessionState(db, 's1', 'idle', Date.now());

    insertSession(db, { session_id: 's2', workspace: 'repo:dev', cwd: '/r', transcript_path: null, started_at: Date.now() });
    updateSessionState(db, 's2', 'attention', Date.now());

    const result = statusQuery(db);
    expect(result.sessions).toHaveLength(2);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/status.test.ts`
Expected: FAIL — `Cannot find module './status.ts'`

---

### Task 2: Implement status command

**Files:**
- Create: `src/commands/status.ts`

**Step 1: Write implementation**

```typescript
import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { getActiveSessions } from '../db.ts';
import type { SessionStatus } from '../types.ts';

const STALE_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

interface StatusResult {
  sessions: SessionStatus[];
}

export function statusQuery(db: Database.Database, workspace?: string): StatusResult {
  const sessions = getActiveSessions(db, workspace);
  const now = Date.now();

  return {
    sessions: sessions.map(s => ({
      ...s,
      stale: (now - s.last_event_at) > STALE_THRESHOLD_MS,
    })),
  };
}

interface StatusOptions {
  workspace?: string;
  json?: boolean;
}

export function statusCommand(db: Database.Database, options: StatusOptions): void {
  const result = statusQuery(db, options.workspace);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.sessions.length === 0) {
    console.log('No active sessions.');
    return;
  }

  for (const s of result.sessions) {
    const stateColor = s.state === 'active' ? chalk.green
      : s.state === 'idle' ? chalk.blue
      : s.state === 'attention' ? chalk.yellow
      : chalk.gray;

    const staleTag = s.stale ? chalk.red(' [stale]') : '';
    const toolInfo = s.last_tool ? ` ${chalk.dim(s.last_tool)}${s.last_tool_detail ? chalk.dim(`:${s.last_tool_detail}`) : ''}` : '';

    console.log(`  ${chalk.white(s.workspace)} ${stateColor(s.state)}${staleTag}${toolInfo}`);
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/commands/status.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/commands/status.ts src/commands/status.test.ts
git commit -m "feat: add status command with staleness detection"
```

---

### Task 3: Write failing test for latest command

**Files:**
- Create: `src/commands/latest.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, updateSessionState } from '../db.ts';
import { latestQuery } from './latest.ts';

describe('latestQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('returns the most recent session for a workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: '/t1', started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: '/t2', started_at: 2000 });

    const result = latestQuery(db, 'repo:main');
    expect(result).not.toBeNull();
    expect(result!.session_id).toBe('s2');
  });

  it('returns stopped session if it is the most recent', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: '/t1', started_at: 1000 });
    updateSessionState(db, 's1', 'stopped', 2000);

    const result = latestQuery(db, 'repo:main');
    expect(result!.state).toBe('stopped');
    expect(result!.ended_at).toBe(2000);
  });

  it('returns null for unknown workspace', () => {
    const result = latestQuery(db, 'nonexistent:branch');
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/latest.test.ts`
Expected: FAIL — `Cannot find module './latest.ts'`

---

### Task 4: Implement latest command

**Files:**
- Create: `src/commands/latest.ts`

**Step 1: Write implementation**

```typescript
import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { getLatestSession } from '../db.ts';
import type { Session } from '../types.ts';

export function latestQuery(db: Database.Database, workspace: string): Session | null {
  return getLatestSession(db, workspace);
}

interface LatestOptions {
  workspace: string;
  json?: boolean;
}

export function latestCommand(db: Database.Database, options: LatestOptions): void {
  const session = latestQuery(db, options.workspace);

  if (options.json) {
    console.log(JSON.stringify(session, null, 2));
    return;
  }

  if (!session) {
    console.log(`No sessions found for ${options.workspace}.`);
    return;
  }

  const stateColor = session.state === 'active' ? chalk.green
    : session.state === 'idle' ? chalk.blue
    : session.state === 'attention' ? chalk.yellow
    : chalk.gray;

  console.log(`  ${chalk.white(session.workspace)} ${stateColor(session.state)}`);
  console.log(`  Session: ${session.session_id}`);
  if (session.transcript_path) {
    console.log(`  Transcript: ${chalk.dim(session.transcript_path)}`);
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/commands/latest.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/commands/latest.ts src/commands/latest.test.ts
git commit -m "feat: add latest command"
```

---

### Task 5: Write failing test for sessions command

**Files:**
- Create: `src/commands/sessions.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession } from '../db.ts';
import { sessionsQuery } from './sessions.ts';

describe('sessionsQuery', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('returns sessions in reverse chronological order', () => {
    for (let i = 1; i <= 5; i++) {
      insertSession(db, { session_id: `s${i}`, workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: i * 1000 });
    }

    const result = sessionsQuery(db, { limit: 20 });
    expect(result).toHaveLength(5);
    expect(result[0].session_id).toBe('s5');
  });

  it('respects limit', () => {
    for (let i = 1; i <= 5; i++) {
      insertSession(db, { session_id: `s${i}`, workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: i * 1000 });
    }

    const result = sessionsQuery(db, { limit: 2 });
    expect(result).toHaveLength(2);
  });

  it('filters by workspace', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo-a:main', cwd: '/a', transcript_path: null, started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo-b:main', cwd: '/b', transcript_path: null, started_at: 2000 });

    const result = sessionsQuery(db, { workspace: 'repo-a:main', limit: 20 });
    expect(result).toHaveLength(1);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/sessions.test.ts`
Expected: FAIL — `Cannot find module './sessions.ts'`

---

### Task 6: Implement sessions command

**Files:**
- Create: `src/commands/sessions.ts`

**Step 1: Write implementation**

```typescript
import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { getSessionHistory } from '../db.ts';
import type { Session } from '../types.ts';

interface SessionsQueryOptions {
  workspace?: string;
  limit: number;
}

export function sessionsQuery(db: Database.Database, options: SessionsQueryOptions): Session[] {
  return getSessionHistory(db, options);
}

interface SessionsCommandOptions {
  workspace?: string;
  limit?: number;
  json?: boolean;
}

export function sessionsCommand(db: Database.Database, options: SessionsCommandOptions): void {
  const limit = options.limit ?? 20;
  const result = sessionsQuery(db, { workspace: options.workspace, limit });

  if (options.json) {
    console.log(JSON.stringify({ sessions: result }, null, 2));
    return;
  }

  if (result.length === 0) {
    console.log('No sessions found.');
    return;
  }

  for (const s of result) {
    const stateColor = s.state === 'active' ? chalk.green
      : s.state === 'idle' ? chalk.blue
      : s.state === 'attention' ? chalk.yellow
      : chalk.gray;

    const date = new Date(s.started_at).toLocaleString();
    console.log(`  ${chalk.dim(date)} ${chalk.white(s.workspace)} ${stateColor(s.state)} ${chalk.dim(s.session_id)}`);
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/commands/sessions.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/commands/sessions.ts src/commands/sessions.test.ts
git commit -m "feat: add sessions history command"
```

---

### Task 7: Write failing test for gc command

**Files:**
- Create: `src/commands/gc.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, insertSession, updateSessionState, getSession, insertEvent, getSessionEvents } from '../db.ts';
import { gcCommand as gcAction } from './gc.ts';

describe('gcAction', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('deletes stopped sessions older than threshold', () => {
    const oldTime = Date.now() - 40 * 24 * 60 * 60 * 1000; // 40 days ago
    insertSession(db, { session_id: 's-old', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: oldTime });
    updateSessionState(db, 's-old', 'stopped', oldTime + 1000);
    insertEvent(db, { session_id: 's-old', event_type: 'session-start', data: null, created_at: oldTime });

    const deleted = gcAction(db, 30 * 24 * 60 * 60 * 1000);
    expect(deleted).toBe(1);
    expect(getSession(db, 's-old')).toBeNull();
    expect(getSessionEvents(db, 's-old')).toHaveLength(0);
  });

  it('deletes orphaned active sessions older than threshold', () => {
    const oldTime = Date.now() - 40 * 24 * 60 * 60 * 1000;
    insertSession(db, { session_id: 's-orphan', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: oldTime });

    const deleted = gcAction(db, 30 * 24 * 60 * 60 * 1000);
    expect(deleted).toBe(1);
  });

  it('keeps recent sessions', () => {
    insertSession(db, { session_id: 's-new', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: Date.now() });

    const deleted = gcAction(db, 30 * 24 * 60 * 60 * 1000);
    expect(deleted).toBe(0);
    expect(getSession(db, 's-new')).not.toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/gc.test.ts`
Expected: FAIL — `Cannot find module './gc.ts'`

---

### Task 8: Implement gc command

**Files:**
- Create: `src/commands/gc.ts`

**Step 1: Write implementation**

```typescript
import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { deleteStaleSessions } from '../db.ts';

export function gcCommand(db: Database.Database, olderThanMs: number): number {
  return deleteStaleSessions(db, olderThanMs);
}

function parseDuration(s: string): number {
  const match = s.match(/^(\d+)d$/);
  if (!match) throw new Error(`Invalid duration: ${s}. Use format like "30d".`);
  return parseInt(match[1], 10) * 24 * 60 * 60 * 1000;
}

interface GcOptions {
  olderThan?: string;
  json?: boolean;
}

export function gcCli(db: Database.Database, options: GcOptions): void {
  const threshold = parseDuration(options.olderThan ?? '30d');
  const deleted = gcCommand(db, threshold);

  if (options.json) {
    console.log(JSON.stringify({ deleted }));
    return;
  }

  if (deleted === 0) {
    console.log('Nothing to clean up.');
  } else {
    console.log(`${chalk.green('Cleaned up')} ${deleted} session${deleted === 1 ? '' : 's'}.`);
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/commands/gc.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/commands/gc.ts src/commands/gc.test.ts
git commit -m "feat: add gc command for pruning old sessions"
```
