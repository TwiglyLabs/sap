import { Command } from 'commander';
import { readFileSync } from 'fs';
import { openDb } from './db.ts';
import { recordEvent, parsePayload } from './commands/record.ts';
import { statusCommand } from './commands/status.ts';
import { latestCommand } from './commands/latest.ts';
import { sessionsCommand } from './commands/sessions.ts';
import { gcCli } from './commands/gc.ts';
import { sweepCli } from './commands/sweep.ts';
import type { EventType } from './types.ts';

const VALID_EVENTS: EventType[] = [
  'session-start', 'session-end', 'turn-complete',
  'attention-permission', 'attention-idle',
  'user-prompt', 'tool-use',
];

const program = new Command();

program
  .name('sap')
  .description(
    'Session Awareness Protocol — tracks the lifecycle of Claude Code sessions.\n\n' +
    'Sessions transition through states: active → idle → attention → stopped.\n' +
    'A session is "stale" when its last event is older than 10 minutes,\n' +
    'indicating it may have disconnected without sending session-end.\n\n' +
    'Data is stored in a local SQLite database (default: ~/.sap/sap.db).\n' +
    'Set SAP_DB_PATH to override the database location.'
  )
  .version('0.1.0');

program
  .command('record')
  .description(
    'Record a hook event from Claude Code (reads JSON payload from stdin).\n\n' +
    'Event types:\n' +
    '  session-start     Session created or resumed (source: startup|resume|clear|compact)\n' +
    '  session-end       Session finished (includes reason)\n' +
    '  tool-use          Tool invocation (includes tool_name, tool_input)\n' +
    '  turn-complete     Agent turn finished, waiting for next prompt\n' +
    '  attention-permission  Waiting for user permission approval\n' +
    '  attention-idle    Idle and awaiting user input\n' +
    '  user-prompt       User submitted a new prompt\n\n' +
    'Required JSON fields: session_id, cwd.\n' +
    'Exit codes: 0 = success, 2 = invalid input or processing error.\n\n' +
    'Example:\n' +
    '  echo \'{"session_id":"abc","cwd":"/repo"}\' | sap record --event session-start'
  )
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
  .description(
    'Show all non-stopped sessions and their current state.\n\n' +
    'Flat JSON output (default): { "sessions": [{ session_id, workspace, state, stale, ... }] }\n' +
    'Grouped JSON output (--group): { "workspaces": { "repo:branch": [sessions...] } }\n\n' +
    'Example:\n' +
    '  sap status --json\n' +
    '  sap status --group --workspace myrepo:main'
  )
  .option('--workspace <name>', 'Filter by workspace (e.g. "repo:branch")')
  .option('--group', 'Group sessions by workspace')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    statusCommand(db, options);
    db.close();
  });

program
  .command('latest')
  .description(
    'Show the most recent session for a given workspace.\n\n' +
    'JSON output: full session object or null if no sessions found.\n' +
    'Fields: session_id, workspace, cwd, state, started_at, ended_at,\n' +
    '        last_event_at, last_tool, last_tool_detail, transcript_path.\n\n' +
    'Example:\n' +
    '  sap latest --workspace myrepo:main --json'
  )
  .requiredOption('--workspace <name>', 'Workspace name (e.g. "repo:branch")')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    latestCommand(db, options);
    db.close();
  });

program
  .command('sessions')
  .description(
    'Show session history across all workspaces.\n\n' +
    'JSON output: { "sessions": [{ session_id, workspace, state, started_at, ... }] }\n' +
    'Returns the N most recent sessions, ordered by started_at descending.\n\n' +
    'Example:\n' +
    '  sap sessions --limit 5 --json\n' +
    '  sap sessions --workspace myrepo:main'
  )
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
  .description(
    'Delete old sessions and their associated events.\n\n' +
    'Removes stopped sessions with ended_at older than the threshold,\n' +
    'and non-stopped sessions with last_event_at older than the threshold.\n' +
    'Duration format: Nd (e.g. "30d" = 30 days, "7d" = 7 days).\n\n' +
    'JSON output: { "deleted": N }\n\n' +
    'Example:\n' +
    '  sap gc --older-than 7d --json'
  )
  .option('--older-than <duration>', 'Delete sessions older than (e.g. "30d")', '30d')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    gcCli(db, { olderThan: options.olderThan, json: options.json });
    db.close();
  });

program
  .command('sweep')
  .description(
    'Mark stale sessions as stopped.\n\n' +
    'Transitions any non-stopped session whose last_event_at is older\n' +
    'than the threshold to the stopped state. Useful for cleaning up\n' +
    'sessions that disconnected without sending session-end.\n' +
    'Threshold format: Nm (e.g. "10m" = 10 minutes, "30m" = 30 minutes).\n\n' +
    'JSON output: { "swept": N }\n\n' +
    'Example:\n' +
    '  sap sweep --threshold 30m --json'
  )
  .option('--threshold <duration>', 'Staleness threshold (e.g. "10m", "30m")', '10m')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    sweepCli(db, options);
    db.close();
  });

program.parse();
