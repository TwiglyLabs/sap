import { Command } from 'commander';
import { readFileSync } from 'fs';
import { openDb } from './db.ts';
import { recordEvent, parsePayload } from './commands/record.ts';
import { statusCommand } from './commands/status.ts';
import { latestCommand } from './commands/latest.ts';
import { sessionsCommand } from './commands/sessions.ts';
import { gcCli } from './commands/gc.ts';
import type { EventType } from './types.ts';

const VALID_EVENTS: EventType[] = [
  'session-start', 'session-end', 'turn-complete',
  'attention-permission', 'attention-idle',
  'user-prompt', 'tool-use',
];

const program = new Command();

program
  .name('sap')
  .description('Session Awareness Protocol — status tracking for Claude Code sessions')
  .version('0.1.0');

program
  .command('record')
  .description('Record a hook event (reads JSON from stdin)')
  .requiredOption('--event <type>', `Event type: ${VALID_EVENTS.join(', ')}`)
  .action((options) => {
    const eventType = options.event as string;
    if (!VALID_EVENTS.includes(eventType as EventType)) {
      process.stderr.write(`Unknown event type: ${eventType}\n`);
      process.exit(2);
    }

    let stdin: string;
    try {
      stdin = readFileSync(0, 'utf-8');
    } catch {
      process.stderr.write('Failed to read stdin\n');
      process.exit(2);
    }

    try {
      const payload = parsePayload(stdin);
      const db = openDb();
      recordEvent(db, eventType as EventType, payload);
      db.close();
    } catch (err) {
      process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
      process.exit(2);
    }
  });

program
  .command('status')
  .description('Show active session states')
  .option('--workspace <name>', 'Filter by workspace (e.g. "repo:branch")')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    statusCommand(db, options);
    db.close();
  });

program
  .command('latest')
  .description('Show most recent session for a workspace')
  .requiredOption('--workspace <name>', 'Workspace name (e.g. "repo:branch")')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    latestCommand(db, options);
    db.close();
  });

program
  .command('sessions')
  .description('Show session history')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--limit <n>', 'Number of sessions to show', '20')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    sessionsCommand(db, { ...options, limit: parseInt(options.limit, 10) });
    db.close();
  });

program
  .command('gc')
  .description('Clean up old sessions and events')
  .option('--older-than <duration>', 'Delete sessions older than (e.g. "30d")', '30d')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    gcCli(db, { olderThan: options.olderThan, json: options.json });
    db.close();
  });

program.parse();
