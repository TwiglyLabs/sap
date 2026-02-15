# Phase 2: Transcript Ingestion

> **For Claude:** REQUIRED SUB-SKILL: Use gremlins:executing-plans to implement this plan task-by-task.

**Goal:** Build the `sap ingest` command that parses Claude Code transcript JSONL files and populates the `turns` and `tool_calls` tables.

**Architecture:** A new `src/commands/ingest.ts` module with: (1) a transcript parser that reads JSONL and identifies turn boundaries, (2) a data extractor that pulls tokens, tool calls, and timing from each turn, (3) a CLI command that orchestrates ingestion across sessions. Reuses `extractToolDetail` from `tool-detail.ts` for tool input summaries.

**Tech Stack:** TypeScript, better-sqlite3, vitest, node:fs (readline for streaming JSONL)

**Related:** [../design/ingest.md](../design/ingest.md), [../design/schema.md](../design/schema.md), [./phase-1.md](./phase-1.md), [./phase-3.md](./phase-3.md)

**Depends on:** Phase 1 (schema must exist)

---

### Task 1: Transcript line parser

**Files:**
- Create: `src/transcript.ts`
- Test: `src/transcript.test.ts`

This module parses individual JSONL lines into typed objects. It doesn't handle files or turn boundaries — just line-level parsing.

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { parseTranscriptLine } from './transcript.ts';

describe('parseTranscriptLine', () => {
  it('parses a user message with string content', () => {
    const line = JSON.stringify({
      type: 'user',
      sessionId: 'sess-1',
      timestamp: '2026-02-14T10:00:00.000Z',
      uuid: 'uuid-1',
      message: { role: 'user', content: 'fix the bug' },
    });
    const result = parseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('user');
    expect(result!.timestamp).toBe(1739523600000);
  });

  it('parses an assistant message with usage data', () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 'sess-1',
      timestamp: '2026-02-14T10:00:05.000Z',
      uuid: 'uuid-2',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5-20250929',
        content: [{ type: 'text', text: 'I will fix it.' }],
        usage: {
          input_tokens: 5000,
          output_tokens: 200,
          cache_read_input_tokens: 3000,
          cache_creation_input_tokens: 500,
        },
      },
    });
    const result = parseTranscriptLine(line);
    expect(result).not.toBeNull();
    expect(result!.type).toBe('assistant');
    expect(result!.usage!.input_tokens).toBe(5000);
    expect(result!.usage!.cache_read_tokens).toBe(3000);
    expect(result!.model).toBe('claude-sonnet-4-5-20250929');
  });

  it('extracts tool_use blocks from assistant messages', () => {
    const line = JSON.stringify({
      type: 'assistant',
      sessionId: 'sess-1',
      timestamp: '2026-02-14T10:00:05.000Z',
      uuid: 'uuid-2',
      message: {
        role: 'assistant',
        model: 'claude-sonnet-4-5-20250929',
        content: [
          { type: 'text', text: 'Let me read the file.' },
          { type: 'tool_use', id: 'toolu_123', name: 'Read', input: { file_path: '/src/app.ts' } },
        ],
        usage: { input_tokens: 100, output_tokens: 50 },
      },
    });
    const result = parseTranscriptLine(line);
    expect(result!.toolUses).toHaveLength(1);
    expect(result!.toolUses![0].name).toBe('Read');
    expect(result!.toolUses![0].id).toBe('toolu_123');
  });

  it('extracts tool_result blocks from user messages', () => {
    const line = JSON.stringify({
      type: 'user',
      sessionId: 'sess-1',
      timestamp: '2026-02-14T10:00:06.000Z',
      uuid: 'uuid-3',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_123', content: 'file contents here' },
        ],
      },
    });
    const result = parseTranscriptLine(line);
    expect(result!.toolResults).toHaveLength(1);
    expect(result!.toolResults![0].tool_use_id).toBe('toolu_123');
    expect(result!.toolResults![0].is_error).toBe(false);
  });

  it('detects error tool results', () => {
    const line = JSON.stringify({
      type: 'user',
      sessionId: 'sess-1',
      timestamp: '2026-02-14T10:00:06.000Z',
      uuid: 'uuid-3',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_123', content: 'Error: file not found', is_error: true },
        ],
      },
    });
    const result = parseTranscriptLine(line);
    expect(result!.toolResults![0].is_error).toBe(true);
  });

  it('skips non-message types (progress, file-history-snapshot)', () => {
    const line = JSON.stringify({ type: 'progress', sessionId: 'sess-1', timestamp: '2026-02-14T10:00:00.000Z' });
    expect(parseTranscriptLine(line)).toBeNull();
  });

  it('skips meta user messages (isMeta: true)', () => {
    const line = JSON.stringify({
      type: 'user',
      sessionId: 'sess-1',
      timestamp: '2026-02-14T10:00:00.000Z',
      uuid: 'uuid-1',
      isMeta: true,
      message: { role: 'user', content: 'system injection' },
    });
    expect(parseTranscriptLine(line)).toBeNull();
  });

  it('returns null for unparseable lines', () => {
    expect(parseTranscriptLine('not json')).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/transcript.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement `src/transcript.ts`**

```typescript
export interface TranscriptToolUse {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface TranscriptToolResult {
  tool_use_id: string;
  content: string;
  is_error: boolean;
}

export interface TranscriptUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface TranscriptLine {
  type: 'user' | 'assistant';
  sessionId: string;
  timestamp: number;  // ms since epoch
  uuid: string;
  // User messages
  promptText?: string;           // string content from user (non-tool-result)
  toolResults?: TranscriptToolResult[];
  // Assistant messages
  model?: string;
  usage?: TranscriptUsage;
  toolUses?: TranscriptToolUse[];
}

export function parseTranscriptLine(raw: string): TranscriptLine | null {
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(raw);
  } catch {
    return null;
  }

  const type = obj.type as string;
  if (type !== 'user' && type !== 'assistant') return null;
  if (obj.isMeta) return null;

  const timestamp = new Date(obj.timestamp as string).getTime();
  if (isNaN(timestamp)) return null;

  const result: TranscriptLine = {
    type,
    sessionId: obj.sessionId as string,
    timestamp,
    uuid: obj.uuid as string || '',
  };

  const message = obj.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const content = message.content;

  if (type === 'user') {
    if (typeof content === 'string') {
      result.promptText = content;
    } else if (Array.isArray(content)) {
      // Check if it's only tool results (mid-turn) or has text too
      const toolResults: TranscriptToolResult[] = [];
      const textParts: string[] = [];
      for (const block of content) {
        if (block?.type === 'tool_result') {
          toolResults.push({
            tool_use_id: block.tool_use_id ?? '',
            content: typeof block.content === 'string' ? block.content : '',
            is_error: block.is_error === true,
          });
        } else if (block?.type === 'text' && typeof block.text === 'string') {
          textParts.push(block.text);
        }
      }
      if (toolResults.length > 0) result.toolResults = toolResults;
      if (textParts.length > 0) result.promptText = textParts.join('\n');
    }
  }

  if (type === 'assistant') {
    result.model = (message.model as string) || undefined;

    const usage = message.usage as Record<string, unknown> | undefined;
    if (usage) {
      result.usage = {
        input_tokens: (usage.input_tokens as number) || 0,
        output_tokens: (usage.output_tokens as number) || 0,
        cache_read_tokens: (usage.cache_read_input_tokens as number) || 0,
        cache_write_tokens: (usage.cache_creation_input_tokens as number) || 0,
      };
    }

    if (Array.isArray(content)) {
      const toolUses: TranscriptToolUse[] = [];
      for (const block of content) {
        if (block?.type === 'tool_use') {
          toolUses.push({
            id: block.id ?? '',
            name: block.name ?? 'unknown',
            input: (block.input as Record<string, unknown>) ?? {},
          });
        }
      }
      if (toolUses.length > 0) result.toolUses = toolUses;
    }
  }

  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/transcript.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/transcript.ts src/transcript.test.ts
git commit -m "feat: add transcript JSONL line parser"
```

---

### Task 2: Turn boundary detection

**Files:**
- Modify: `src/transcript.ts`
- Test: `src/transcript.test.ts`

This function takes an array of parsed transcript lines and groups them into turns.

**Step 1: Write the failing test**

```typescript
import { groupIntoTurns } from './transcript.ts';
import type { TranscriptLine } from './transcript.ts';

describe('groupIntoTurns', () => {
  it('groups a simple prompt + response into one turn', () => {
    const lines: TranscriptLine[] = [
      { type: 'user', sessionId: 's1', timestamp: 1000, uuid: 'u1', promptText: 'hello' },
      { type: 'assistant', sessionId: 's1', timestamp: 1500, uuid: 'u2', model: 'claude-sonnet-4-5-20250929',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0 } },
    ];

    const turns = groupIntoTurns(lines);
    expect(turns).toHaveLength(1);
    expect(turns[0].promptText).toBe('hello');
    expect(turns[0].assistantUsage?.output_tokens).toBe(50);
  });

  it('splits two prompts into two turns', () => {
    const lines: TranscriptLine[] = [
      { type: 'user', sessionId: 's1', timestamp: 1000, uuid: 'u1', promptText: 'first' },
      { type: 'assistant', sessionId: 's1', timestamp: 1500, uuid: 'u2',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0 } },
      { type: 'user', sessionId: 's1', timestamp: 2000, uuid: 'u3', promptText: 'second' },
      { type: 'assistant', sessionId: 's1', timestamp: 2500, uuid: 'u4',
        usage: { input_tokens: 200, output_tokens: 80, cache_read_tokens: 0, cache_write_tokens: 0 } },
    ];

    const turns = groupIntoTurns(lines);
    expect(turns).toHaveLength(2);
    expect(turns[0].promptText).toBe('first');
    expect(turns[1].promptText).toBe('second');
  });

  it('keeps tool-result user messages within the same turn', () => {
    const lines: TranscriptLine[] = [
      { type: 'user', sessionId: 's1', timestamp: 1000, uuid: 'u1', promptText: 'edit the file' },
      { type: 'assistant', sessionId: 's1', timestamp: 1500, uuid: 'u2',
        toolUses: [{ id: 'toolu_1', name: 'Read', input: { file_path: '/a.ts' } }],
        usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0 } },
      { type: 'user', sessionId: 's1', timestamp: 1600, uuid: 'u3',
        toolResults: [{ tool_use_id: 'toolu_1', content: 'file content', is_error: false }] },
      { type: 'assistant', sessionId: 's1', timestamp: 2000, uuid: 'u4',
        toolUses: [{ id: 'toolu_2', name: 'Edit', input: { file_path: '/a.ts' } }],
        usage: { input_tokens: 200, output_tokens: 80, cache_read_tokens: 0, cache_write_tokens: 0 } },
    ];

    const turns = groupIntoTurns(lines);
    expect(turns).toHaveLength(1);
    expect(turns[0].toolUses).toHaveLength(2);
  });

  it('aggregates token usage across multiple assistant messages in a turn', () => {
    const lines: TranscriptLine[] = [
      { type: 'user', sessionId: 's1', timestamp: 1000, uuid: 'u1', promptText: 'do stuff' },
      { type: 'assistant', sessionId: 's1', timestamp: 1500, uuid: 'u2',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 20, cache_write_tokens: 10 } },
      { type: 'user', sessionId: 's1', timestamp: 1600, uuid: 'u3',
        toolResults: [{ tool_use_id: 'toolu_1', content: 'ok', is_error: false }] },
      { type: 'assistant', sessionId: 's1', timestamp: 2000, uuid: 'u4',
        usage: { input_tokens: 200, output_tokens: 80, cache_read_tokens: 40, cache_write_tokens: 20 } },
    ];

    const turns = groupIntoTurns(lines);
    expect(turns[0].assistantUsage?.input_tokens).toBe(300);
    expect(turns[0].assistantUsage?.output_tokens).toBe(130);
  });

  it('computes turn duration from first user to last assistant timestamp', () => {
    const lines: TranscriptLine[] = [
      { type: 'user', sessionId: 's1', timestamp: 1000, uuid: 'u1', promptText: 'hi' },
      { type: 'assistant', sessionId: 's1', timestamp: 3500, uuid: 'u2',
        usage: { input_tokens: 100, output_tokens: 50, cache_read_tokens: 0, cache_write_tokens: 0 } },
    ];

    const turns = groupIntoTurns(lines);
    expect(turns[0].startedAt).toBe(1000);
    expect(turns[0].endedAt).toBe(3500);
    expect(turns[0].durationMs).toBe(2500);
  });

  it('handles empty input', () => {
    expect(groupIntoTurns([])).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/transcript.test.ts`
Expected: FAIL — `groupIntoTurns` not defined

**Step 3: Implement `groupIntoTurns`**

Add to `src/transcript.ts`:

```typescript
export interface ParsedTurn {
  turnNumber: number;
  promptText: string | null;
  model: string | null;
  assistantUsage: TranscriptUsage | null;
  toolUses: TranscriptToolUse[];
  toolResults: TranscriptToolResult[];
  startedAt: number;
  endedAt: number;
  durationMs: number;
}

export function groupIntoTurns(lines: TranscriptLine[]): ParsedTurn[] {
  const turns: ParsedTurn[] = [];
  let current: {
    promptText: string | null;
    model: string | null;
    usage: TranscriptUsage;
    toolUses: TranscriptToolUse[];
    toolResults: TranscriptToolResult[];
    startedAt: number;
    endedAt: number;
  } | null = null;

  function isNewPrompt(line: TranscriptLine): boolean {
    // A user message is a "new prompt" if it has prompt text and no tool results,
    // or if it has both (text + tool results, which shouldn't happen normally).
    // A user message with ONLY tool results is a mid-turn continuation.
    if (line.type !== 'user') return false;
    if (line.toolResults && line.toolResults.length > 0 && !line.promptText) return false;
    return !!line.promptText;
  }

  function finalizeTurn(): void {
    if (!current) return;
    turns.push({
      turnNumber: turns.length + 1,
      promptText: current.promptText,
      model: current.model,
      assistantUsage: current.usage.input_tokens > 0 || current.usage.output_tokens > 0
        ? current.usage : null,
      toolUses: current.toolUses,
      toolResults: current.toolResults,
      startedAt: current.startedAt,
      endedAt: current.endedAt,
      durationMs: current.endedAt - current.startedAt,
    });
    current = null;
  }

  for (const line of lines) {
    if (isNewPrompt(line)) {
      finalizeTurn();
      current = {
        promptText: line.promptText ?? null,
        model: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_write_tokens: 0 },
        toolUses: [],
        toolResults: [],
        startedAt: line.timestamp,
        endedAt: line.timestamp,
      };
    } else if (current) {
      if (line.type === 'assistant') {
        if (line.model) current.model = line.model;
        if (line.usage) {
          current.usage.input_tokens += line.usage.input_tokens;
          current.usage.output_tokens += line.usage.output_tokens;
          current.usage.cache_read_tokens += line.usage.cache_read_tokens;
          current.usage.cache_write_tokens += line.usage.cache_write_tokens;
        }
        if (line.toolUses) current.toolUses.push(...line.toolUses);
        current.endedAt = line.timestamp;
      } else if (line.type === 'user' && line.toolResults) {
        current.toolResults.push(...line.toolResults);
      }
    }
  }

  finalizeTurn();
  return turns;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/transcript.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/transcript.ts src/transcript.test.ts
git commit -m "feat: add turn boundary detection for transcript parsing"
```

---

### Task 3: Ingest a single session

**Files:**
- Create: `src/commands/ingest.ts`
- Test: `src/commands/ingest.test.ts`

The core function: given a session ID with a transcript path, parse the transcript and populate turns + tool_calls.

**Step 1: Write the failing test**

For testing, we'll create a temp JSONL file with known content rather than using real transcripts.

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type Database from 'better-sqlite3';
import { openDb, insertSession, getSession, getSessionTurns, getTurnToolCalls } from '../db.ts';
import { ingestSession } from './ingest.ts';

function writeTranscript(dir: string, lines: object[]): string {
  const path = join(dir, 'transcript.jsonl');
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join('\n'));
  return path;
}

describe('ingestSession', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = openDb(':memory:');
    tmpDir = mkdtempSync(join(tmpdir(), 'sap-test-'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it('ingests a simple one-turn transcript', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'fix the bug' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:05.000Z', uuid: 'u2',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'I fixed it.' }],
          usage: { input_tokens: 5000, output_tokens: 200, cache_read_input_tokens: 3000, cache_creation_input_tokens: 500 },
        },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });

    const result = ingestSession(db, 's1');
    expect(result.turns).toBe(1);
    expect(result.toolCalls).toBe(0);

    const turns = getSessionTurns(db, 's1');
    expect(turns).toHaveLength(1);
    expect(turns[0].prompt_text).toBe('fix the bug');
    expect(turns[0].input_tokens).toBe(5000);
    expect(turns[0].output_tokens).toBe(200);
    expect(turns[0].model).toBe('claude-sonnet-4-5-20250929');

    const session = getSession(db, 's1');
    expect(session!.ingested_at).not.toBeNull();
  });

  it('ingests tool calls and correlates with results', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'read the file' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:02.000Z', uuid: 'u2',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [
            { type: 'text', text: 'Let me read it.' },
            { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { file_path: '/src/app.ts' } },
          ],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:03.000Z', uuid: 'u3',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file content here' }],
        },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:05.000Z', uuid: 'u4',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'Done.' }],
          usage: { input_tokens: 200, output_tokens: 30 },
        },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });

    const result = ingestSession(db, 's1');
    expect(result.turns).toBe(1);
    expect(result.toolCalls).toBe(1);

    const turns = getSessionTurns(db, 's1');
    expect(turns[0].tool_call_count).toBe(1);

    const calls = getTurnToolCalls(db, turns[0].id);
    expect(calls).toHaveLength(1);
    expect(calls[0].tool_name).toBe('Read');
    expect(calls[0].tool_input_summary).toBe('app.ts');
    expect(calls[0].success).toBe(1);
  });

  it('detects tool call errors', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'edit the file' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:02.000Z', uuid: 'u2',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'tool_use', id: 'toolu_1', name: 'Edit', input: { file_path: '/a.ts', old_string: 'foo', new_string: 'bar' } }],
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:03.000Z', uuid: 'u3',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'Error: old_string not found in file', is_error: true }],
        },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:05.000Z', uuid: 'u4',
        message: {
          role: 'assistant', model: 'claude-sonnet-4-5-20250929',
          content: [{ type: 'text', text: 'Let me try again.' }],
          usage: { input_tokens: 200, output_tokens: 30 },
        },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });
    ingestSession(db, 's1');

    const turns = getSessionTurns(db, 's1');
    const calls = getTurnToolCalls(db, turns[0].id);
    expect(calls[0].success).toBe(0);
    expect(calls[0].error_message).toContain('old_string not found');
  });

  it('skips already-ingested sessions without --force', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:01.000Z', uuid: 'u2',
        message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });

    ingestSession(db, 's1');
    const result = ingestSession(db, 's1');  // second call
    expect(result.skipped).toBe(true);
  });

  it('re-ingests with force flag', () => {
    const transcriptPath = writeTranscript(tmpDir, [
      {
        type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1',
        message: { role: 'user', content: 'hello' },
      },
      {
        type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:01.000Z', uuid: 'u2',
        message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } },
      },
    ]);

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: transcriptPath, started_at: 1000 });

    ingestSession(db, 's1');
    const result = ingestSession(db, 's1', { force: true });
    expect(result.skipped).toBe(false);
    expect(result.turns).toBe(1);

    // Should not have duplicate turns
    const turns = getSessionTurns(db, 's1');
    expect(turns).toHaveLength(1);
  });

  it('returns error for missing transcript file', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: '/nonexistent/transcript.jsonl', started_at: 1000 });

    const result = ingestSession(db, 's1');
    expect(result.error).toBeDefined();
  });

  it('returns error for session with no transcript path', () => {
    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: null, started_at: 1000 });

    const result = ingestSession(db, 's1');
    expect(result.error).toBeDefined();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands/ingest.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement `ingestSession` in `src/commands/ingest.ts`**

```typescript
import { readFileSync, existsSync } from 'fs';
import type Database from 'better-sqlite3';
import { getSession, insertTurn, insertToolCall, getSessionTurns } from '../db.ts';
import { parseTranscriptLine, groupIntoTurns } from '../transcript.ts';
import { extractToolDetail } from '../tool-detail.ts';

export interface IngestResult {
  sessionId: string;
  turns: number;
  toolCalls: number;
  skipped: boolean;
  error?: string;
}

export interface IngestOptions {
  force?: boolean;
}

export function ingestSession(
  db: Database.Database,
  sessionId: string,
  options: IngestOptions = {},
): IngestResult {
  const session = getSession(db, sessionId);
  if (!session) {
    return { sessionId, turns: 0, toolCalls: 0, skipped: false, error: 'Session not found' };
  }

  if (!session.transcript_path) {
    return { sessionId, turns: 0, toolCalls: 0, skipped: false, error: 'No transcript path' };
  }

  if (session.ingested_at && !options.force) {
    return { sessionId, turns: 0, toolCalls: 0, skipped: true };
  }

  if (!existsSync(session.transcript_path)) {
    return { sessionId, turns: 0, toolCalls: 0, skipped: false, error: `Transcript file not found: ${session.transcript_path}` };
  }

  // Parse transcript
  const raw = readFileSync(session.transcript_path, 'utf-8');
  const lines = raw.split('\n').filter(l => l.trim());
  const parsed = lines.map(l => parseTranscriptLine(l)).filter(l => l !== null);
  const turnData = groupIntoTurns(parsed);

  // Build tool result lookup: tool_use_id → tool_result
  const toolResultMap = new Map<string, { content: string; is_error: boolean }>();
  for (const turn of turnData) {
    for (const tr of turn.toolResults) {
      toolResultMap.set(tr.tool_use_id, { content: tr.content, is_error: tr.is_error });
    }
  }

  // Write to DB in a transaction
  let totalToolCalls = 0;

  const run = db.transaction(() => {
    // If force, delete existing analytics data for this session
    if (options.force) {
      db.prepare('DELETE FROM tool_calls WHERE session_id = ?').run(sessionId);
      db.prepare('DELETE FROM turns WHERE session_id = ?').run(sessionId);
    }

    for (const turn of turnData) {
      const turnId = insertTurn(db, {
        session_id: sessionId,
        turn_number: turn.turnNumber,
        prompt_text: turn.promptText,
        input_tokens: turn.assistantUsage?.input_tokens ?? null,
        output_tokens: turn.assistantUsage?.output_tokens ?? null,
        cache_read_tokens: turn.assistantUsage?.cache_read_tokens ?? null,
        cache_write_tokens: turn.assistantUsage?.cache_write_tokens ?? null,
        model: turn.model,
        tool_call_count: turn.toolUses.length,
        started_at: turn.startedAt,
        ended_at: turn.endedAt,
        duration_ms: turn.durationMs,
      });

      for (const toolUse of turn.toolUses) {
        const result = toolResultMap.get(toolUse.id);
        const success = result ? (result.is_error ? 0 : 1) : null;
        const errorMessage = result?.is_error ? result.content.slice(0, 500) : null;

        insertToolCall(db, {
          session_id: sessionId,
          turn_id: turnId,
          tool_use_id: toolUse.id,
          tool_name: toolUse.name,
          tool_input_summary: extractToolDetail(toolUse.name, toolUse.input),
          success,
          error_message: errorMessage,
          created_at: turn.startedAt,
        });
        totalToolCalls++;
      }
    }

    // Mark session as ingested
    db.prepare('UPDATE sessions SET ingested_at = ? WHERE session_id = ?').run(Date.now(), sessionId);
  });

  run();

  return { sessionId, turns: turnData.length, toolCalls: totalToolCalls, skipped: false };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands/ingest.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands/ingest.ts src/commands/ingest.test.ts
git commit -m "feat: add single-session transcript ingestion"
```

---

### Task 4: Batch ingest command and CLI wiring

**Files:**
- Modify: `src/commands/ingest.ts` (add batch function + CLI handler)
- Modify: `src/cli.ts` (wire `sap ingest` command)
- Test: `src/commands/ingest.test.ts`

**Step 1: Write the failing test for batch ingestion**

```typescript
describe('ingestBatch', () => {
  let db: Database.Database;
  let tmpDir: string;

  beforeEach(() => {
    db = openDb(':memory:');
    tmpDir = mkdtempSync(join(tmpdir(), 'sap-test-'));
  });

  afterEach(() => {
    db.close();
    rmSync(tmpDir, { recursive: true });
  });

  it('ingests all uninigested sessions', () => {
    const t1 = writeTranscript(join(tmpDir, '1'), [
      { type: 'user', sessionId: 's1', timestamp: '2026-02-14T10:00:00.000Z', uuid: 'u1', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', sessionId: 's1', timestamp: '2026-02-14T10:00:01.000Z', uuid: 'u2', message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);
    const t2 = writeTranscript(join(tmpDir, '2'), [
      { type: 'user', sessionId: 's2', timestamp: '2026-02-14T11:00:00.000Z', uuid: 'u3', message: { role: 'user', content: 'bye' } },
      { type: 'assistant', sessionId: 's2', timestamp: '2026-02-14T11:00:01.000Z', uuid: 'u4', message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'bye' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);

    // Need to mkdir for the nested transcript paths
    mkdirSync(join(tmpDir, '1'), { recursive: true });
    mkdirSync(join(tmpDir, '2'), { recursive: true });

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: t1, started_at: 1000 });
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: t2, started_at: 2000 });

    const result = ingestBatch(db, {});
    expect(result.ingested).toBe(2);
    expect(result.skipped).toBe(0);
  });

  it('respects --since filter', () => {
    const recent = Date.now() - 1000;
    const old = Date.now() - 86400 * 1000 * 10;  // 10 days ago

    const t1 = writeTranscript(join(tmpDir, '1'), [
      { type: 'user', sessionId: 's1', timestamp: new Date(recent).toISOString(), uuid: 'u1', message: { role: 'user', content: 'hello' } },
      { type: 'assistant', sessionId: 's1', timestamp: new Date(recent + 1000).toISOString(), uuid: 'u2', message: { role: 'assistant', model: 'claude-sonnet-4-5-20250929', content: [{ type: 'text', text: 'hi' }], usage: { input_tokens: 10, output_tokens: 5 } } },
    ]);

    mkdirSync(join(tmpDir, '1'), { recursive: true });

    insertSession(db, { session_id: 's1', workspace: 'repo:main', cwd: '/r', transcript_path: t1, started_at: recent });
    insertSession(db, { session_id: 's2', workspace: 'repo:main', cwd: '/r', transcript_path: '/fake', started_at: old });

    const result = ingestBatch(db, { sinceMs: 86400 * 1000 * 7 });  // 7 days
    expect(result.ingested).toBe(1);  // only s1
  });
});
```

Note: The `writeTranscript` helper above already does `mkdirSync` inside it — adjust the test helper if needed or inline the directory creation.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands/ingest.test.ts`
Expected: FAIL — `ingestBatch` not defined

**Step 3: Implement `ingestBatch` and CLI handler**

Add to `src/commands/ingest.ts`:

```typescript
export interface BatchResult {
  ingested: number;
  skipped: number;
  errors: { session_id: string; error: string }[];
  results: IngestResult[];
}

export interface BatchOptions {
  sessionId?: string;
  sinceMs?: number;
  force?: boolean;
}

export function ingestBatch(db: Database.Database, options: BatchOptions): BatchResult {
  let sessions: { session_id: string; transcript_path: string | null; started_at: number; ingested_at: number | null }[];

  if (options.sessionId) {
    const s = getSession(db, options.sessionId);
    sessions = s ? [s] : [];
  } else {
    // Get all sessions with transcript paths
    let query = 'SELECT session_id, transcript_path, started_at, ingested_at FROM sessions WHERE transcript_path IS NOT NULL';
    const params: unknown[] = [];

    if (options.sinceMs) {
      const cutoff = Date.now() - options.sinceMs;
      query += ' AND started_at >= ?';
      params.push(cutoff);
    }

    query += ' ORDER BY started_at DESC';
    sessions = db.prepare(query).all(...params) as typeof sessions;
  }

  const result: BatchResult = { ingested: 0, skipped: 0, errors: [], results: [] };

  for (const session of sessions) {
    const r = ingestSession(db, session.session_id, { force: options.force });
    result.results.push(r);
    if (r.skipped) {
      result.skipped++;
    } else if (r.error) {
      result.errors.push({ session_id: session.session_id, error: r.error });
    } else {
      result.ingested++;
    }
  }

  return result;
}
```

Add CLI handler function:

```typescript
import chalk from 'chalk';

export interface IngestCliOptions {
  session?: string;
  since?: string;
  force?: boolean;
  json?: boolean;
  dryRun?: boolean;
}

function parseSinceDuration(s: string): number {
  const match = s.match(/^(\d+)([dhm])$/);
  if (!match) throw new Error(`Invalid duration: ${s}. Use format like "7d", "24h", "30m".`);
  const n = parseInt(match[1], 10);
  switch (match[2]) {
    case 'd': return n * 86400 * 1000;
    case 'h': return n * 3600 * 1000;
    case 'm': return n * 60 * 1000;
    default: throw new Error(`Invalid duration unit: ${match[2]}`);
  }
}

export function ingestCli(db: Database.Database, options: IngestCliOptions): void {
  const batchOptions: BatchOptions = {
    sessionId: options.session,
    force: options.force,
  };

  if (options.since) {
    batchOptions.sinceMs = parseSinceDuration(options.since);
  }

  const result = ingestBatch(db, batchOptions);

  if (options.json) {
    console.log(JSON.stringify({
      ingested: result.ingested,
      skipped: result.skipped,
      errors: result.errors,
    }, null, 2));
  } else {
    console.log(`${chalk.green('Ingested')} ${result.ingested} session${result.ingested === 1 ? '' : 's'}, skipped ${result.skipped}.`);
    for (const err of result.errors) {
      console.log(`  ${chalk.red('Error')} ${err.session_id}: ${err.error}`);
    }
  }
}
```

Wire in `src/cli.ts`:

```typescript
import { ingestCli } from './commands/ingest.ts';

// Add after existing commands:
program
  .command('ingest')
  .description(
    'Parse transcript files and populate analytics tables (turns, tool_calls).\n\n' +
    'Reads the JSONL transcript files referenced by sessions and extracts\n' +
    'turn-level data: token usage, tool calls, prompt text, durations.\n' +
    'Already-ingested sessions are skipped unless --force is used.\n\n' +
    'JSON output: { "ingested": N, "skipped": N, "errors": [...] }\n\n' +
    'Example:\n' +
    '  sap ingest --since 7d\n' +
    '  sap ingest --session abc123 --force\n' +
    '  sap ingest --json'
  )
  .option('--session <id>', 'Ingest a specific session')
  .option('--since <duration>', 'Only ingest sessions from this period (e.g. "7d", "24h")')
  .option('--force', 'Re-ingest already-processed sessions')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    ingestCli(db, options);
    db.close();
  });
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands/ingest.test.ts`
Expected: PASS

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All PASS

**Step 6: Commit**

```bash
git add src/commands/ingest.ts src/commands/ingest.test.ts src/cli.ts
git commit -m "feat: add sap ingest command for batch transcript parsing"
```
