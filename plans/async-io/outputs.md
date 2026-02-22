
## API Changes
All SAP service methods that previously used sync I/O are now async. This is a **breaking API change** for library consumers — method return types changed from sync to `Promise<...>`.

### Changed Method Signatures

| Service | Method | Before | After |
|---------|--------|--------|-------|
| `WorkspaceService` | `resolveWorkspace()` | `string` | `Promise<string>` |
| `RecordingService` | `recordEvent()` | `void` | `Promise<void>` |
| `IngestionService` | `ingestSession()` | `Result<IngestResult>` | `Promise<Result<IngestResult>>` |
| `IngestionService` | `ingestBatch()` | `BatchResult` | `Promise<BatchResult>` |

### Exported Helper

| Function | Before | After |
|----------|--------|-------|
| `resolveWorkspaceFromGit()` | `WorkspaceResolution \| null` | `Promise<WorkspaceResolution \| null>` |

### New Behavior

- Transcript ingestion rejects files > 50MB with `err('Transcript too large: ...MB (limit: 50MB)')`.

### What Stays Sync

- `createSap()` — factory remains synchronous (better-sqlite3 is inherently sync)
- `SessionService` — all methods remain sync (pure DB queries)
- `AnalyticsService` — all methods remain sync (pure DB queries)
- CLI stdin reading (`readFileSync(0)`) — not called from Electron

### Consumer Migration

Canopy already uses `await` on `recordEvent()`, `resolveWorkspace()`, and `ingestSession()` calls, so this change is compatible in practice despite being a semver-breaking signature change.
