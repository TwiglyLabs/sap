---
title: Interface Cleanup
status: draft
description: >-
  Rationalize public API surface, consistent error handling, clean library
  contract
depends_on:
  - architecture-restructure
tags:
  - api
  - breaking-change
---

## Problem
The current public API exports 44 functions and 20+ types with no organization or intent. Internal implementation details (`insertSession`, `upsertWorkspace`, `buildWhereClause`) are exported alongside high-level operations (`summaryQuery`, `sweepCommand`). There's no consistent pattern for error handling or return types. A consumer importing `@twiglylabs/sap` has to guess which functions are meant for them.

Specific issues:
- **No layered API** — raw DB operations, business logic, and CLI utilities all exported at the same level
- **Inconsistent return types** — some functions return raw data, some return `{ error? }` objects, some throw
- **No namespace organization** — `import { summaryQuery, insertSession, parseDuration, resolveWorkspace } from '@twiglylabs/sap'` gives no hint about what belongs where
- **CLI output concerns leak into library** — `chalk` formatting in command modules that are also library exports
## Approach
Design the public API as a **layered, intentional surface** with clear tiers:

### Tier 1: High-level API (primary consumer interface)

The main thing `canopy` and other consumers use. Organized by feature namespace:

```typescript
import { createSap } from '@twiglylabs/sap';

const sap = createSap();              // opens DB, wires repositories
sap.sessions.status();                 // SessionStatus[]
sap.sessions.latest('repo:branch');    // Session | null
sap.recording.record(eventType, data); // void
sap.analytics.summary(filters);        // SummaryResult
sap.ingestion.ingest(sessionId);       // IngestResult
```

A `createSap(options?)` factory wires up the storage backend and returns a namespaced API object. This is the clean entry point.

### Tier 2: Service-level imports (advanced usage)

For consumers who need more control — individual services and repository interfaces:

```typescript
import { SessionService } from '@twiglylabs/sap/sessions';
import { type SessionRepository } from '@twiglylabs/sap/sessions';
```

Subpath exports via package.json `exports` field.

### Tier 3: Types only

All types available for consumers who need them:

```typescript
import type { Session, Turn, ToolCall } from '@twiglylabs/sap';
```

### Error handling convention

Services return result objects, never throw for expected failures:
- `{ data, error?: string }` pattern for operations that can fail
- Throwing reserved for programmer errors (invalid arguments, missing DB)

### What is NOT exported

- SQLite repository implementations (internal)
- CLI handlers (internal)
- Query builders, WHERE clause utilities (internal)
- `chalk` and formatting concerns (internal)

## Steps
### Chunk 1: Factory + Namespaced API

1. Design `SapOptions` type (db path, storage backend selection)
2. Implement `createSap(options?)` factory that:
   - Opens storage connection
   - Instantiates SQLite repositories
   - Instantiates services with injected repositories
   - Returns namespaced API object: `{ sessions, recording, ingestion, analytics, workspace }`
3. Each namespace exposes only the service's public methods
4. Add `close()` / `dispose()` method for cleanup
5. Write tests for factory wiring

### Chunk 2: Subpath Exports

1. Configure `package.json` `exports` field:
   - `.` → main barrel (createSap + types)
   - `./sessions` → SessionService + SessionRepository interface
   - `./recording` → RecordingService + RecordingRepository interface
   - `./analytics` → AnalyticsService + AnalyticsRepository interface
   - `./ingestion` → IngestionService + IngestionRepository interface
   - `./workspace` → WorkspaceService + WorkspaceRepository interface
2. Create per-feature barrel files for subpath exports
3. Update `build.mjs` to produce multiple entry points if needed
4. Update tsconfig for path resolution
5. Test: verify subpath imports work from a consumer perspective

### Chunk 3: Error Handling Consistency

1. Define result type convention: `Result<T> = { data: T } | { data: null, error: string }`
2. Audit each service method — ensure expected failures return error results, not throws
3. Ensure CLI layer handles result objects and formats errors for terminal output
4. Update tests for new return type patterns

### Chunk 4: CLI Contract Polish

1. Ensure every command supports `--json` flag for machine-readable output
2. Consistent exit codes: 0 success, 1 error, 2 no-data
3. Human output uses chalk formatting, JSON output is clean
4. Verify CLI binary works end-to-end after all changes
5. Update e2e tests
