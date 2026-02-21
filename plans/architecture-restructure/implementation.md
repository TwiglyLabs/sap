
## Summary
Implemented all 6 chunks as planned. Feature folder structure with repository pattern, createSap() factory, consolidated duration parsing, and curated barrel exports.

## Steps
1. Create `core/` directory with types, storage, config, utils
2. Create feature directories with repository interfaces and SQLite implementations
3. Create service classes with constructor-injected repositories
4. Create CLI handlers that accept services instead of raw db
5. Implement `createSap()` factory wiring repos → services
6. Rewrite `cli.ts` to use factory, delete old files
7. Write curated `index.ts` barrel, move tests to `test/`

## Testing
- 18 test files, 223 tests passing
- Unit tests for each feature: recording, sessions, ingestion, analytics
- Integration tests: lifecycle, data access, analytics, concurrent writers
- E2E tests against built dist artifact
- CLI integration tests via subprocess

## Done-when
- [x] All 6 chunks implemented
- [x] `npm test` passes (223/223)
- [x] `npm run build` succeeds
- [x] `npm run test:e2e` passes (6/6)
- [x] `tsc --noEmit` clean
- [x] No old files remain in `src/commands/`, `src/db.ts`, `src/types.ts`
