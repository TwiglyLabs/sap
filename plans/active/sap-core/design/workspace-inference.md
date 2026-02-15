# sap — Workspace Inference

Last updated: 2026-02-14

## Problem

Claude Code hooks provide `cwd` (working directory). Emacs knows workspaces as `repo:branch` (e.g., `dotfiles:main`). sap must bridge this gap reliably, including across git worktrees where the same repo exists at multiple filesystem paths.

## Resolution Algorithm

```
sap record receives cwd from stdin JSON
    │
    ▼
Check workspaces table cache (by cwd)
    │ hit + not stale → return cached workspace
    │ miss or stale  ↓
    ▼
git -C <cwd> rev-parse --git-common-dir
    │ fails (not a git repo) → workspace = basename(cwd) + ":local"
    │ success ↓
    ▼
Resolve common_dir to absolute path
    │ relative (e.g. ".git") → resolve against cwd
    │ absolute → use as-is
    ▼
repo_name = basename(dirname(common_dir))
    │
    ▼
git -C <cwd> rev-parse --abbrev-ref HEAD
    │ "HEAD" (detached) → branch = "detached"
    │ branch name ↓
    ▼
workspace = repo_name + ":" + branch
    │
    ▼
Upsert into workspaces table cache
```

### Why `--git-common-dir` instead of `--show-toplevel`

`--show-toplevel` returns the worktree's own root directory, not the main repo root. This causes the repo name to vary by worktree location:

| Context | `--show-toplevel` | `basename` |
|---------|-------------------|------------|
| Main repo at `~/repos/sap` | `~/repos/sap` | `sap` |
| Worktree at `~/repos/sap-feat-x` | `~/repos/sap-feat-x` | `sap-feat-x` |

`--git-common-dir` always points to the main repo's `.git` directory, regardless of which worktree you're in:

| Context | `--git-common-dir` | `dirname` | `basename` |
|---------|-------------------|-----------|------------|
| Main repo at `~/repos/sap` | `.git` (→ `~/repos/sap/.git`) | `~/repos/sap` | `sap` |
| Worktree at `~/repos/sap-feat-x` | `~/repos/sap/.git` | `~/repos/sap` | `sap` |

This gives a stable `repo_name` across all worktrees of the same repo.

## Edge Cases

### Not a git repo
If `git rev-parse` fails (exit 128), use the directory basename as repo name and `local` as branch. Example: cwd `/Users/you/scratch` → workspace `scratch:local`.

### Detached HEAD
If `git rev-parse --abbrev-ref HEAD` returns literal `HEAD`, use `detached` as branch name. This is uncommon in worktree workflows but must not crash.

### Git worktrees
Each worktree has its own branch but shares the same repo identity via `--git-common-dir`. Worktree at `~/repos/sap-feat-x` on branch `feat-x` resolves to `sap:feat-x` — the same repo name as the main checkout. This is correct behavior: worktrees are different branches of the same project.

### Same repo, different clones
Two independent clones of the same repo at different paths will both resolve to the same repo name (basename of the parent of `.git`). If they're on different branches, the workspace names differ naturally. If on the same branch, latest-wins semantics apply (most recent session takes precedence).

### `--git-common-dir` returns relative path
In the main working tree, `--git-common-dir` returns `.git` (relative). In a worktree, it returns an absolute path. sap must resolve relative paths against cwd before extracting the repo name.

### Branch changes mid-session
The workspaces table caches cwd → workspace mappings. On `session-start` events, sap always re-resolves (ignores cache) to catch branch switches. Other events use the cache for speed.

If a user runs `git checkout` during an active session without starting a new Claude session, subsequent events will use the cached (now-stale) workspace name. This is acceptable: the session started on that branch, and branch-switching mid-session is an uncommon edge case. The next `session-start` will correct it.

### Permission errors
If `git` cannot be executed or the cwd is inaccessible, fall back to `unknown:unknown` and log a warning to stderr.

## Caching

The workspaces table avoids shelling out to `git` on every hook event (tool-use events can fire rapidly).

- **Cache hit**: Return immediately (sub-millisecond)
- **Cache miss**: Two `git` calls (~10ms total), then cache
- **Invalidation**: `session-start` always re-resolves; other events trust cache
- **No TTL**: Cache entries persist until overwritten. Branch changes are caught by session-start re-resolution.
