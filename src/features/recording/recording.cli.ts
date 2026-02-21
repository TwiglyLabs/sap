import { readFileSync } from 'fs';
import type { EventType } from '../../core/types.ts';
import type { RecordingService } from './recording.service.ts';
import { parsePayload } from './recording.service.ts';

const VALID_EVENTS: EventType[] = [
  'session-start', 'session-end', 'turn-complete',
  'attention-permission', 'attention-idle',
  'user-prompt', 'tool-use',
];

export function recordCli(service: RecordingService, eventType: string): void {
  if (!VALID_EVENTS.includes(eventType as EventType)) {
    process.stderr.write(`Unknown event type: ${eventType}\n`);
    process.exitCode = 1;
    return;
  }

  let stdin: string;
  try {
    stdin = readFileSync(0, 'utf-8');
  } catch {
    process.stderr.write('Failed to read stdin\n');
    process.exitCode = 2;
    return;
  }

  try {
    const payload = parsePayload(stdin);
    service.recordEvent(eventType as EventType, payload);
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 2;
    return;
  }
}
