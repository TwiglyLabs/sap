## Steps
### Chunk 1: Async workspace + recording

**Source files to modify:**
- `src/features/workspace/workspace.service.ts` — async `execGit`, `resolveWorkspaceFromGit`, `resolveWorkspace`
- `src/features/recording/recording.service.ts` — async `recordEvent`, `handleSessionStart`
- `src/features/recording/recording.cli.ts` — async `recordCli`
- `src/cli.ts` — async `record` action handler

**Test files to update (async/await):**
- `src/features/workspace/__tests__/workspace.service.test.ts`
- `src/features/recording/__tests__/recording.service.test.ts`
- `test/integration.test.ts` — ~15 `recordEvent` calls
- `test/library-lifecycle.test.ts` — ~10 `recordEvent` calls
- `test/library-analytics.test.ts` — `recordEvent` + `ingestSession` calls (shared with chunk 2)
- `test/library-data-access.test.ts` — `recordEvent` calls (shared with chunk 2)
- `test/analytics-integration.test.ts` — `recordEvent` + `ingestSession` calls (shared with chunk 2)
- `test/library-e2e.test.ts` — `recordEvent` calls (runs against built dist, may need rebuild)

**Implementation order:**
1. Start with `workspace.service.ts` (leaf dependency)
2. Update workspace unit tests → verify they pass
3. Update `recording.service.ts` (depends on workspace)
4. Update recording unit tests → verify they pass
5. Update `recording.cli.ts` and `cli.ts`
6. Update all integration test files that call `recordEvent`
7. Run full test suite

### Chunk 2: Async ingestion + size guard

**Source files to modify:**
- `src/features/ingestion/ingestion.service.ts` — async `ingestSession`, `ingestBatch`, fs.promises, size guard
- `src/features/ingestion/ingestion.cli.ts` — async `ingestCli`
- `src/cli.ts` — async `ingest` action handler

**Test files to update (async/await):**
- `src/features/ingestion/__tests__/ingestion.service.test.ts`
- `test/library-analytics.test.ts` — `ingestSession` calls
- `test/library-data-access.test.ts` — `ingestSession` + `ingestBatch` calls
- `test/analytics-integration.test.ts` — `ingestSession` calls
- `test/library-e2e.test.ts` — `ingestSession` call

**Implementation order:**
1. Update `ingestion.service.ts` with async + size guard
2. Update ingestion unit tests → verify they pass
3. Update `ingestion.cli.ts` and `cli.ts`
4. Update remaining integration test files that call `ingestSession`/`ingestBatch`
5. Run full test suite

**Note:** Several integration test files are shared between chunks (library-analytics, library-data-access, analytics-integration, library-e2e). These should be updated once after both chunks are done, or updated incrementally as needed.

### Cross-cutting: final verification

After both chunks:
1. `npm run lint` — full type-check, no errors
2. `npm run test` — all unit + integration tests pass
3. `npm run test:e2e` — build + e2e tests pass against dist artifacts
4. Verify no `execFileSync`, `readFileSync`, or `existsSync` remain in workspace/ingestion source files
## Testing
**Unit tests (must pass per-chunk):**
- `src/features/workspace/__tests__/workspace.service.test.ts` — async resolveWorkspace, resolveWorkspaceFromGit
- `src/features/recording/__tests__/recording.service.test.ts` — async recordEvent for all event types
- `src/features/ingestion/__tests__/ingestion.service.test.ts` — async ingest + size guard test

**New test case:**
- Transcript size guard: session pointing to a file exceeding 50MB returns `err('Transcript too large: ...')`. Implementation: create a temp file, use `fs.truncateSync(path, 51 * 1024 * 1024)` to create a sparse 51MB file, then verify `ingestSession` returns the expected error.

**Integration tests (both chunks done):**
- `test/integration.test.ts` — session lifecycle with async recordEvent
- `test/library-lifecycle.test.ts` — full lifecycle with async calls
- `test/library-analytics.test.ts` — analytics with async recordEvent + ingestSession
- `test/library-data-access.test.ts` — data access with async calls
- `test/analytics-integration.test.ts` — analytics pipeline with async calls
- `test/concurrent.test.ts` — should still pass (tests DB concurrency)
- `test/cli.test.ts` — CLI contract tests (invoke binary, async is internal — should pass unchanged)
- `test/index.test.ts` — export surface (should pass unchanged)

**E2E (final gate):**
- `npm run test:e2e` — builds dist and tests against built artifacts

**Type check:**
- `npm run lint` — must pass with no errors

**Total test files affected:** ~12 files need async/await changes. Most changes are mechanical (add `await` before method calls, add `async` to test callbacks).
## Done-when
1. `execFileSync` is gone from `workspace.service.ts` — replaced with async `execFile`
2. `readFileSync`/`existsSync` are gone from `ingestion.service.ts` — replaced with `fs.promises.*`
3. Transcript ingestion rejects files > 50MB with a descriptive error Result
4. All existing tests pass with async/await adjustments
5. New size guard test exists and passes
6. `npm run lint` passes (full type-check)
7. `npm run test` passes (all unit + integration tests)
8. `npm run test:e2e` passes (build + e2e)
9. No sync child_process or sync fs calls remain in workspace or ingestion service files
