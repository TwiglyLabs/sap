---
title: Interface Cleanup
status: not_started
description: >-
  Rationalize public API surface, consistent error handling, clean library
  contract
depends_on:
  - architecture-restructure
tags:
  - api
  - breaking-change
not_started_at: '2026-02-21T01:03:03.659Z'
---

## Problem
The current public API exports 43 functions/values and 31 types (74 exports total) with no organization or intent. Internal implementation details (`insertSession`, `upsertWorkspace`, `buildWhereClause`) are exported alongside high-level operations (`summaryQuery`, `sweepCommand`). There's no consistent pattern for error handling or return types. A consumer importing `@twiglylabs/sap` has to guess which functions are meant for them.

Specific issues:
- **No layered API** — raw DB operations, business logic, and CLI utilities all exported at the same level
- **Inconsistent return types** — some functions return raw data, some return `{ error? }` objects, some throw
- **No namespace organization** — `import { summaryQuery, insertSession, parseDuration, resolveWorkspace } from '@twiglylabs/sap'` gives no hint about what belongs where
- **CLI output concerns leak into library** — `chalk` formatting in command modules that are also library exports
## Approach
Design the public API as a **layered, intentional surface** with clear tiers. The `createSap()` factory and namespaced API are implemented as part of the architecture-restructure plan — this plan focuses on the remaining API polish: subpath exports, error handling consistency, and CLI contract polish.

### Tier 1: High-level API (primary consumer interface)

Delivered by `createSap()` (see architecture-restructure plan):

```typescript
import { createSap } from '@twiglylabs/sap';

const sap = createSap();
sap.sessions.status();
sap.recording.record(eventType, data);
sap.analytics.summary(filters);
```

### Tier 2: Service-level imports (advanced usage)

For consumers who need more control — individual services and repository interfaces via subpath exports:

```typescript
import { SessionService } from '@twiglylabs/sap/sessions';
import { type SessionRepository } from '@twiglylabs/sap/sessions';
```

Subpath exports via package.json `exports` field, backed by per-feature barrel files and multiple esbuild entry points.

### Tier 3: Types only

All types available for consumers who need them:

```typescript
import type { Session, Turn, ToolCall } from '@twiglylabs/sap';
```

### Error Handling Convention

Clear boundary between layers:
- **Repositories** return `T | null` for lookups, throw for programmer errors (invalid args, missing db)
- **Services** return result objects for operations that can fail:

```typescript
type Result<T> = { ok: true; data: T } | { ok: false; error: string };
```

The `ok` discriminant makes narrowing clean and works regardless of whether `T` is nullable:

```typescript
const result = sap.recording.record(eventType, data);
if (result.ok) {
  // result.data is T
} else {
  // result.error is string
}
```

Helper constructors: `ok<T>(data: T): Result<T>` and `err(error: string): Result<T>`.

- **CLI handlers** consume result objects, format errors for terminal output

### Consumer Migration

This is a breaking change. The barrel `index.ts` will only re-export `createSap`, `Sap` interface, `SapOptions`, and types. Individual function imports are removed — consumers migrate to `createSap()` or subpath service imports.

Canopy (planned consumer) does not yet exist as a separate package. No external migration is needed — the API is finalized before canopy is built. If canopy is created before this plan ships, coordinate imports at that time.

### What is NOT exported

- SQLite repository implementations (internal)
- CLI handlers (internal)
- Query builders, WHERE clause utilities (internal)
- `chalk` and formatting concerns (internal)

### Declaration Generation for Subpath Exports

Currently `tsconfig.build.json` only includes `src/index.ts` for declaration generation. Subpath exports require declarations for each entry point. Approach: add per-feature barrel files to `tsconfig.build.json` `include` array, emit `.d.ts` files alongside the JS bundles. The `package.json` `exports` field maps each subpath to both `import` (JS) and `types` (`.d.ts`) conditions.
## Steps
### Chunk 1: Subpath Exports + Build System

1. Configure `package.json` `exports` field:
   - `.` → main barrel (`createSap` + types), with `import` and `types` conditions
   - `./sessions` → `SessionService` + `SessionRepository` interface + session types
   - `./recording` → `RecordingService` + `RecordingRepository` interface + recording types
   - `./analytics` → `AnalyticsService` + `AnalyticsRepository` interface + analytics types
   - `./ingestion` → `IngestionService` + `IngestionRepository` interface + ingestion types
   - `./workspace` → `WorkspaceService` + `WorkspaceRepository` interface + workspace types
2. Create per-feature barrel files (e.g., `src/features/sessions/index.ts`) that re-export public surface
3. Update `build.mjs` to produce multiple ESM entry points via esbuild — one per subpath export. Each entry point is a separate `esbuild.build()` call or a single build with multiple `entryPoints`.
4. Update `tsconfig.build.json`: add per-feature barrel files to `include` array so `.d.ts` files are emitted for each subpath
5. Test: verify subpath imports resolve correctly from a consumer perspective (write a small script that imports from each subpath and checks types)

### Chunk 2: Result Type Convention

1. Define `Result<T>` type in `core/types.ts`:
   ```typescript
   type Result<T> = { ok: true; data: T } | { ok: false; error: string };
   ```
2. Add helper constructors in `core/utils.ts`:
   ```typescript
   function ok<T>(data: T): Result<T> { return { ok: true, data }; }
   function err<T = never>(error: string): Result<T> { return { ok: false, error }; }
   ```
3. Audit and convert service methods that can fail to return `Result<T>`:
   - `RecordingService.record()` → `Result<void>` (payload parsing can fail)
   - `IngestionService.ingest()` → `Result<IngestResult>` (currently returns IngestResult with `error?` field — align to Result)
   - `IngestionService.ingestBatch()` → keep `BatchResult` as-is (batch has its own pattern with `errors[]`)
   - `AnalyticsService` queries → keep returning data directly (read-only, unlikely to fail in expected ways)
   - `SessionService` queries → keep returning `T | null` for lookups (this is the repository pattern, not a failure)
4. Rule: only convert methods where *expected* failures exist (bad input, missing transcript file, parse errors). Don't wrap everything.
5. Update CLI handlers to consume `Result<T>` — check `result.ok` before accessing data
6. Update affected tests

### Chunk 3: CLI Contract Polish

Concrete fixes based on audit of current CLI (all findings verified against source):

**JSON output shape inconsistencies to fix:**
- `latest --json` outputs raw session object or `null` — wrap in `{ session: ... }` for consistency with other commands
- `query` outputs raw array on success — wrap in `{ rows: [...] }` (already does this internally via `QueryResult`, just not in JSON output)

**Exit code inconsistencies to fix:**
- `record` uses `process.exit(2)` for all errors (invalid event type, stdin failure, processing error)
- `query` uses `process.exitCode = 1` for errors
- All other commands: implicit 0 even on errors
- Standardize: `process.exitCode = 1` for user errors (bad input, not found), `process.exitCode = 2` for internal errors (db failure). Never use `process.exit()` (prevents cleanup).

**Already correct (no changes needed):**
- All commands support `--json` flag
- All JSON output is clean — no ANSI codes leak into JSON (chalk is only used in non-JSON paths)
- Human output consistently uses chalk for formatting
- `JSON.stringify(result, null, 2)` used consistently for pretty-printed JSON

**Steps:**
1. Wrap `latest --json` output in `{ session: ... }` envelope
2. Change `query` JSON output to use the existing `QueryResult` shape (already returns `{ rows, error? }`)
3. Replace `process.exit(2)` in record command with `process.exitCode = 2` + return
4. Add `process.exitCode = 1` for user-facing errors across commands (session not found, invalid input)
5. Update `cli.test.ts` and any e2e tests that check JSON shapes or exit codes
6. Verify CLI binary works end-to-end

### Chunk 4: Final API Surface

1. Remove all legacy individual function exports from `index.ts` — only export `createSap`, `Sap` interface, `SapOptions`, and types
2. Verify no dangling imports exist (run build, check for unresolved imports)
3. Final review of public API surface — ensure nothing internal leaks out
4. Run full test suite + build
5. Verify `library-e2e.test.ts` still passes (checks that dist bundle doesn't contain chalk/commander)
