import { readFileSync, existsSync } from 'fs';
import { parseTranscriptLine, groupIntoTurns } from './transcript.ts';
import { extractToolDetail } from './tool-detail.ts';
import type { IngestionRepository } from './ingestion.repository.ts';
import type { IngestResult, IngestOptions, BatchResult, BatchOptions } from './ingestion.types.ts';
import type { Result } from '../../core/types.ts';
import { ok, err } from '../../core/utils.ts';

export class IngestionService {
  constructor(private repo: IngestionRepository) {}

  ingestSession(sessionId: string, options: IngestOptions = {}): Result<IngestResult> {
    const session = this.repo.getSession(sessionId);
    if (!session) {
      return err('Session not found');
    }

    if (!session.transcript_path) {
      return err('No transcript path');
    }

    if (session.ingested_at && !options.force) {
      return ok({ sessionId, turns: 0, toolCalls: 0, skipped: true });
    }

    if (!existsSync(session.transcript_path)) {
      return err(`Transcript file not found: ${session.transcript_path}`);
    }

    const raw = readFileSync(session.transcript_path, 'utf-8');
    const lines = raw.split('\n').filter(l => l.trim());
    const parsed = lines.map(l => parseTranscriptLine(l)).filter(l => l !== null);
    const turnData = groupIntoTurns(parsed);

    const toolResultMap = new Map<string, { content: string; is_error: boolean }>();
    for (const turn of turnData) {
      for (const tr of turn.toolResults) {
        toolResultMap.set(tr.tool_use_id, { content: tr.content, is_error: tr.is_error });
      }
    }

    let totalToolCalls = 0;

    this.repo.transaction(() => {
      if (options.force) {
        this.repo.deleteToolCallsForSession(sessionId);
        this.repo.deleteTurnsForSession(sessionId);
      }

      for (const turn of turnData) {
        const turnId = this.repo.insertTurn({
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

          this.repo.insertToolCall({
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

      this.repo.markSessionIngested(sessionId);
    });

    return ok({ sessionId, turns: turnData.length, toolCalls: totalToolCalls, skipped: false });
  }

  ingestBatch(options: BatchOptions): BatchResult {
    let sessions: { session_id: string; transcript_path: string | null; started_at: number; ingested_at: number | null }[];

    if (options.sessionId) {
      const s = this.repo.getSession(options.sessionId);
      sessions = s ? [s] : [];
    } else {
      sessions = this.repo.getSessionsForIngestion(options.sinceMs);
    }

    const result: BatchResult = { ingested: 0, skipped: 0, errors: [], results: [] };

    for (const session of sessions) {
      const r = this.ingestSession(session.session_id, { force: options.force });
      if (r.ok) {
        result.results.push(r.data);
        if (r.data.skipped) {
          result.skipped++;
        } else {
          result.ingested++;
        }
      } else {
        result.errors.push({ session_id: session.session_id, error: r.error });
      }
    }

    return result;
  }
}
