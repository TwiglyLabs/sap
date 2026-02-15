# library-api — Packaging and Build Approach

Last updated: 2026-02-15

## The Problem

Currently the package ships a single artifact: `dist/sap.cjs` — a bundled CLI
binary with a shebang. It's listed as `"bin"` in package.json but has no
`"main"` or `"exports"` entry. You can't `import` anything from `@twiglylabs/sap`.

## The Solution

Add a library entry point alongside the CLI binary. The package ships both:

```
dist/
  sap.cjs         ← CLI binary (unchanged)
  index.js        ← library entry (ESM, new)
  index.js.map    ← sourcemap for debugging (new)
  index.d.ts      ← TypeScript declarations (new)
```

### package.json Changes

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "bin": {
    "sap": "./dist/sap.cjs"
  },
  "files": ["dist"]
}
```

### Build Changes

The build script (`build.mjs`) gains a second esbuild invocation for the
library entry point. The library build:

- Entry: `src/index.ts`
- Format: ESM (matches `"type": "module"` in package.json)
- External: `better-sqlite3` (native addon, can't bundle)
- No shebang, no chmod
- Generates alongside existing CLI build

TypeScript declarations are generated separately via `tsc -p tsconfig.build.json`
using `emitDeclarationOnly`. Because the codebase uses `.ts` extension imports,
`tsconfig.build.json` sets `rewriteRelativeImportExtensions: true` (TS 5.7+) to
rewrite `.ts` → `.js` in the emitted `.d.ts` files.

### Why ESM for the Library (ESM-Only — No CJS)

The CLI uses CJS (`dist/sap.cjs`) because it's a bundled executable and CJS
is simpler for shebang scripts. The library uses ESM because:

1. The package is `"type": "module"` already
2. Electron apps use ESM
3. Modern Node.js consumers expect ESM
4. Tree-shaking works with ESM

The library **does not ship a CJS entry point**. The `exports` map only has an
`"import"` condition — `require('@twiglylabs/sap')` will fail. This is a
deliberate decision: the primary consumer is an Electron app (ESM), and
maintaining a dual CJS/ESM build adds complexity with no current use case. If
a CJS consumer appears in the future, add a `"require"` condition pointing at
a separate CJS build.

### Why esbuild for the Library (Single-File ESM)

The CLI bundles everything into one file because it's a standalone executable.
The library is consumed by build tools (Vite, webpack, esbuild) that handle
their own bundling, so deep bundling isn't strictly necessary. We still use
esbuild to produce a single-file ESM bundle because:

1. Consistent build tooling (same tool for CLI and library)
2. Handles `.ts` extension imports (which tsc doesn't strip)
3. Single output file keeps `"main"` simple
4. Consumers can still tree-shake ESM imports

### What About chalk/commander?

The library entry point (`src/index.ts`) only re-exports business logic
functions and types. It never imports from command CLI functions (the `*Cli`
functions), so `chalk` and `commander` are never pulled into the library path.

If a consumer imports `@twiglylabs/sap`, they get functions that depend only on
`better-sqlite3` and Node.js built-ins.

## Tree-Shake Verification

The library surface should be verified to not accidentally pull in CLI
dependencies. The e2e test (`src/library-e2e.test.ts`) reads the built
`dist/index.js` and asserts it does not contain the strings "chalk" or
"commander".

## Type Export Strategy

All types are already defined in `src/types.ts` and in individual command files
(e.g., `SummaryResult` in `analytics-summary.ts`). The library entry point
re-exports them with `export type { ... }` to make clear they're type-only
exports.

Result types that are currently internal interfaces (not exported from their
modules) need to be promoted to exports. Specifically:

- `StatusResult` in `status.ts` — currently a local interface
- `GroupedStatusResult` in `status.ts` — currently a local interface

These need `export` added to their interface declarations.
