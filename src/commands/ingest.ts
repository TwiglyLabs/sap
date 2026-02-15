import { readFileSync, existsSync } from 'fs';
import type Database from 'better-sqlite3';
import chalk from 'chalk';
import { getSession, insertTurn, insertToolCall } from '../db.ts';
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

// --- Batch ingestion ---

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

// --- CLI ---

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

export interface IngestCliOptions {
  session?: string;
  since?: string;
  force?: boolean;
  json?: boolean;
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
