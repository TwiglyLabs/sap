# Claude Skill: sap-analytics

Last updated: 2026-02-14

**This skill lives in `~/dotfiles/claude/skills/sap-analytics`, not in the sap repo.**

A dependent plan should be created in the dotfiles repo to implement this skill after the sap analytics commands are built.

## Purpose

Teach Claude how to analyze your Claude Code usage data using sap's analytics commands. The skill activates when you ask about your usage patterns, efficiency, or want to optimize your Claude workflow.

## Activation Triggers

Use when the user asks things like:
- "analyze my claude usage"
- "how am I using claude"
- "what are my patterns"
- "show me my usage stats"
- "how can I optimize my claude workflow"
- "which repos cost the most"
- "what's my token usage"

## Workflow the Skill Teaches

### 1. Ensure Data is Fresh

Before analyzing, ingest recent transcripts:
```bash
sap ingest --since 7d
```

Check output for errors (missing transcript files, etc.).

### 2. Start Broad

Run the summary to get the lay of the land:
```bash
sap analytics summary --since 7d --json
```

Identify what's interesting: high-token sessions, dominant workspaces, unusual tool distributions, error rates.

### 3. Drill Down

Based on what the summary surfaces, use targeted commands:
```bash
sap analytics tools --json           # tool usage breakdown
sap analytics sessions --json        # per-session efficiency
sap analytics patterns --json        # workflow patterns & anti-patterns
```

### 4. Go Deep

Drop into raw SQL for specific hypotheses:
```bash
sap query "SELECT ..."
```

Example explorations:
- Sessions where Bash was retried more than 3 times
- Average tokens per turn by workspace
- Tool error rates over time (are they improving?)
- Time-of-day patterns in session duration
- Correlation between turn count and session success

### 5. Recommend

Based on findings, suggest concrete changes:
- Skill tweaks (new skills for common patterns, adjustments to existing ones)
- Hook adjustments
- Workflow changes (different approaches for different repo types)
- CLAUDE.md updates (better instructions for problem areas)

Tie every recommendation to evidence from the data.

## Schema Reference

The skill should include the full schema so Claude can write queries:

### Existing Tables
- `sessions(session_id, workspace, cwd, transcript_path, state, started_at, ended_at, last_event_at, last_tool, last_tool_detail, ingested_at)`
- `events(id, session_id, event_type, data, created_at)`
- `workspaces(cwd, repo_name, branch, workspace, resolved_at)`

### Analytics Tables
- `turns(id, session_id, turn_number, prompt_text, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, model, tool_call_count, started_at, ended_at, duration_ms)`
- `tool_calls(id, session_id, turn_id, tool_use_id, tool_name, tool_input_summary, success, error_message, created_at)`

## Example Queries

The skill should include example queries Claude can use as starting points:

```sql
-- Token cost by workspace (last 7 days)
SELECT s.workspace, sum(t.input_tokens) as input, sum(t.output_tokens) as output
FROM turns t JOIN sessions s ON t.session_id = s.session_id
WHERE t.started_at > unixepoch() - 86400*7
GROUP BY s.workspace ORDER BY input DESC;

-- Tool error hotspots
SELECT tool_name, count(*) as errors, group_concat(DISTINCT error_message) as messages
FROM tool_calls WHERE success = 0
GROUP BY tool_name ORDER BY errors DESC;

-- Sessions with highest error rates
SELECT s.session_id, s.workspace, count(*) as total_calls,
  sum(CASE WHEN tc.success = 0 THEN 1 ELSE 0 END) as errors,
  round(100.0 * sum(CASE WHEN tc.success = 0 THEN 1 ELSE 0 END) / count(*), 1) as error_pct
FROM tool_calls tc JOIN sessions s ON tc.session_id = s.session_id
GROUP BY s.session_id HAVING total_calls > 5
ORDER BY error_pct DESC LIMIT 10;

-- Average turns to first commit (outcome efficiency)
SELECT s.workspace, avg(t.turn_number) as avg_turn_to_commit
FROM tool_calls tc
JOIN turns t ON tc.turn_id = t.id
JOIN sessions s ON tc.session_id = s.session_id
WHERE tc.tool_name = 'Bash' AND tc.tool_input_summary LIKE 'git commit%'
GROUP BY s.workspace;

-- Cache hit ratio over time (are prompts getting better at reusing cache?)
SELECT date(t.started_at, 'unixepoch') as day,
  round(100.0 * sum(t.cache_read_tokens) / nullif(sum(t.input_tokens), 0), 1) as cache_hit_pct
FROM turns t GROUP BY day ORDER BY day;
```

## Key Principles for the Skill

1. **Evidence over intuition** — Every insight should come from data, not assumptions.
2. **Start broad, drill narrow** — Summary first, then targeted investigation.
3. **Actionable output** — Don't just report numbers; recommend specific changes.
4. **Compare and contrast** — Look for differences between workspaces, time periods, session types.
5. **Track over time** — When the user asks repeatedly, compare to previous analyses to show trends.
