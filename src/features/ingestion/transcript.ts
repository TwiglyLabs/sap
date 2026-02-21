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
  promptText?: string;
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
    uuid: (obj.uuid as string) || '',
  };

  const message = obj.message as Record<string, unknown> | undefined;
  if (!message) return null;

  const content = message.content;

  if (type === 'user') {
    if (typeof content === 'string') {
      result.promptText = content;
    } else if (Array.isArray(content)) {
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

// --- Turn boundary detection ---

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
