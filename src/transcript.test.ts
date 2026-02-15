import { describe, it, expect } from 'vitest';
import { parseTranscriptLine, groupIntoTurns } from './transcript.ts';
import type { TranscriptLine } from './transcript.ts';

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
    expect(result!.timestamp).toBe(new Date('2026-02-14T10:00:00.000Z').getTime());
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
