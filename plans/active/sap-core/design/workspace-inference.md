# sap — Workspace Inference

Last updated: 2026-02-14

## Problem

Claude Code hooks provide `cwd` (working directory). Emacs knows workspaces as `repo:branch` (e.g., `dotfiles:main`). sap must bridge this gap reliably.

## Resolution Algorithm

```
sap record receives cwd from stdin JSON
    │
    ▼
Check workspaces table cache (by cwd)
    │ hit + not stale → return cached workspace
    │ miss or stale  ↓
    ▼
git -C <cwd> rev-parse --show-toplevel
    │ exit 128 (not a git repo) → workspace = basename(cwd) + ":home"
    │ exit 0 ↓
    ▼
git -C <cwd> rev-parse --abbrev-ref HEAD
    │ "HEAD" (detached) → branch = "detached"
    │ branch name ↓
    ▼
repo_name = basename(git_toplevel)
branch = git_branch
workspace = repo_name + ":" + branch
    │
    ▼
Upsert into workspaces table cache
```

## Edge Cases

### Not a git repo
If `git rev-parse` fails (exit 128), use the directory basename as repo name and `home` as branch. Example: cwd `/Users/you/scratch` → workspace `scratch:home`.

### Detached HEAD
If `git rev-parse --abbrev-ref HEAD` returns literal `HEAD`, use `detached` as branch name. This is rare in worktree workflows but should not crash.

### Git worktrees
`git rev-parse --show-toplevel` returns the worktree root (not the main repo root). `--abbrev-ref HEAD` returns the worktree's branch. This is correct behavior — each worktree maps to its own workspace.

### Same repo, different clones
Two clones of the same repo at different paths will both resolve to the same repo name (basename of toplevel). If they're on different branches, the workspace names differ naturally. If on the same branch, latest-wins semantics apply (most recent session takes precedence).

### Branch changes
The workspaces table caches cwd → workspace mappings. On `session-start` events, sap always re-resolves (ignores cache) to catch branch switches. Other events use the cache for speed.

### Permission errors
If `git` cannot be executed or the cwd is inaccessible, fall back to `unknown:unknown` and log a warning to stderr.

## Caching

The workspaces table avoids shelling out to `git` on every hook event (tool-use events can fire rapidly).

- **Cache hit**: Return immediately (sub-millisecond)
- **Cache miss**: Two `git` calls (~10ms total), then cache
- **Invalidation**: `session-start` always re-resolves; other events trust cache
- **No TTL**: Cache entries persist until overwritten. Branch changes are caught by session-start re-resolution.
