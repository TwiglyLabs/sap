# Phase 3: Record Command

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Implement `sap record --event <type>` — the write path. Reads hook JSON from stdin, resolves workspace, updates session state, logs events.

**Architecture:** Single `commands/record.ts` module exports a `recordEvent` function and a `recordCommand` function (for CLI wiring). The function parses stdin, dispatches based on event type, and runs the appropriate db operations in a transaction.

**Tech Stack:** better-sqlite3, vitest

**Related:** [../design/approach.md](../design/approach.md) (state machine), [../design/hooks.md](../design/hooks.md) (payloads), [phase-2-workspace.md](./phase-2-workspace.md) (prerequisite), [phase-4-queries.md](./phase-4-queries.md) (next)

---

### Task 1: Write failing test for session-start (startup)

**Files:**
- Create: `src/commands/record.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb, getSession, getSessionEvents } from '../db.ts';
import { recordEvent } from './record.ts';
import type { HookPayload } from '../types.ts';

// Helper: build a minimal payload
function payload(overrides: Partial<HookPayload> = {}): HookPayload {
  return {
    session_id: 'sess-1',
    cwd: '/tmp/fakerepo',
    transcript_path: '/tmp/transcript.jsonl',
    permission_mode: 'default',
    hook_event_name: 'SessionStart',
    ...overrides,
  };
}

describe('recordEvent', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  describe('session-start', () => {
    it('creates a new session on startup', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));

      const session = getSession(db, 'sess-1');
      expect(session).not.toBeNull();
      expect(session!.state).toBe('active');
      expect(session!.workspace).toMatch(/:/);
    });

    it('records a session-start event', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));

      const events = getSessionEvents(db, 'sess-1');
      expect(events).toHaveLength(1);
      expect(events[0].event_type).toBe('session-start');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/record.test.ts`
Expected: FAIL — `Cannot find module './record.ts'`

---

### Task 2: Implement record command skeleton with session-start

**Files:**
- Create: `src/commands/record.ts`

**Step 1: Write implementation**

```typescript
import type Database from 'better-sqlite3';
import type { EventType, HookPayload, SessionStartSource } from '../types.ts';
import { insertSession, getSession, updateSessionState, insertEvent } from '../db.ts';
import { resolveWorkspace } from '../workspace.ts';
import { extractToolDetail } from '../tool-detail.ts';

export function recordEvent(db: Database.Database, eventType: EventType, data: HookPayload): void {
  const now = Date.now();

  // Wrap all db operations in a transaction for atomicity
  const run = db.transaction(() => {
    switch (eventType) {
      case 'session-start':
        return handleSessionStart(db, data, now);
      default:
        throw new Error(`Unknown event type: ${eventType}`);
    }
  });
  run();
}

function handleSessionStart(db: Database.Database, data: HookPayload, now: number): void {
  const source: SessionStartSource = data.source ?? 'startup';
  // session-start always force-resolves workspace (catches branch changes)
  const workspace = resolveWorkspace(db, data.cwd, true);

  switch (source) {
    case 'startup':
    case 'clear': {
      insertSession(db, {
        session_id: data.session_id,
        workspace,
        cwd: data.cwd,
        transcript_path: data.transcript_path || null,
        started_at: now,
      });
      insertEvent(db, {
        session_id: data.session_id,
        event_type: 'session-start',
        data: JSON.stringify({ source }),
        created_at: now,
      });
      break;
    }
    case 'resume': {
      const existing = getSession(db, data.session_id);
      if (existing) {
        updateSessionState(db, data.session_id, 'active', now);
      } else {
        insertSession(db, {
          session_id: data.session_id,
          workspace,
          cwd: data.cwd,
          transcript_path: data.transcript_path || null,
          started_at: now,
        });
      }
      insertEvent(db, {
        session_id: data.session_id,
        event_type: 'session-start',
        data: JSON.stringify({ source }),
        created_at: now,
      });
      break;
    }
    case 'compact': {
      const existing = getSession(db, data.session_id);
      if (!existing) return; // Ignore compact for unknown session
      updateSessionState(db, data.session_id, existing.state, now);
      insertEvent(db, {
        session_id: data.session_id,
        event_type: 'session-start',
        data: JSON.stringify({ source }),
        created_at: now,
      });
      break;
    }
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/commands/record.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/commands/record.ts src/commands/record.test.ts
git commit -m "feat: add record command with session-start handling"
```

---

### Task 3: Write failing tests for session-start resume and compact

**Files:**
- Modify: `src/commands/record.test.ts`

**Step 1: Add resume/compact tests**

```typescript
    it('resumes existing session on resume source', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      // Simulate the session becoming idle
      recordEvent(db, 'turn-complete', payload());

      recordEvent(db, 'session-start', payload({ source: 'resume' }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('active');
    });

    it('creates new session if resume for unknown session_id', () => {
      recordEvent(db, 'session-start', payload({ session_id: 'new-sess', source: 'resume' }));

      const session = getSession(db, 'new-sess');
      expect(session).not.toBeNull();
      expect(session!.state).toBe('active');
    });

    it('updates last_event_at on compact without changing state', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'turn-complete', payload());

      const before = getSession(db, 'sess-1');
      expect(before!.state).toBe('idle');

      recordEvent(db, 'session-start', payload({ source: 'compact' }));

      const after = getSession(db, 'sess-1');
      expect(after!.state).toBe('idle');
      expect(after!.last_event_at).toBeGreaterThanOrEqual(before!.last_event_at);
    });

    it('ignores compact for unknown session', () => {
      // Should not throw
      recordEvent(db, 'session-start', payload({ session_id: 'unknown', source: 'compact' }));
      expect(getSession(db, 'unknown')).toBeNull();
    });
```

Note: The `turn-complete` test will fail until we implement that event type. These tests depend on Task 5 passing first. If running incrementally, skip the resume/compact tests that reference `turn-complete` and come back after Task 5.

**Step 2: Run test to verify new tests fail**

Run: `npx vitest run src/commands/record.test.ts`
Expected: FAIL — `Unknown event type: turn-complete`

---

### Task 4: Implement remaining event types

**Files:**
- Modify: `src/commands/record.ts`

**Step 1: Add all event type handlers**

Replace `recordEvent` with the full version and add handler functions:

```typescript
export function recordEvent(db: Database.Database, eventType: EventType, data: HookPayload): void {
  const now = Date.now();

  // Wrap all db operations in a transaction for atomicity
  const run = db.transaction(() => {
    switch (eventType) {
      case 'session-start':
        return handleSessionStart(db, data, now);
      case 'session-end':
        return handleStateChange(db, data, eventType, 'stopped', now);
      case 'turn-complete':
        return handleStateChange(db, data, eventType, 'idle', now);
      case 'attention-permission':
      case 'attention-idle':
        return handleStateChange(db, data, eventType, 'attention', now);
      case 'user-prompt':
        return handleStateChange(db, data, eventType, 'active', now);
      case 'tool-use':
        return handleToolUse(db, data, now);
    }
  });
  run();
}

function handleStateChange(
  db: Database.Database,
  data: HookPayload,
  eventType: EventType,
  newState: SessionState,
  now: number,
): void {
  const session = getSession(db, data.session_id);
  if (!session) return; // Ignore events for unknown sessions
  if (session.state === 'stopped') return; // Never revive stopped sessions

  updateSessionState(db, data.session_id, newState, now);
  insertEvent(db, {
    session_id: data.session_id,
    event_type: eventType,
    data: data.reason ? JSON.stringify({ reason: data.reason }) : null,
    created_at: now,
  });
}

function handleToolUse(db: Database.Database, data: HookPayload, now: number): void {
  const session = getSession(db, data.session_id);
  if (!session) return;
  if (session.state === 'stopped') return; // Never revive stopped sessions

  const toolName = data.tool_name ?? 'unknown';
  const toolDetail = extractToolDetail(toolName, data.tool_input ?? null);

  updateSessionState(db, data.session_id, 'active', now, { tool: toolName, detail: toolDetail });
  insertEvent(db, {
    session_id: data.session_id,
    event_type: 'tool-use',
    data: JSON.stringify({ tool_name: toolName, tool_detail: toolDetail }),
    created_at: now,
  });
}
```

Also add `SessionState` to the import from `../types.ts`.

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/commands/record.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/commands/record.ts src/commands/record.test.ts
git commit -m "feat: add all event type handlers to record command"
```

---

### Task 5: Write failing tests for session-end, turn-complete, attention, user-prompt

**Files:**
- Modify: `src/commands/record.test.ts`

**Step 1: Add state transition tests**

```typescript
  describe('session-end', () => {
    it('stops the session and sets ended_at', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'session-end', payload({ reason: 'logout' }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('stopped');
      expect(session!.ended_at).not.toBeNull();
    });

    it('ignores session-end for unknown session', () => {
      // Should not throw
      recordEvent(db, 'session-end', payload({ session_id: 'ghost' }));
    });
  });

  describe('turn-complete', () => {
    it('sets session to idle', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'turn-complete', payload());

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('idle');
    });
  });

  describe('attention events', () => {
    it('sets session to attention on permission prompt', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'attention-permission', payload({ hook_event_name: 'Notification' }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('attention');
    });

    it('sets session to attention on idle', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'attention-idle', payload({ hook_event_name: 'Notification' }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('attention');
    });
  });

  describe('user-prompt', () => {
    it('clears attention state back to active', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'attention-permission', payload());
      expect(getSession(db, 'sess-1')!.state).toBe('attention');

      recordEvent(db, 'user-prompt', payload());
      expect(getSession(db, 'sess-1')!.state).toBe('active');
    });

    it('clears idle state back to active', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'turn-complete', payload());
      expect(getSession(db, 'sess-1')!.state).toBe('idle');

      recordEvent(db, 'user-prompt', payload());
      expect(getSession(db, 'sess-1')!.state).toBe('active');
    });
  });
```

**Step 2: Run tests to verify they pass**

These should already pass from the Task 4 implementation. If any fail, debug before continuing.

Run: `npx vitest run src/commands/record.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/commands/record.test.ts
git commit -m "test: add state transition tests for all event types"
```

---

### Task 6: Write failing tests for tool-use

**Files:**
- Modify: `src/commands/record.test.ts`

**Step 1: Add tool-use tests**

```typescript
  describe('tool-use', () => {
    it('sets state to active and records tool info', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'tool-use', payload({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: '/home/user/src/app.ts' },
      }));

      const session = getSession(db, 'sess-1');
      expect(session!.state).toBe('active');
      expect(session!.last_tool).toBe('Edit');
      expect(session!.last_tool_detail).toBe('app.ts');
    });

    it('records tool-use event with tool data', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'tool-use', payload({
        tool_name: 'Bash',
        tool_input: { command: 'npm test' },
      }));

      const events = getSessionEvents(db, 'sess-1');
      const toolEvent = events.find(e => e.event_type === 'tool-use');
      expect(toolEvent).toBeDefined();
      const data = JSON.parse(toolEvent!.data!);
      expect(data.tool_name).toBe('Bash');
      expect(data.tool_detail).toBe('npm test');
    });

    it('handles missing tool_name gracefully', () => {
      recordEvent(db, 'session-start', payload({ source: 'startup' }));
      recordEvent(db, 'tool-use', payload());

      const session = getSession(db, 'sess-1');
      expect(session!.last_tool).toBe('unknown');
    });
  });
```

**Step 2: Run tests to verify they pass**

These should already pass from the Task 4 implementation.

Run: `npx vitest run src/commands/record.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/commands/record.test.ts
git commit -m "test: add tool-use event tests"
```

---

### Task 7: Write failing test for stdin parsing

The CLI will read JSON from stdin. We need a helper to parse it safely.

**Files:**
- Modify: `src/commands/record.test.ts`

**Step 1: Add parseStdin test**

```typescript
import { parsePayload } from './record.ts';

describe('parsePayload', () => {
  it('parses valid JSON', () => {
    const result = parsePayload('{"session_id": "s1", "cwd": "/tmp", "transcript_path": "/t", "permission_mode": "default", "hook_event_name": "SessionStart"}');
    expect(result.session_id).toBe('s1');
  });

  it('throws on invalid JSON', () => {
    expect(() => parsePayload('not json')).toThrow();
  });

  it('throws on missing session_id', () => {
    expect(() => parsePayload('{"cwd": "/tmp"}')).toThrow(/session_id/);
  });

  it('throws on missing cwd', () => {
    expect(() => parsePayload('{"session_id": "s1"}')).toThrow(/cwd/);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands/record.test.ts`
Expected: FAIL — `parsePayload is not exported`

---

### Task 8: Implement parsePayload

**Files:**
- Modify: `src/commands/record.ts`

**Step 1: Add parsePayload**

```typescript
export function parsePayload(raw: string): HookPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('Invalid JSON input');
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.session_id !== 'string') throw new Error('Missing required field: session_id');
  if (typeof obj.cwd !== 'string') throw new Error('Missing required field: cwd');

  return {
    session_id: obj.session_id as string,
    cwd: obj.cwd as string,
    transcript_path: (obj.transcript_path as string) || '',
    permission_mode: (obj.permission_mode as string) ?? 'default',
    hook_event_name: (obj.hook_event_name as string) ?? '',
    source: obj.source as SessionStartSource | undefined,
    reason: obj.reason as string | undefined,
    tool_name: obj.tool_name as string | undefined,
    tool_input: obj.tool_input as Record<string, unknown> | undefined,
    tool_response: obj.tool_response as Record<string, unknown> | undefined,
    prompt: obj.prompt as string | undefined,
    message: obj.message as string | undefined,
    notification_type: obj.notification_type as string | undefined,
    stop_hook_active: obj.stop_hook_active as boolean | undefined,
  };
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/commands/record.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/commands/record.ts src/commands/record.test.ts
git commit -m "feat: add stdin JSON payload parsing with validation"
```
