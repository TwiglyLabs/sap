---
title: Async I/O for Electron Integration
status: done
description: >-
  Replace synchronous git exec and file I/O in SAP with async equivalents to
  avoid blocking Electron's main thread.
tags:
  - 'epic:responsive-app'
  - cross-repo
type: feature
not_started_at: '2026-02-22T22:57:02.617Z'
completed_at: '2026-02-22T23:07:45.267Z'
---

## Problem
SAP has synchronous blocking operations that freeze Electron's main thread when called from Canopy's IPC handlers.

**Blocking operations found:**

### 1. `execFileSync('git', ...)` in workspace resolution (CRITICAL)
`src/features/workspace/workspace.service.ts` — `execGit()` function:
```typescript
execFileSync('git', args, { timeout: 5_000, ... })
```
Called **twice** per workspace resolution:
- `git rev-parse --git-common-dir` (resolve workspace root)
- `git rev-parse --abbrev-ref HEAD` (resolve current branch)

Each has a 5-second timeout. Total blocking: up to **10 seconds** per workspace. Called from Canopy via `sap.workspace.resolveWorkspace(cwd, false)` in the `sap:workspace-attention` IPC handler.

### 2. `mkdirSync` in storage initialization
`src/core/storage.ts:77` — `openDb()` function:
```typescript
mkdirSync(dirname(path), { recursive: true })
```
Called during `createSap()` on first initialization. Blocks main thread while creating `.sap/` directory.

### 3. `existsSync` + `readFileSync` in transcript ingestion
`src/features/ingestion/ingestion.service.ts:28,32`:
```typescript
existsSync(session.transcript_path)    // line 28
readFileSync(session.transcript_path, 'utf-8')  // line 32
```
Reads entire JSONL transcript file with **no size limit**. Large transcripts (100MB+) could block for seconds.

### 4. `statSync` polling in Canopy's SAP service
`canopy/src/main/services/sap.ts:174` — `checkMtime()`:
```typescript
statSync(SAP_DB_PATH)  // called every 5 seconds via setInterval
```
Recurring sync I/O on the main thread. Small individually but cumulative.

### Impact on Canopy
The workspace resolution path is the most dangerous — it's called from IPC handlers that fire during normal app usage, not just startup. Two blocking git processes with 5s timeouts each means a single workspace attention query can freeze the app for up to 10 seconds.
## Approach
Replace sync I/O with async equivalents where the blocking impact justifies the change. SAP's public service methods change from sync to async — this is a **breaking API change** (semver major for library consumers, but Canopy already uses `await` so it's compatible in practice).

**Design principles:**

1. **Replace `execFileSync` with promisified `execFile`** — the git commands in workspace resolution become async. This is the highest-impact fix.
2. **Replace sync FS with `fs.promises.*`** in ingestion — `readFile`, `stat`, `access`.
3. **Add transcript size guard** — before reading a transcript file, check size with `stat` and return an error Result if file exceeds 50MB.
4. **Accept that `better-sqlite3` is synchronous** — the Database constructor, pragmas, and schema exec are all inherently sync. Making `mkdirSync` async while `new Database(path)` stays sync gains nothing. `openDb()` and `createSap()` stay synchronous.
5. **Handle cascading signature changes** — `resolveWorkspace()` becoming async forces `RecordingService.recordEvent()` async. `ingestSession()` async forces `ingestBatch()` async. All CLI handlers and tests must follow.

**What stays sync (intentionally):**

| Location | Why |
|----------|-----|
| `storage.ts` `openDb()` | `better-sqlite3` is fundamentally sync. `mkdirSync` is <1ms on existing dirs. Making just the mkdir async while `new Database()` stays sync is pointless — and forces every `createSap()` callsite async for zero real benefit. |
| `recording.cli.ts` `readFileSync(0)` | CLI stdin is OS-buffered. This isn't called from Electron. Fine as-is. |
| All `better-sqlite3` DB operations | The sync nature of `better-sqlite3` is a feature (no callback hell for DB queries). Moving to async SQLite is a separate, much larger effort. |

**What changes:**

| Location | Before | After |
|----------|--------|-------|
| `workspace.service.ts` `execGit()` | `execFileSync('git', ...)` | `await execFileAsync('git', ...)` |
| `workspace.service.ts` `resolveWorkspaceFromGit()` | returns `WorkspaceResolution \| null` | returns `Promise<WorkspaceResolution \| null>` |
| `workspace.service.ts` `resolveWorkspace()` | returns `string` | returns `Promise<string>` |
| `recording.service.ts` `recordEvent()` | `void` | `Promise<void>` (awaits workspace resolution) |
| `ingestion.service.ts` `ingestSession()` | `Result<IngestResult>` | `Promise<Result<IngestResult>>` |
| `ingestion.service.ts` `ingestBatch()` | `BatchResult` | `Promise<BatchResult>` |
| CLI handlers | sync actions | async actions (await service calls) |
## Steps
### Chunk 1: Async workspace resolution + recording cascade

**Goal:** Eliminate 0-10s blocking from git process spawning. Handle the recording service cascade.

**workspace.service.ts:**
1. Replace `execFileSync` with promisified `execFile`:
   ```typescript
   import { execFile } from 'node:child_process';
   import { promisify } from 'node:util';
   const execFileAsync = promisify(execFile);
   
   async function execGit(cwd: string, args: string[]): Promise<string | null> {
     try {
       const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
         encoding: 'utf-8',
         timeout: 5000,
       });
       return stdout.trim();
     } catch {
       return null;
     }
   }
   ```
2. Make `resolveWorkspaceFromGit()` async → returns `Promise<WorkspaceResolution | null>`.
3. Make `WorkspaceService.resolveWorkspace()` async → returns `Promise<string>`.

**recording.service.ts (cascade):**
4. Make `RecordingService.recordEvent()` async → returns `Promise<void>`.
5. In the `session-start` branch, `await` the workspace resolution before entering the sync transaction:
   ```typescript
   if (eventType === 'session-start') {
     const workspace = await this.workspaceService.resolveWorkspace(data.cwd, true);
     this.repo.transaction(() => {
       this.handleSessionStart(data, now, workspace);
     });
     return;
   }
   ```
   `handleSessionStart` and all other private helpers stay synchronous — they receive resolved data and operate within sync `better-sqlite3` transactions. Only `recordEvent()` itself is async.

**recording.cli.ts (cascade):**
6. Make `recordCli()` async. The CLI action handler already supports async (Commander.js awaits action return values).

**cli.ts (cascade):**
7. Make the `record` command action async: `async (options) => { ... await recordCli(...); ... }`.

**Tests:**
8. Update `workspace.service.test.ts`: add `async`/`await` to all `resolveWorkspace*` calls.
9. Update `recording.service.test.ts`: add `async`/`await` to all `recordEvent` calls.

### Chunk 2: Async transcript ingestion with size guard

**Goal:** Stop blocking on large transcript reads. Add safety valve for huge files.

**ingestion.service.ts:**
1. Replace `existsSync` with `await fs.promises.access(path, fs.constants.F_OK)` wrapped in try/catch.
2. Add size guard before reading: `const { size } = await fs.promises.stat(path)`. If `size > 50 * 1024 * 1024` (50MB), return `err('Transcript too large: ${(size / 1024 / 1024).toFixed(1)}MB (limit: 50MB)')`. This prevents runaway memory on corrupted or enormous transcripts.
3. Replace `readFileSync` with `await fs.promises.readFile(path, 'utf-8')`.
4. Make `ingestSession()` async → returns `Promise<Result<IngestResult>>`.
5. Make `ingestBatch()` async → returns `Promise<BatchResult>`. Sessions are ingested sequentially (not Promise.all) to avoid memory pressure from multiple large files.

**ingestion.cli.ts (cascade):**
6. Make `ingestCli()` async.

**cli.ts (cascade):**
7. Make the `ingest` command action async.

**Tests:**
8. Update `ingestion.service.test.ts`: add `async`/`await` to all `ingestSession`/`ingestBatch` calls.
9. Add test for the size guard: create a mock session pointing to a file that would exceed the limit (can use `stat` mock or a small threshold override).

---

**Out of scope (separate plan):**
- Canopy's `statSync` polling in `canopy/src/main/services/sap.ts` — this is in the canopy repo. Track as a downstream task that unblocks after this plan ships.

**Version bump:** Deferred to merge time. This is a breaking API change (method return types change from sync to async), but the only consumer (Canopy) already uses `await` on these calls, so the breaking change is compatible in practice. Bump 0.2.0 → 0.3.0 at minimum.
