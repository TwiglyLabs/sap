# Transcript Ingestion

Last updated: 2026-02-14

## Command Interface

```
sap ingest                     # ingest all sessions not yet ingested
sap ingest --session <id>      # ingest a specific session
sap ingest --since 7d          # ingest sessions from last 7 days
sap ingest --force             # re-ingest (delete + reprocess) already-ingested sessions
sap ingest --dry-run           # show what would be ingested without doing it
```

All variants support `--json` for programmatic output.

## Transcript JSONL Format

Based on inspection of actual Claude Code transcript files:

### Line Types (by `type` field)

- **`user`** — User messages. `message.content` is either a string (prompt text) or an array of blocks (may include `tool_result` blocks with tool outputs).
- **`assistant`** — Assistant responses. `message.content` is an array of blocks (`text`, `tool_use`). `message.usage` contains token counts. `message.model` identifies the model.
- **`system`** — System messages (instructions, context).
- **`progress`** — Hook execution progress events. Not analytically useful.
- **`file-history-snapshot`** — File state snapshots. Not analytically useful.

### Key Fields Per Line

Every line has:
- `type` — message type
- `sessionId` — session identifier
- `timestamp` — ISO 8601 timestamp
- `uuid` — unique message ID
- `parentUuid` — parent message (for threading)

Assistant messages additionally have:
- `message.usage.input_tokens`
- `message.usage.output_tokens`
- `message.usage.cache_read_input_tokens`
- `message.usage.cache_creation_input_tokens`
- `message.model`
- `message.content[]` — array of content blocks

Tool use blocks (in assistant content):
- `type: "tool_use"`
- `id` — tool_use_id
- `name` — tool name
- `input` — tool input object

Tool result blocks (in user content):
- `type: "tool_result"`
- `tool_use_id` — correlates back to tool_use block
- `content` — result string
- `is_error` — boolean (absent = false)

## Ingestion Algorithm

```
for each session with transcript_path and (not ingested or --force):
  if --force: delete existing turns + tool_calls for this session

  read transcript JSONL line by line
  filter to type=user and type=assistant lines
  sort by timestamp

  identify turns:
    a turn starts with a user message (non-meta, non-tool-result)
    followed by one or more assistant messages
    tool_use blocks in assistant → tool_result blocks in next user → more assistant
    turn ends when next non-tool-result user message appears

  for each turn:
    extract prompt_text from the initiating user message
    extract token counts from the last assistant message in the turn
    extract model from assistant message
    compute duration from first user timestamp to last assistant timestamp
    count tool_use blocks

    insert into turns table

    for each tool_use block:
      extract tool name, input summary (reuse existing tool-detail.ts logic)
      find matching tool_result by tool_use_id
      determine success: is_error field, or heuristic on content
      insert into tool_calls table

  update sessions.ingested_at = now
  commit transaction
```

## Turn Boundary Detection

A "turn" is one cycle of: user asks → Claude responds (possibly with multiple tool calls).

Boundary rules:
1. Skip `isMeta: true` user messages (system injections)
2. Skip user messages that only contain `tool_result` blocks (these are mid-turn tool responses)
3. A real user prompt is a user message with string content or text blocks that isn't meta
4. Everything between two real user prompts is one turn

## Tool Input Summary Extraction

Reuse the existing `tool-detail.ts` logic which extracts:
- **Edit, Write, Read**: filename (basename)
- **Glob**: glob pattern
- **Grep**: regex pattern
- **Bash**: command (first 80 chars)
- **Task**: task description
- **WebFetch**: hostname
- **WebSearch**: query (first 80 chars)

During ingest, we have the full `input` object from transcript tool_use blocks, so we can apply the same extraction.

## Success/Failure Detection

For `tool_calls.success`:
- If `is_error: true` in tool_result → `success = 0`, extract error message
- If tool_result content contains common error patterns (stack traces, "Error:", "ENOENT", non-zero exit codes for Bash) → `success = 0`
- Otherwise → `success = 1`

Keep this simple initially. We can refine heuristics over time based on what the analytics surface.

## Idempotency

- `sessions.ingested_at` tracks what's been processed
- Without `--force`, already-ingested sessions are skipped
- With `--force`, existing turns/tool_calls are deleted before re-ingestion (cascade within transaction)
- Entire session ingestion is wrapped in a single transaction — atomic success or rollback

## Output

```json
{
  "ingested": 12,
  "skipped": 45,
  "errors": [
    { "session_id": "abc123", "error": "transcript file not found" }
  ]
}
```

Human-readable output shows a progress summary with session IDs and turn/tool counts.
