import { Command } from 'commander';
import { readFileSync } from 'fs';
import { openDb } from './db.ts';
import { recordEvent, parsePayload } from './commands/record.ts';
import { statusCommand } from './commands/status.ts';
import { latestCommand } from './commands/latest.ts';
import { sessionsCommand } from './commands/sessions.ts';
import { gcCli } from './commands/gc.ts';
import { sweepCli } from './commands/sweep.ts';
import { ingestCli } from './commands/ingest.ts';
import { queryCli } from './commands/query.ts';
import { summaryCli } from './commands/analytics-summary.ts';
import { toolsCli } from './commands/analytics-tools.ts';
import { sessionsAnalyticsCli } from './commands/analytics-sessions.ts';
import { patternsCli } from './commands/analytics-patterns.ts';
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

program
  .command('query')
  .description(
    'Execute a read-only SQL query against the sap database.\n\n' +
    'Returns results as a JSON array of row objects.\n' +
    'Write statements (INSERT, UPDATE, DELETE, etc.) are rejected.\n\n' +
    'Available tables: sessions, events, workspaces, turns, tool_calls.\n\n' +
    'Example:\n' +
    '  sap query "SELECT tool_name, count(*) as n FROM tool_calls GROUP BY tool_name ORDER BY n DESC"\n' +
    '  sap query "SELECT workspace, sum(output_tokens) FROM turns t JOIN sessions s ON t.session_id = s.session_id GROUP BY workspace"'
  )
  .argument('<sql>', 'SQL query to execute')
  .action((sql) => {
    const db = openDb();
    queryCli(db, sql, { json: true });
    db.close();
  });

const analytics = program
  .command('analytics')
  .description('Analyze Claude Code usage patterns.');

analytics
  .command('summary')
  .description('High-level usage summary over a time window.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    summaryCli(db, options);
    db.close();
  });

analytics
  .command('tools')
  .description('Per-tool usage breakdown with sequences.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    toolsCli(db, options);
    db.close();
  });

analytics
  .command('sessions')
  .description('Per-session metrics for comparing efficiency.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--limit <n>', 'Number of sessions', '20')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    sessionsAnalyticsCli(db, options);
    db.close();
  });

analytics
  .command('patterns')
  .description('Detect workflow patterns and anti-patterns.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const db = openDb();
    patternsCli(db, options);
    db.close();
  });

program.parse();
