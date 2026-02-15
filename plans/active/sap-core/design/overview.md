# sap — Session Awareness Protocol

Last updated: 2026-02-14

## What

sap is a Node.js CLI tool that provides session awareness for Claude Code. It turns ephemeral hook events into persistent, queryable state.

## Why

Current Claude Code monitoring in Emacs relies on scraping vterm buffer output — hashing the last 15 lines and regex-matching for attention patterns. This is unreliable, misses events, produces false positives, and provides no session lifecycle awareness.

Claude Code hooks emit real events (session start/stop, permission prompts, idle detection, tool usage) with structured payloads including session IDs and transcript paths. sap captures these events, persists them in SQLite, and exposes a CLI query interface.

## Architecture

```
Claude Code hooks (stdin JSON)
    │
    ▼
sap record <event>        ← hook command, reads JSON from stdin
    │
    ▼
SQLite (~/.sap/sap.db)    ← WAL mode, handles concurrent writes
    │
    ▼
sap status --json         ← consumers poll this (Emacs, scripts, etc.)
```

## Design Principles

1. **Event-sourced** — raw events are the source of truth; derived state is computed
2. **Git-aware** — workspaces identified by repo:branch, inferred from cwd
3. **Latest-wins** — multiple sessions on same workspace: most recent takes precedence
4. **Analysis-ready** — full event log + transcript paths enable future session analysis
5. **Zero config** — hooks call `sap record`, consumers call `sap status`. No setup beyond installing hooks.

## Related Design Documents

- [approach.md](./approach.md) — CLI commands, data model, state machine
- [hooks.md](./hooks.md) — Claude Code hooks configuration
- [workspace-inference.md](./workspace-inference.md) — cwd to workspace mapping
