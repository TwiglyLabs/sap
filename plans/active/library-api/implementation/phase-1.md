# Phase 1: Export Promotions and Library Entry Point

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Make all business logic functions and types importable from a single `src/index.ts` entry point.

**Architecture:** The functions already exist and are tested. This phase promotes unexported interfaces to exports, then creates `src/index.ts` as the barrel file that re-exports everything a library consumer needs. No new logic.

**Tech Stack:** TypeScript, vitest

**Related:** [../design/overview.md](../design/overview.md), [./phase-2.md](./phase-2.md)

---

### Task 1: Promote StatusResult and GroupedStatusResult to exports

**Files:**
- Modify: `src/commands/status.ts:8` and `src/commands/status.ts:24`

**Step 1: Add export to StatusResult interface**

In `src/commands/status.ts`, change line 8 from:

```typescript
interface StatusResult {
```

to:

```typescript
export interface StatusResult {
```

**Step 2: Add export to GroupedStatusResult interface**

In `src/commands/status.ts`, change line 24 from:

```typescript
interface GroupedStatusResult {
```

to:

```typescript
export interface GroupedStatusResult {
```

**Step 3: Run existing tests to verify nothing broke**

Run: `npx vitest run src/commands/status.test.ts`
Expected: PASS (no behavior change, just visibility)

**Step 4: Commit**

```bash
git add src/commands/status.ts
git commit -m "refactor: export StatusResult and GroupedStatusResult interfaces"
```

---

### Task 2: Promote SessionsQueryOptions to export

**Files:**
- Modify: `src/commands/sessions.ts:6`

**Step 1: Add export to SessionsQueryOptions interface**

In `src/commands/sessions.ts`, change line 6 from:

```typescript
interface SessionsQueryOptions {
```

to:

```typescript
export interface SessionsQueryOptions {
```

**Step 2: Run existing tests**

Run: `npx vitest run src/commands/sessions.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/commands/sessions.ts
git commit -m "refactor: export SessionsQueryOptions interface"
```

---

### Task 3: Promote SessionAnalytics to export

**Files:**
- Modify: `src/commands/analytics-sessions.ts:5`

**Step 1: Add export to SessionAnalytics interface**

In `src/commands/analytics-sessions.ts`, change line 5 from:

```typescript
interface SessionAnalytics {
```

to:

```typescript
export interface SessionAnalytics {
```

**Step 2: Run existing tests**

Run: `npx vitest run src/commands/analytics-sessions.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/commands/analytics-sessions.ts
git commit -m "refactor: export SessionAnalytics interface"
```

---

### Task 4: Create the library entry point

**Files:**
- Create: `src/index.ts`

**Step 1: Write the barrel file**

Create `src/index.ts` with the following content. This re-exports every public
function and type. Organized by domain.

```typescript
// --- Database ---
export { openDb, DEFAULT_DB_PATH } from './db.ts';
export {
  insertSession,
  upsertSession,
  getSession,
  updateSessionState,
  getActiveSessions,
  insertEvent,
  getSessionEvents,
  upsertWorkspace,
  getCachedWorkspace,
  getLatestSession,
  getSessionHistory,
  markStaleSessions,
  deleteStaleSessions,
  insertTurn,
  getSessionTurns,
  insertToolCall,
  getTurnToolCalls,
} from './db.ts';
export type { EventRow } from './db.ts';

// --- Core types ---
export type {
  SessionState,
  EventType,
  SessionStartSource,
  HookPayload,
  Session,
  SessionStatus,
  Turn,
  ToolCall,
  WorkspaceEntry,
} from './types.ts';

// --- Event recording ---
export { recordEvent, parsePayload } from './commands/record.ts';

// --- Session queries ---
export { statusQuery, statusQueryGrouped } from './commands/status.ts';
export type { StatusResult, GroupedStatusResult } from './commands/status.ts';

export { latestQuery } from './commands/latest.ts';

export { sessionsQuery } from './commands/sessions.ts';
export type { SessionsQueryOptions } from './commands/sessions.ts';

// --- Lifecycle management ---
export { gcCommand } from './commands/gc.ts';
export { sweepCommand, parseSweepThreshold } from './commands/sweep.ts';

// --- Transcript ingestion ---
export { ingestSession, ingestBatch } from './commands/ingest.ts';
export type {
  IngestResult,
  IngestOptions,
  BatchResult,
  BatchOptions,
} from './commands/ingest.ts';

// --- Raw query ---
export { executeQuery } from './commands/query.ts';
export type { QueryResult } from './commands/query.ts';

// --- Analytics ---
export { parseDuration, buildWhereClause, parseAnalyticsOptions } from './commands/analytics-common.ts';
export type {
  FilterOptions,
  WhereClause,
  AnalyticsCliOptions,
} from './commands/analytics-common.ts';

export { summaryQuery } from './commands/analytics-summary.ts';
export type { SummaryResult } from './commands/analytics-summary.ts';

export { toolsQuery } from './commands/analytics-tools.ts';
export type { ToolsResult } from './commands/analytics-tools.ts';

export { sessionsAnalyticsQuery } from './commands/analytics-sessions.ts';
export type {
  SessionAnalytics,
  SessionsAnalyticsResult,
} from './commands/analytics-sessions.ts';

export { patternsQuery } from './commands/analytics-patterns.ts';
export type { PatternsResult } from './commands/analytics-patterns.ts';

// --- Workspace resolution ---
export { resolveWorkspace, resolveWorkspaceFromGit } from './workspace.ts';

// --- Transcript parsing ---
export { parseTranscriptLine, groupIntoTurns } from './transcript.ts';
export type {
  TranscriptToolUse,
  TranscriptToolResult,
  TranscriptUsage,
  TranscriptLine,
  ParsedTurn,
} from './transcript.ts';

// --- Tool detail extraction ---
export { extractToolDetail } from './tool-detail.ts';
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors. If any type isn't actually exported from its source module,
TypeScript will catch it here.

**Step 3: Commit**

```bash
git add src/index.ts
git commit -m "feat: add library entry point (src/index.ts)"
```

---

### Task 5: Write the library export contract test

**Files:**
- Create: `src/index.test.ts`

This test verifies that every exported function is a real function (not
undefined) and every exported type compiles. It's a **contract test** for the
public API surface — it catches missing or broken exports at compile time and
runtime. Behavioral tests for these functions live in Phase 3.

**Step 1: Write the test**

```typescript
import { describe, it, expect } from 'vitest';
import {
  // Database
  openDb,
  DEFAULT_DB_PATH,
  insertSession,
  upsertSession,
  getSession,
  updateSessionState,
  getActiveSessions,
  insertEvent,
  getSessionEvents,
  upsertWorkspace,
  getCachedWorkspace,
  getLatestSession,
  getSessionHistory,
  markStaleSessions,
  deleteStaleSessions,
  insertTurn,
  getSessionTurns,
  insertToolCall,
  getTurnToolCalls,
  // Event recording
  recordEvent,
  parsePayload,
  // Session queries
  statusQuery,
  statusQueryGrouped,
  latestQuery,
  sessionsQuery,
  // Lifecycle
  gcCommand,
  sweepCommand,
  parseSweepThreshold,
  // Ingestion
  ingestSession,
  ingestBatch,
  // Raw query
  executeQuery,
  // Analytics
  parseDuration,
  buildWhereClause,
  parseAnalyticsOptions,
  summaryQuery,
  toolsQuery,
  sessionsAnalyticsQuery,
  patternsQuery,
  // Workspace
  resolveWorkspace,
  resolveWorkspaceFromGit,
  // Transcript
  parseTranscriptLine,
  groupIntoTurns,
  // Tool detail
  extractToolDetail,
} from './index.ts';

// Type-only imports — compile-time verification that types are re-exported
import type {
  SessionState,
  EventType,
  Session,
  SessionStatus,
  Turn,
  ToolCall,
  HookPayload,
  WorkspaceEntry,
  StatusResult,
  GroupedStatusResult,
  SessionsQueryOptions,
  IngestResult,
  BatchResult,
  BatchOptions,
  IngestOptions,
  QueryResult,
  FilterOptions,
  WhereClause,
  SummaryResult,
  ToolsResult,
  SessionAnalytics,
  SessionsAnalyticsResult,
  PatternsResult,
  TranscriptLine,
  TranscriptToolUse,
  TranscriptToolResult,
  TranscriptUsage,
  ParsedTurn,
  EventRow,
  AnalyticsCliOptions,
  SessionStartSource,
} from './index.ts';

describe('library API surface', () => {
  it('exports all database functions', () => {
    expect(typeof openDb).toBe('function');
    expect(typeof DEFAULT_DB_PATH).toBe('string');
    expect(typeof insertSession).toBe('function');
    expect(typeof upsertSession).toBe('function');
    expect(typeof getSession).toBe('function');
    expect(typeof updateSessionState).toBe('function');
    expect(typeof getActiveSessions).toBe('function');
    expect(typeof insertEvent).toBe('function');
    expect(typeof getSessionEvents).toBe('function');
    expect(typeof upsertWorkspace).toBe('function');
    expect(typeof getCachedWorkspace).toBe('function');
    expect(typeof getLatestSession).toBe('function');
    expect(typeof getSessionHistory).toBe('function');
    expect(typeof markStaleSessions).toBe('function');
    expect(typeof deleteStaleSessions).toBe('function');
    expect(typeof insertTurn).toBe('function');
    expect(typeof getSessionTurns).toBe('function');
    expect(typeof insertToolCall).toBe('function');
    expect(typeof getTurnToolCalls).toBe('function');
  });

  it('exports all command functions', () => {
    expect(typeof recordEvent).toBe('function');
    expect(typeof parsePayload).toBe('function');
    expect(typeof statusQuery).toBe('function');
    expect(typeof statusQueryGrouped).toBe('function');
    expect(typeof latestQuery).toBe('function');
    expect(typeof sessionsQuery).toBe('function');
    expect(typeof gcCommand).toBe('function');
    expect(typeof sweepCommand).toBe('function');
    expect(typeof parseSweepThreshold).toBe('function');
    expect(typeof ingestSession).toBe('function');
    expect(typeof ingestBatch).toBe('function');
    expect(typeof executeQuery).toBe('function');
  });

  it('exports all analytics functions', () => {
    expect(typeof parseDuration).toBe('function');
    expect(typeof buildWhereClause).toBe('function');
    expect(typeof parseAnalyticsOptions).toBe('function');
    expect(typeof summaryQuery).toBe('function');
    expect(typeof toolsQuery).toBe('function');
    expect(typeof sessionsAnalyticsQuery).toBe('function');
    expect(typeof patternsQuery).toBe('function');
  });

  it('exports workspace and transcript utilities', () => {
    expect(typeof resolveWorkspace).toBe('function');
    expect(typeof resolveWorkspaceFromGit).toBe('function');
    expect(typeof parseTranscriptLine).toBe('function');
    expect(typeof groupIntoTurns).toBe('function');
    expect(typeof extractToolDetail).toBe('function');
  });
});
```

**Step 2: Run the test**

Run: `npx vitest run src/index.test.ts`
Expected: PASS — all exports resolve, full workflow completes.

**Step 3: Commit**

```bash
git add src/index.test.ts
git commit -m "test: library API surface smoke test"
```
