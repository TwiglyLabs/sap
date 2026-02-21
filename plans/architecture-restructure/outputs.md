
## From this plan
- `src/core/` - Shared types, storage, config, utils
- `src/features/` - 5 feature folders (sessions, recording, workspace, ingestion, analytics) each with repository interface, SQLite implementation, service class, and CLI handler
- `src/sap.ts` - `createSap()` factory and `Sap` interface
- `src/index.ts` - Curated public API barrel
- `test/` - Cross-feature integration tests
- 18 test files, 223 tests passing
