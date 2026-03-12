# Development

## Prerequisites

- Node.js >= 20
- npm

## Build

```bash
npm run build        # Dev build (esbuild → dist/)
npm run build:prod   # Minified production build
```

Build output goes to `dist/`. The CLI entry point is `dist/sap.cjs`. Library exports are in `dist/index.js` and `dist/features/*/index.js`.

## Test

```bash
npm run test         # Run all unit tests (vitest)
npm run test:e2e     # Build then run end-to-end tests against built artifacts
npm run dev          # Vitest watch mode
npm run lint         # TypeScript type-check (tsc --noEmit)
```

### Test organization

- **Unit tests:** `src/features/*/__tests__/` — co-located with each feature
- **Integration tests:** `test/` — cross-feature lifecycle, CLI contracts, e2e

Key test files:

| File | Purpose |
|------|---------|
| `test/index.test.ts` | Verifies all public API exports |
| `test/integration.test.ts` | Full session lifecycle |
| `test/cli.test.ts` | CLI JSON envelope and exit code contracts |
| `test/library-e2e.test.ts` | Tests against built dist artifacts |

Use `createSap({ dbPath: ':memory:' })` for isolated in-memory test databases.

## Adding a feature

1. Create `src/features/{name}/`
2. Define `{name}.repository.ts` with a repository interface
3. Implement `sqlite/{name}.repository.sqlite.ts` using `better-sqlite3`
4. Create `{name}.service.ts` taking the repository in its constructor
5. Create `index.ts` exporting the service, repository interface, and feature types
6. Wire it in `sap.ts`: instantiate repo adapter → create service → add to the return object
7. Add public types to `src/index.ts` if they belong to the library's public API
8. Add the subpath export to `package.json` `"exports"` field
9. Add CLI commands in `{name}.cli.ts` and register them in `cli.ts`
10. Add tests in `__tests__/`

See [Architecture](architecture.md) for the full feature folder convention.

## CLI output contract

All commands that accept `--json` produce JSON envelopes to stdout. The shape varies by command but is documented in the [CLI Reference](cli-reference.md). Errors always go to stderr as `{ "error": "..." }` with exit code `2`. The `query` command always outputs JSON regardless of flags.

## Dependencies

- **Runtime:** `better-sqlite3`, `@twiglylabs/log`
- **Dev/CLI:** `commander`, `chalk`, `esbuild`, `typescript`, `vitest`

`commander` and `chalk` are bundled into the CLI build but are not runtime dependencies of the library.
