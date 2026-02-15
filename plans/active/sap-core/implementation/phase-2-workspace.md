# Phase 2: Workspace Inference & Tool Detail Extraction

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Resolve `cwd` to `repo:branch` workspace identifiers using git, with caching. Extract human-readable detail from tool_input payloads.

**Architecture:** `workspace.ts` shells out to git for resolution, uses the db workspace cache for speed. `tool-detail.ts` is a pure function with no dependencies. Both are consumed by the record command in phase 3.

**Tech Stack:** `child_process.execFileSync` for git, vitest

**Related:** [../design/workspace-inference.md](../design/workspace-inference.md), [phase-1-database.md](./phase-1-database.md) (prerequisite), [phase-3-record.md](./phase-3-record.md) (next)

---

### Task 1: Write failing test for git-based workspace resolution

**Files:**
- Create: `src/workspace.test.ts`

**Step 1: Write the failing test**

We test `resolveWorkspaceFromGit` which runs the actual git commands. This test runs against the real repo (the sap repo itself), so results depend on the current git state.

```typescript
import { describe, it, expect } from 'vitest';
import { resolveWorkspaceFromGit } from './workspace.ts';

describe('resolveWorkspaceFromGit', () => {
  it('resolves the current repo', () => {
    const result = resolveWorkspaceFromGit(process.cwd());
    expect(result).not.toBeNull();
    expect(result!.repo_name).toBeTruthy();
    expect(result!.branch).toMatch(/^[a-zA-Z0-9_./-]+$/);
    expect(result!.workspace).toBe(`${result!.repo_name}:${result!.branch}`);
  });

  it('returns null for a non-git directory', () => {
    const result = resolveWorkspaceFromGit('/tmp');
    expect(result).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace.test.ts`
Expected: FAIL — `Cannot find module './workspace.ts'`

---

### Task 2: Implement resolveWorkspaceFromGit

**Files:**
- Create: `src/workspace.ts`

**Step 1: Write implementation**

```typescript
import { execFileSync } from 'child_process';
import { basename, dirname, resolve, isAbsolute } from 'path';
import type Database from 'better-sqlite3';
import { getCachedWorkspace, upsertWorkspace } from './db.ts';
import type { WorkspaceEntry } from './types.ts';

interface WorkspaceResolution {
  repo_name: string;
  branch: string;
  workspace: string;
}

function execGit(cwd: string, args: string[]): string | null {
  try {
    return execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf-8',
      timeout: 5000,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return null;
  }
}

export function resolveWorkspaceFromGit(cwd: string): WorkspaceResolution | null {
  const commonDir = execGit(cwd, ['rev-parse', '--git-common-dir']);
  if (commonDir === null) return null;

  // --git-common-dir returns relative path in main worktree (e.g. ".git"),
  // absolute path in worktrees. Resolve to absolute.
  const absCommonDir = isAbsolute(commonDir) ? commonDir : resolve(cwd, commonDir);
  const repoName = basename(dirname(absCommonDir));

  const branchRaw = execGit(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const branch = branchRaw === 'HEAD' ? 'detached' : (branchRaw ?? 'unknown');

  return {
    repo_name: repoName,
    branch,
    workspace: `${repoName}:${branch}`,
  };
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/workspace.test.ts`
Expected: PASS (2 tests)

**Step 3: Commit**

```bash
git add src/workspace.ts src/workspace.test.ts
git commit -m "feat: add git-based workspace resolution"
```

---

### Task 3: Write failing test for resolveWorkspace (cached path)

**Files:**
- Modify: `src/workspace.test.ts`

**Step 1: Add cached resolution tests**

The `resolveWorkspace` function is the main entry point — it checks the cache first, then falls back to git. For testability, it takes a `db` instance.

```typescript
import { resolveWorkspaceFromGit, resolveWorkspace } from './workspace.ts';
import { openDb } from './db.ts';
import type Database from 'better-sqlite3';
import { beforeEach } from 'vitest';
import { getCachedWorkspace, upsertWorkspace } from './db.ts';

describe('resolveWorkspace', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('returns cached workspace when available', () => {
    upsertWorkspace(db, {
      cwd: '/cached/path',
      repo_name: 'cached-repo',
      branch: 'feat',
      workspace: 'cached-repo:feat',
      resolved_at: Date.now(),
    });

    // forceResolve=false uses cache
    const result = resolveWorkspace(db, '/cached/path', false);
    expect(result).toBe('cached-repo:feat');
  });

  it('resolves from git and caches when no cache exists', () => {
    const result = resolveWorkspace(db, process.cwd(), false);
    expect(result).toMatch(/^sap:/);

    // Verify it was cached
    const cached = getCachedWorkspace(db, process.cwd());
    expect(cached).not.toBeNull();
    expect(cached!.workspace).toBe(result);
  });

  it('force-resolves from git when forceResolve=true (ignores cache)', () => {
    // Seed cache with stale data
    upsertWorkspace(db, {
      cwd: process.cwd(),
      repo_name: 'stale',
      branch: 'old',
      workspace: 'stale:old',
      resolved_at: 1000,
    });

    const result = resolveWorkspace(db, process.cwd(), true);
    expect(result).toMatch(/^sap:/);
    expect(result).not.toBe('stale:old');
  });

  it('returns fallback for non-git directory', () => {
    const result = resolveWorkspace(db, '/tmp', false);
    expect(result).toBe('tmp:local');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/workspace.test.ts`
Expected: FAIL — `resolveWorkspace is not exported`

---

### Task 4: Implement resolveWorkspace

**Files:**
- Modify: `src/workspace.ts`

**Step 1: Add the resolveWorkspace function**

Append to `src/workspace.ts`:

```typescript
export function resolveWorkspace(db: Database.Database, cwd: string, forceResolve: boolean): string {
  // Check cache unless force-resolving (session-start always force-resolves)
  if (!forceResolve) {
    const cached = getCachedWorkspace(db, cwd);
    if (cached) return cached.workspace;
  }

  const resolved = resolveWorkspaceFromGit(cwd);

  if (resolved) {
    upsertWorkspace(db, {
      cwd,
      repo_name: resolved.repo_name,
      branch: resolved.branch,
      workspace: resolved.workspace,
      resolved_at: Date.now(),
    });
    return resolved.workspace;
  }

  // Non-git fallback: basename(cwd):local
  const fallback = `${basename(cwd)}:local`;
  upsertWorkspace(db, {
    cwd,
    repo_name: basename(cwd),
    branch: 'local',
    workspace: fallback,
    resolved_at: Date.now(),
  });
  return fallback;
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/workspace.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/workspace.ts src/workspace.test.ts
git commit -m "feat: add cached workspace resolution with git fallback"
```

---

### Task 5: Write failing tests for tool detail extraction

**Files:**
- Create: `src/tool-detail.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect } from 'vitest';
import { extractToolDetail } from './tool-detail.ts';

describe('extractToolDetail', () => {
  it('extracts file_path basename for Edit', () => {
    expect(extractToolDetail('Edit', { file_path: '/home/user/src/app.ts' })).toBe('app.ts');
  });

  it('extracts file_path basename for Read', () => {
    expect(extractToolDetail('Read', { file_path: '/a/b/config.json' })).toBe('config.json');
  });

  it('extracts file_path basename for Write', () => {
    expect(extractToolDetail('Write', { file_path: '/x/y/z.md' })).toBe('z.md');
  });

  it('extracts pattern for Glob', () => {
    expect(extractToolDetail('Glob', { pattern: '**/*.ts' })).toBe('**/*.ts');
  });

  it('extracts pattern for Grep', () => {
    expect(extractToolDetail('Grep', { pattern: 'function\\s+' })).toBe('function\\s+');
  });

  it('extracts and truncates command for Bash', () => {
    expect(extractToolDetail('Bash', { command: 'npm test' })).toBe('npm test');
    const long = 'x'.repeat(120);
    expect(extractToolDetail('Bash', { command: long })).toHaveLength(80);
  });

  it('extracts description for Task', () => {
    expect(extractToolDetail('Task', { description: 'Run tests' })).toBe('Run tests');
  });

  it('extracts hostname for WebFetch', () => {
    expect(extractToolDetail('WebFetch', { url: 'https://docs.example.com/path' })).toBe('docs.example.com');
  });

  it('extracts query for WebSearch', () => {
    expect(extractToolDetail('WebSearch', { query: 'react hooks api' })).toBe('react hooks api');
  });

  it('returns null for unknown tool', () => {
    expect(extractToolDetail('UnknownTool', {})).toBeNull();
  });

  it('returns null when expected field is missing', () => {
    expect(extractToolDetail('Edit', {})).toBeNull();
  });

  it('returns null for null/undefined input', () => {
    expect(extractToolDetail('Edit', undefined)).toBeNull();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/tool-detail.test.ts`
Expected: FAIL — `Cannot find module './tool-detail.ts'`

---

### Task 6: Implement tool detail extraction

**Files:**
- Create: `src/tool-detail.ts`

**Step 1: Write implementation**

```typescript
import { basename } from 'path';

export function extractToolDetail(
  toolName: string,
  toolInput: Record<string, unknown> | undefined | null,
): string | null {
  if (!toolInput) return null;

  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'Read': {
      const fp = toolInput.file_path;
      return typeof fp === 'string' ? basename(fp) : null;
    }
    case 'Glob': {
      const p = toolInput.pattern;
      return typeof p === 'string' ? p : null;
    }
    case 'Grep': {
      const p = toolInput.pattern;
      return typeof p === 'string' ? p : null;
    }
    case 'Bash': {
      const cmd = toolInput.command;
      return typeof cmd === 'string' ? cmd.slice(0, 80) : null;
    }
    case 'Task': {
      const desc = toolInput.description;
      return typeof desc === 'string' ? desc : null;
    }
    case 'WebFetch': {
      const url = toolInput.url;
      if (typeof url !== 'string') return null;
      try {
        return new URL(url).hostname;
      } catch {
        return null;
      }
    }
    case 'WebSearch': {
      const q = toolInput.query;
      return typeof q === 'string' ? q.slice(0, 80) : null;
    }
    default:
      return null;
  }
}
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/tool-detail.test.ts`
Expected: PASS (all tests)

**Step 3: Commit**

```bash
git add src/tool-detail.ts src/tool-detail.test.ts
git commit -m "feat: add tool detail extraction"
```
