# Phase 5: CLI Wiring & Integration

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Wire all commands into the commander CLI entry point, add stdin reading for the record command, write integration tests, and produce the final working binary.

**Architecture:** `src/cli.ts` is the single entry point. It opens the database once, defines all commands via commander, and dispatches. The record command reads stdin synchronously (hook payloads are small, ~1KB).

**Tech Stack:** commander, better-sqlite3, vitest

**Related:** [../design/hooks.md](../design/hooks.md) (hook config), [phase-4-queries.md](./phase-4-queries.md) (prerequisite), [../design/overview.md](../design/overview.md)

---

### Task 1: Wire up CLI entry point

**Files:**
- Modify: `src/cli.ts`

**Step 1: Replace the stub with full commander setup**

```typescript
import { Command } from 'commander';
import { readFileSync } from 'fs';
import { openDb, DEFAULT_DB_PATH } from './db.ts';
import { recordEvent, parsePayload } from './commands/record.ts';
import { statusCommand } from './commands/status.ts';
import { latestCommand } from './commands/latest.ts';
import { sessionsCommand } from './commands/sessions.ts';
import { gcCli } from './commands/gc.ts';
import type { EventType } from './types.ts';

const VALID_EVENTS: EventType[] = [
  'session-start', 'session-end', 'turn-complete',
  'attention-permission', 'attention-idle',
  'user-prompt', 'tool-use',
];

const program = new Command();

program
  .name('sap')
  .description('Session Awareness Protocol — status tracking for Claude Code sessions')
  .version('0.1.0');

program
  .command('record')
  .description('Record a hook event (reads JSON from stdin)')
  .requiredOption('--event <type>', `Event type: ${VALID_EVENTS.join(', ')}`)
  .action((options) => {
    const eventType = options.event as string;
    if (!VALID_EVENTS.includes(eventType as EventType)) {
      process.stderr.write(`Unknown event type: ${eventType}\n`);
      process.exit(2);
    }

    let stdin: string;
    try {
      stdin = readFileSync(0, 'utf-8');
    } catch {
      process.stderr.write('Failed to read stdin\n');
      process.exit(2);
    }

    try {
      const payload = parsePayload(stdin);
      const db = openDb();
      recordEvent(db, eventType as EventType, payload);
      db.close();
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    }
  });

program
  .command('status')
  .description('Show active session states')
  .option('--workspace <name>', 'Filter by workspace (e.g. "repo:branch")')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    statusCommand(db, options);
    db.close();
  });

program
  .command('latest')
  .description('Show most recent session for a workspace')
  .requiredOption('--workspace <name>', 'Workspace name (e.g. "repo:branch")')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    latestCommand(db, options);
    db.close();
  });

program
  .command('sessions')
  .description('Show session history')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--limit <n>', 'Number of sessions to show', '20')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    sessionsCommand(db, { ...options, limit: parseInt(options.limit, 10) });
    db.close();
  });

program
  .command('gc')
  .description('Clean up old sessions and events')
  .option('--older-than <duration>', 'Delete sessions older than (e.g. "30d")', '30d')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    gcCli(db, { olderThan: options.olderThan, json: options.json });
    db.close();
  });

program.parse();
```

**Step 2: Verify type-checking**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat: wire all commands into CLI entry point"
```

---

### Task 2: Build and smoke-test the binary

**Step 1: Build**

Run: `npm run build`
Expected: `dist/sap.cjs` created

**Step 2: Verify help output**

Run: `node dist/sap.cjs --help`
Expected: Shows all commands (record, status, latest, sessions, gc)

**Step 3: Verify record command validates event type**

Run: `echo '{}' | node dist/sap.cjs record --event bad-event`
Expected: Exit code 2, stderr contains "Unknown event type"

**Step 4: Verify status with empty db**

Run: `node dist/sap.cjs status --json`
Expected: `{ "sessions": [] }`

**Step 5: Verify all checks passed**

`dist/` is in `.gitignore` — the binary is a build artifact, not committed. CI or local `npm run build` produces it.

---

### Task 3: Write integration test — full record + status flow

**Files:**
- Create: `src/integration.test.ts`

**Step 1: Write the integration test**

This test exercises the full flow: record events and query status, using an in-memory db.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from './db.ts';
import { recordEvent, parsePayload } from './commands/record.ts';
import { statusQuery } from './commands/status.ts';
import { latestQuery } from './commands/latest.ts';
import { sessionsQuery } from './commands/sessions.ts';
import { gcCommand } from './commands/gc.ts';

describe('integration: full session lifecycle', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('tracks a complete session lifecycle', () => {
    const base = {
      session_id: 'int-sess-1',
      cwd: '/tmp',
      transcript_path: '/tmp/t.jsonl',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
    };

    // 1. Session starts
    recordEvent(db, 'session-start', { ...base, source: 'startup' as const });

    let status = statusQuery(db);
    expect(status.sessions).toHaveLength(1);
    expect(status.sessions[0].state).toBe('active');

    // 2. Tool use
    recordEvent(db, 'tool-use', {
      ...base,
      hook_event_name: 'PostToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/home/user/src/app.ts' },
    });

    status = statusQuery(db);
    expect(status.sessions[0].last_tool).toBe('Edit');
    expect(status.sessions[0].last_tool_detail).toBe('app.ts');

    // 3. Turn complete — Claude done responding
    recordEvent(db, 'turn-complete', { ...base, hook_event_name: 'Stop' });

    status = statusQuery(db);
    expect(status.sessions[0].state).toBe('idle');

    // 4. User submits another prompt
    recordEvent(db, 'user-prompt', { ...base, hook_event_name: 'UserPromptSubmit', prompt: 'fix the bug' });

    status = statusQuery(db);
    expect(status.sessions[0].state).toBe('active');

    // 5. Permission prompt — attention needed
    recordEvent(db, 'attention-permission', { ...base, hook_event_name: 'Notification', notification_type: 'permission_prompt' });

    status = statusQuery(db);
    expect(status.sessions[0].state).toBe('attention');

    // 6. User responds — clears attention
    recordEvent(db, 'user-prompt', { ...base, hook_event_name: 'UserPromptSubmit' });

    status = statusQuery(db);
    expect(status.sessions[0].state).toBe('active');

    // 7. Session ends
    recordEvent(db, 'session-end', { ...base, hook_event_name: 'SessionEnd', reason: 'logout' });

    status = statusQuery(db);
    expect(status.sessions).toHaveLength(0); // stopped sessions excluded

    // 8. Latest still returns it
    const latest = latestQuery(db, 'tmp:local');
    expect(latest).not.toBeNull();
    expect(latest!.state).toBe('stopped');

    // 9. Shows in history
    const history = sessionsQuery(db, { limit: 20 });
    expect(history).toHaveLength(1);
    expect(history[0].session_id).toBe('int-sess-1');
  });

  it('handles session resume correctly', () => {
    const base = {
      session_id: 'resume-sess',
      cwd: '/tmp',
      transcript_path: '/tmp/t.jsonl',
      permission_mode: 'default',
      hook_event_name: 'SessionStart',
    };

    // Start, then stop
    recordEvent(db, 'session-start', { ...base, source: 'startup' as const });
    recordEvent(db, 'session-end', { ...base, hook_event_name: 'SessionEnd' });

    // Resume the same session
    recordEvent(db, 'session-start', { ...base, source: 'resume' as const });

    const status = statusQuery(db);
    expect(status.sessions).toHaveLength(1);
    expect(status.sessions[0].state).toBe('active');
    expect(status.sessions[0].session_id).toBe('resume-sess');
  });

  it('handles multiple concurrent sessions', () => {
    const mkPayload = (id: string, cwd: string) => ({
      session_id: id,
      cwd,
      transcript_path: `/tmp/${id}.jsonl`,
      permission_mode: 'default' as const,
      hook_event_name: 'SessionStart',
    });

    recordEvent(db, 'session-start', { ...mkPayload('s1', '/tmp/repo-a'), source: 'startup' as const });
    recordEvent(db, 'session-start', { ...mkPayload('s2', '/tmp/repo-b'), source: 'startup' as const });

    const status = statusQuery(db);
    expect(status.sessions).toHaveLength(2);
  });
});
```

**Step 2: Run integration test**

Run: `npx vitest run src/integration.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/integration.test.ts
git commit -m "test: add integration tests for full session lifecycle"
```

---

### Task 4: Run full test suite

**Step 1: Run all tests**

Run: `npm test`
Expected: All test files pass:
- `src/db.test.ts`
- `src/workspace.test.ts`
- `src/tool-detail.test.ts`
- `src/commands/record.test.ts`
- `src/commands/status.test.ts`
- `src/commands/latest.test.ts`
- `src/commands/sessions.test.ts`
- `src/commands/gc.test.ts`
- `src/integration.test.ts`

**Step 2: Run type-checking**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Final build**

Run: `npm run build`
Expected: `dist/sap.cjs` produced

---

### Task 5: Create hooks configuration reference

**Files:**
- Create: `hooks.example.json`

This is a reference file users can copy into their Claude Code settings. Not part of the runtime code.

**Step 1: Write hooks.example.json**

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event session-start",
          "timeout": 5000
        }]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event session-end",
          "timeout": 5000
        }]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event turn-complete",
          "timeout": 5000
        }]
      }
    ],
    "Notification": [
      {
        "matcher": "permission_prompt",
        "hooks": [{
          "type": "command",
          "command": "sap record --event attention-permission",
          "timeout": 5000
        }]
      },
      {
        "matcher": "idle_prompt",
        "hooks": [{
          "type": "command",
          "command": "sap record --event attention-idle",
          "timeout": 5000
        }]
      }
    ],
    "UserPromptSubmit": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event user-prompt",
          "timeout": 5000
        }]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [{
          "type": "command",
          "command": "sap record --event tool-use",
          "timeout": 5000
        }]
      }
    ]
  }
}
```

**Step 2: Commit**

```bash
git add hooks.example.json
git commit -m "docs: add example hooks configuration for Claude Code"
```

---

### Task 6: Final commit — all tests green, binary built

**Step 1: Run full verification**

```bash
npm test && npx tsc --noEmit && npm run build && node dist/sap.cjs --help
```

Expected: All pass, help output shown.

**Step 2: Commit any remaining files**

```bash
git status
# Add any unstaged files
git add -A
git commit -m "feat: sap v0.1.0 — session awareness protocol for Claude Code"
```
