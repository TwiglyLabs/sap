# Project Scaffolding

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Bootstrap the sap project with build tooling, test framework, and shared types.

**Architecture:** esbuild-bundled Node.js CLI (trellis pattern). Single `.cjs` output with better-sqlite3 externalized (native module). Commander for CLI, vitest for tests.

**Tech Stack:** Node.js 20+, TypeScript, esbuild, vitest, commander, better-sqlite3, chalk

**Related:** [../design/overview.md](../design/overview.md), [phase-1-database.md](./phase-1-database.md)

---

### Task 1: Create package.json

**Files:**
- Create: `package.json`

**Step 1: Write package.json**

```json
{
  "name": "@twiglylabs/sap",
  "version": "0.1.0",
  "description": "Session Awareness Protocol — status tracking for Claude Code sessions",
  "type": "module",
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
    "dev": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "better-sqlite3": "^11.0.0",
    "chalk": "^5.4.1",
    "commander": "^13.1.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.0",
    "@types/node": "^22.0.0",
    "esbuild": "^0.25.0",
    "typescript": "^5.7.3",
    "vitest": "^4.0.18"
  }
}
```

**Step 2: Commit**

```bash
git add package.json
git commit -m "chore: add package.json"
```

---

### Task 2: Create tsconfig.json

**Files:**
- Create: `tsconfig.json`

**Step 1: Write tsconfig.json**

Follow the trellis pattern — esbuild handles compilation, tsc is for type-checking only.

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "declaration": false,
    "sourceMap": false,
    "resolveJsonModule": true,
    "allowImportingTsExtensions": true,
    "noEmit": true
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

**Step 2: Commit**

```bash
git add tsconfig.json
git commit -m "chore: add tsconfig.json"
```

---

### Task 3: Create build.mjs

**Files:**
- Create: `build.mjs`

**Step 1: Write build.mjs**

Note: `better-sqlite3` is a native Node module with C++ bindings — it **cannot** be bundled by esbuild. It must be listed as external.

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

**Step 2: Commit**

```bash
git add build.mjs
git commit -m "chore: add esbuild config"
```

---

### Task 4: Create vitest.config.ts

**Files:**
- Create: `vitest.config.ts`

**Step 1: Write vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
  },
});
```

**Step 2: Commit**

```bash
git add vitest.config.ts
git commit -m "chore: add vitest config"
```

---

### Task 5: Create .gitignore

**Files:**
- Create: `.gitignore`

**Step 1: Write .gitignore**

```
node_modules/
dist/
*.db
*.db-wal
*.db-shm
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: add .gitignore"
```

---

### Task 6: Create shared types

**Files:**
- Create: `src/types.ts`

**Step 1: Write src/types.ts**

These types are derived directly from the design docs. Every other module imports from here.

```typescript
export type SessionState = 'active' | 'idle' | 'attention' | 'stopped';

export type EventType =
  | 'session-start'
  | 'session-end'
  | 'turn-complete'
  | 'attention-permission'
  | 'attention-idle'
  | 'user-prompt'
  | 'tool-use';

export type SessionStartSource = 'startup' | 'resume' | 'clear' | 'compact';

export interface HookPayload {
  session_id: string;
  cwd: string;
  transcript_path: string;
  permission_mode: string;
  hook_event_name: string;
  // SessionStart
  source?: SessionStartSource;
  model?: string;
  // SessionEnd
  reason?: string;
  // PostToolUse
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: Record<string, unknown>;
  // UserPromptSubmit
  prompt?: string;
  // Notification
  message?: string;
  notification_type?: string;
  // Stop
  stop_hook_active?: boolean;
}

export interface Session {
  session_id: string;
  workspace: string;
  cwd: string;
  transcript_path: string | null;
  state: SessionState;
  started_at: number;
  ended_at: number | null;
  last_event_at: number;
  last_tool: string | null;
  last_tool_detail: string | null;
}

export interface SessionStatus extends Session {
  stale: boolean;
}

export interface WorkspaceEntry {
  cwd: string;
  repo_name: string;
  branch: string;
  workspace: string;
  resolved_at: number;
}
```

**Step 2: Commit**

```bash
git add src/types.ts
git commit -m "feat: add shared type definitions"
```

---

### Task 7: Create CLI entry point stub

**Files:**
- Create: `src/cli.ts`

**Step 1: Write minimal src/cli.ts**

Just enough so the build works. Commands are wired up in phase-5.

```typescript
import { Command } from 'commander';

const program = new Command();

program
  .name('sap')
  .description('Session Awareness Protocol — status tracking for Claude Code sessions')
  .version('0.1.0');

program.parse();
```

**Step 2: Commit**

```bash
git add src/cli.ts
git commit -m "feat: add CLI entry point stub"
```

---

### Task 8: Install dependencies and verify build

**Step 1: Install**

```bash
npm install
```

**Step 2: Verify type-checking**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Verify build**

Run: `npm run build`
Expected: `dist/sap.cjs` created, no errors

**Step 4: Verify binary runs**

Run: `node dist/sap.cjs --help`
Expected: Shows help text with "Session Awareness Protocol" description

**Step 5: Verify tests run (empty suite)**

Run: `npm test`
Expected: No test suites found (or passes with 0 tests)

**Step 6: Commit**

```bash
git add package-lock.json
git commit -m "chore: install dependencies, verify build"
```
