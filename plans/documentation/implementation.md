
## Summary
All three chunks implemented:

1. **CLAUDE.md** — Agent-facing documentation covering architecture, feature folder convention, repository pattern, createSap() factory, testing, and commands.
2. **README.md** — Human-facing documentation with installation, CLI reference, library API, subpath imports, and configuration.
3. **JSDoc** — Terse doc comments on all public types, interfaces, services, repository contracts, and factory function.
## Steps
1. Wrote CLAUDE.md with architecture overview, feature folder convention, repository pattern, factory, testing, commands, and freshness date.
2. Wrote README.md with installation, CLI reference, library API, subpath imports, configuration, and database tables.
3. Added JSDoc to all public types in `core/types.ts`, `core/utils.ts`, all feature type files, all repository interfaces, all service classes and public methods, and the `createSap` factory in `sap.ts`.
## Testing
- `npm run lint` (tsc --noEmit): clean
- `npm test` (vitest run): 231/231 passing across 18 test files
- No regressions from JSDoc additions
## Done-when
- [x] CLAUDE.md written with architecture, conventions, commands, freshness date
- [x] README.md written with install, CLI reference, library API, configuration
- [x] JSDoc added to createSap, Sap, SapOptions, all domain types, all repository interfaces, all service classes and methods, all feature-specific types
- [x] Type checking passes
- [x] All tests pass
