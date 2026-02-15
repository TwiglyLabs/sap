# sap-analytics — Usage Analytics for Claude Code

Last updated: 2026-02-14

## What

An analytics extension to sap that enables Claude to analyze your Claude Code usage patterns. Adds enriched data capture (transcript parsing, token counts, prompt text), query commands, and a Claude skill that teaches Claude how to explore the data.

## Why

sap already tracks session lifecycle, tool usage, and state transitions — but the data is shallow. Session-level state and last-tool-used isn't enough to answer questions like:

- Which repos cost the most tokens?
- What tool sequences lead to successful outcomes vs. spinning wheels?
- How much time is spent waiting on permission prompts?
- What kinds of prompts lead to efficient sessions?

The transcript JSONL files contain everything — token counts, full conversation flow, tool results — but it's locked in flat files. By parsing transcripts into queryable tables and giving Claude SQL access, you get a feedback loop: track how you work, find what's working, tune your setup.

## Goal

Optimize Claude usage by providing evidence-based insight into workflow patterns, efficiency, and costs. Enable an analytics-driven approach to configuring skills, hooks, and prompts.

## Architecture

```
Existing hooks → sap record (+ store prompt text)
                      │
                  sap.db (existing tables)
                      │
sap ingest ← reads transcript JSONL files
                      │
              sap.db (new analytics tables: turns, tool_calls)
                      │
sap query / sap analytics → JSON → Claude reasons about it
```

## What We're Building

1. **Enriched data capture** — Store prompt text in real-time hooks. Batch `sap ingest` parses transcript JSONL into analytics tables.
2. **Query commands** — `sap query` for raw SQL, plus convenience commands (`sap analytics summary/tools/sessions/patterns`).
3. **A Claude skill** (in ~/dotfiles) — Teaches Claude how to explore usage data, what the schema looks like, and how to go from summaries to deep dives.

## What We're NOT Building

- No OTel, no DuckDB, no external services
- No dashboards or visualizations
- No MCP server
- No changes to the existing recording hot path beyond storing prompt text

## Related Design Documents

- [schema.md](./schema.md) — New tables, columns, indexes
- [ingest.md](./ingest.md) — Transcript parsing and data extraction
- [commands.md](./commands.md) — Query and analytics CLI commands
- [skill.md](./skill.md) — Claude skill design (implemented in ~/dotfiles)
