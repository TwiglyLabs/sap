import { Command } from 'commander';
import { createSap } from './sap.ts';
import { statusCommand, latestCommand, sessionsCommand, gcCli, sweepCli } from './features/sessions/session.cli.ts';
import { recordCli } from './features/recording/recording.cli.ts';
import { ingestCli } from './features/ingestion/ingestion.cli.ts';
import { summaryCli, toolsCli, sessionsAnalyticsCli, patternsCli, queryCli } from './features/analytics/analytics.cli.ts';

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
  .requiredOption('--event <type>', 'Event type: session-start, session-end, turn-complete, attention-permission, attention-idle, user-prompt, tool-use')
  .action((options) => {
    const sap = createSap();
    try {
      recordCli(sap.recording, options.event as string);
    } finally {
      sap.close();
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
    const sap = createSap();
    statusCommand(sap.sessions, options);
    sap.close();
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
    const sap = createSap();
    latestCommand(sap.sessions, options);
    sap.close();
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
    const sap = createSap();
    sessionsCommand(sap.sessions, { ...options, limit: parseInt(options.limit, 10) });
    sap.close();
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
    const sap = createSap();
    gcCli(sap.sessions, { olderThan: options.olderThan, json: options.json });
    sap.close();
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
    const sap = createSap();
    sweepCli(sap.sessions, options);
    sap.close();
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
    const sap = createSap();
    ingestCli(sap.ingestion, options);
    sap.close();
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
    const sap = createSap();
    queryCli(sap.analytics, sql, { json: true });
    sap.close();
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
    const sap = createSap();
    summaryCli(sap.analytics, options);
    sap.close();
  });

analytics
  .command('tools')
  .description('Per-tool usage breakdown with sequences.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const sap = createSap();
    toolsCli(sap.analytics, options);
    sap.close();
  });

analytics
  .command('sessions')
  .description('Per-session metrics for comparing efficiency.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--limit <n>', 'Number of sessions', '20')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const sap = createSap();
    sessionsAnalyticsCli(sap.analytics, options);
    sap.close();
  });

analytics
  .command('patterns')
  .description('Detect workflow patterns and anti-patterns.')
  .option('--since <duration>', 'Time window (e.g. "7d", "30d")', '7d')
  .option('--workspace <name>', 'Filter by workspace')
  .option('--json', 'Output as JSON')
  .action((options) => {
    const sap = createSap();
    patternsCli(sap.analytics, options);
    sap.close();
  });

program.parse();
