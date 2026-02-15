# Phase 2: Build and Package Configuration

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Configure the build to produce both the CLI binary and the library module, with TypeScript declarations, so consumers can `import` from `@twiglylabs/sap`.

**Architecture:** Add a second esbuild invocation for the library entry point (ESM format). Generate `.d.ts` declarations via tsc. Update package.json exports.

**Tech Stack:** esbuild, TypeScript, Node.js

**Related:** [../design/approach.md](../design/approach.md), [./phase-1.md](./phase-1.md), [./phase-3.md](./phase-3.md)

---

### Task 1: Add library build to build.mjs

**Files:**
- Modify: `build.mjs`

**Step 1: Read the current build.mjs**

Current content:

```javascript
import * as esbuild from 'esbuild';
import { chmodSync } from 'fs';

await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/sap.cjs',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['better-sqlite3'],
  minify: process.argv.includes('--minify'),
});

chmodSync('dist/sap.cjs', 0o755);
```

**Step 2: Add the library build invocation**

Replace the entire file with:

```javascript
import * as esbuild from 'esbuild';
import { chmodSync } from 'fs';

const minify = process.argv.includes('--minify');

// CLI binary — unchanged
await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/sap.cjs',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['better-sqlite3'],
  minify,
});

chmodSync('dist/sap.cjs', 0o755);

// Library module — new
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  external: ['better-sqlite3'],
  sourcemap: true,
  minify,
});
```

**Step 3: Run the build**

Run: `node build.mjs`
Expected: `dist/sap.cjs`, `dist/index.js`, and `dist/index.js.map` all exist without errors.

**Step 4: Verify the library bundle doesn't contain CLI dependencies**

Run: `grep -c 'chalk\|commander' dist/index.js || echo "0"`
Expected: `0` — the library path never imports chalk or commander.

**Step 5: Verify the CLI bundle still works**

Run: `echo '{}' | node dist/sap.cjs record --event session-start 2>&1 || true`
Expected: Error message about missing session_id (not a crash). This proves
the CLI binary is still functional.

**Step 6: Commit**

```bash
git add build.mjs
git commit -m "feat: add library ESM build to build.mjs"
```

---

### Task 2: Generate TypeScript declarations

**Files:**
- Create: `tsconfig.build.json`
- Modify: `build.mjs`

**Step 1: Create tsconfig.build.json**

The base tsconfig has `noEmit: true` and `allowImportingTsExtensions: true`.
We need to override both for declaration emit. The codebase uses `.ts`
extension imports throughout (e.g., `import { openDb } from './db.ts'`),
which tsc can't emit as-is. TypeScript 5.7+ provides
`rewriteRelativeImportExtensions` to handle this — it rewrites `.ts` → `.js`
in the emitted `.d.ts` files.

Create `tsconfig.build.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "declaration": true,
    "emitDeclarationOnly": true,
    "noEmit": false,
    "allowImportingTsExtensions": false,
    "rewriteRelativeImportExtensions": true,
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src/index.ts"],
  "exclude": ["node_modules", "dist"]
}
```

> **Why `include: ["src/index.ts"]` and not `src/**/*.ts`?** With `src/**/*.ts`, tsc
> emits `.d.ts` files for every source file (db.d.ts, cli.d.ts, commands/status.d.ts,
> etc.) into `dist/`. Since `"files": ["dist"]` in package.json, all those internal
> declarations would ship to npm. By pointing only at the barrel file, tsc follows
> imports and emits declarations only for `index.d.ts` and the modules it re-exports —
> keeping the published package clean.

**Step 2: Add declaration generation to build.mjs**

Add this at the end of `build.mjs`:

```javascript
// TypeScript declarations
import { execSync } from 'child_process';
execSync('npx tsc -p tsconfig.build.json', { stdio: 'inherit' });
```

**Step 3: Run the full build**

Run: `node build.mjs`
Expected: `dist/index.d.ts` exists alongside `dist/index.js` and `dist/sap.cjs`.

**Step 4: Verify declarations contain expected exports**

Run: `grep 'openDb' dist/index.d.ts`
Expected: Line containing the openDb export.

Run: `grep 'Session' dist/index.d.ts`
Expected: Line exporting the Session type/interface.

**Step 5: Commit**

```bash
git add tsconfig.build.json build.mjs
git commit -m "feat: generate TypeScript declarations for library"
```

---

### Task 3: Update package.json exports

**Files:**
- Modify: `package.json`

**Step 1: Add main, types, and exports fields**

Add these fields to package.json (leaving existing fields intact):

```json
{
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  }
}
```

The full package.json should look like:

```json
{
  "name": "@twiglylabs/sap",
  "version": "0.2.0",
  "description": "Session Awareness Protocol — status tracking for Claude Code sessions",
  "type": "module",
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
  "files": ["dist"],
  "engines": {
    "node": ">=20"
  },
  "scripts": {
    "build": "node build.mjs",
    "build:prod": "node build.mjs --minify",
    "test": "vitest run",
    "test:e2e": "node build.mjs && npx vitest run src/library-e2e.test.ts",
    "dev": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "chalk": "^5.4.1",
    "commander": "^13.1.0",
    "esbuild": "^0.25.0",
    "typescript": "^5.7.3",
    "vitest": "^4.0.18"
  }
}
```

Note the version bump to `0.2.0` — this is a new capability (library API).

`chalk` and `commander` move to `devDependencies` because the CLI binary
(`dist/sap.cjs`) bundles them via esbuild — they're inlined into the output
file and not needed at runtime. The library entry point never imports them.
This prevents library consumers from downloading unused packages.

**Step 2: Verify dist/ is gitignored**

Run: `grep -q '^dist' .gitignore || echo 'dist/' >> .gitignore`
Expected: `dist/` is in `.gitignore`. If it wasn't already, stage the change.

**Step 3: Verify the full build works end-to-end**

Run: `node build.mjs`
Expected: All artifacts exist:
- `dist/sap.cjs` (CLI binary)
- `dist/index.js` (library ESM module)
- `dist/index.js.map` (sourcemap for library debugging)
- `dist/index.d.ts` (TypeScript declarations)

**Step 4: Commit**

```bash
git add package.json
git commit -m "feat: add library exports to package.json, bump to 0.2.0"
```

---

### Task 4: Verify library is importable from dist

**Files:**
- Create: `test-import.mjs` (temporary, not committed)

**Step 1: Write a quick import test script**

Create `test-import.mjs`:

```javascript
import { openDb, statusQuery, recordEvent, summaryQuery } from './dist/index.js';

const db = openDb(':memory:');

recordEvent(db, 'session-start', {
  session_id: 'import-test',
  cwd: '/tmp',
  transcript_path: '',
  permission_mode: 'default',
  hook_event_name: 'session-start',
  source: 'startup',
});

const status = statusQuery(db);
console.log('Sessions:', status.sessions.length);
console.log('State:', status.sessions[0].state);

// summaryQuery joins on the turns table, so a session that hasn't been
// ingested (no transcript → no turns) correctly returns 0 here.
const summary = summaryQuery(db, {});
console.log('Summary sessions:', summary.sessions.total);

db.close();
console.log('Library import test: PASS');
```

**Step 2: Run it**

Run: `node test-import.mjs`
Expected:
```
Sessions: 1
State: active
Summary sessions: 0
Library import test: PASS
```

(Summary is 0 because `summaryQuery` uses an INNER JOIN with the `turns` table —
sessions without ingested transcript data are not counted.)

**Step 3: Clean up**

Run: `rm test-import.mjs`

**Step 4: Run all existing tests to make sure nothing is broken**

Run: `npx vitest run`
Expected: All existing tests pass. The library additions are additive.

**Step 5: Commit (nothing to commit — test file was temporary)**

No commit needed for this task. If any fixes were required, commit those.
