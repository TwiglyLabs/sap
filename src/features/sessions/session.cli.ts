import chalk from 'chalk';
import { parseDuration } from '../../core/utils.ts';
import type { SessionService } from './session.service.ts';

interface StatusOptions {
  workspace?: string;
  json?: boolean;
  group?: boolean;
}

export function statusCommand(service: SessionService, options: StatusOptions): void {
  if (options.group) {
    const result = service.statusGrouped(options.workspace);

    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    const entries = Object.entries(result.workspaces);
    if (entries.length === 0) {
      console.log('No active sessions.');
      return;
    }

    for (const [ws, sessions] of entries) {
      console.log(chalk.white.bold(ws));
      for (const s of sessions) {
        const stateColor = s.state === 'active' ? chalk.green
          : s.state === 'idle' ? chalk.blue
          : s.state === 'attention' ? chalk.yellow
          : chalk.gray;

        const staleTag = s.stale ? chalk.red(' [stale]') : '';
        const toolInfo = s.last_tool ? ` ${chalk.dim(s.last_tool)}${s.last_tool_detail ? chalk.dim(`:${s.last_tool_detail}`) : ''}` : '';

        console.log(`    ${stateColor(s.state)}${staleTag}${toolInfo} ${chalk.dim(s.session_id)}`);
      }
    }
    return;
  }

  const result = service.status(options.workspace);

  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }

  if (result.sessions.length === 0) {
    console.log('No active sessions.');
    return;
  }

  for (const s of result.sessions) {
    const stateColor = s.state === 'active' ? chalk.green
      : s.state === 'idle' ? chalk.blue
      : s.state === 'attention' ? chalk.yellow
      : chalk.gray;

    const staleTag = s.stale ? chalk.red(' [stale]') : '';
    const toolInfo = s.last_tool ? ` ${chalk.dim(s.last_tool)}${s.last_tool_detail ? chalk.dim(`:${s.last_tool_detail}`) : ''}` : '';

    console.log(`  ${chalk.white(s.workspace)} ${stateColor(s.state)}${staleTag}${toolInfo}`);
  }
}

interface LatestOptions {
  workspace: string;
  json?: boolean;
}

export function latestCommand(service: SessionService, options: LatestOptions): void {
  const session = service.latest(options.workspace);

  if (options.json) {
    console.log(JSON.stringify({ session }, null, 2));
    return;
  }

  if (!session) {
    console.log(`No sessions found for ${options.workspace}.`);
    process.exitCode = 1;
    return;
  }

  const stateColor = session.state === 'active' ? chalk.green
    : session.state === 'idle' ? chalk.blue
    : session.state === 'attention' ? chalk.yellow
    : chalk.gray;

  console.log(`  ${chalk.white(session.workspace)} ${stateColor(session.state)}`);
  console.log(`  Session: ${session.session_id}`);
  if (session.transcript_path) {
    console.log(`  Transcript: ${chalk.dim(session.transcript_path)}`);
  }
}

interface SessionsCommandOptions {
  workspace?: string;
  limit?: number;
  json?: boolean;
}

export function sessionsCommand(service: SessionService, options: SessionsCommandOptions): void {
  const limit = options.limit ?? 20;
  const result = service.sessions({ workspace: options.workspace, limit });

  if (options.json) {
    console.log(JSON.stringify({ sessions: result }, null, 2));
    return;
  }

  if (result.length === 0) {
    console.log('No sessions found.');
    return;
  }

  for (const s of result) {
    const stateColor = s.state === 'active' ? chalk.green
      : s.state === 'idle' ? chalk.blue
      : s.state === 'attention' ? chalk.yellow
      : chalk.gray;

    const date = new Date(s.started_at).toLocaleString();
    console.log(`  ${chalk.dim(date)} ${chalk.white(s.workspace)} ${stateColor(s.state)} ${chalk.dim(s.session_id)}`);
  }
}

interface GcOptions {
  olderThan?: string;
  json?: boolean;
}

export function gcCli(service: SessionService, options: GcOptions): void {
  const threshold = parseDuration(options.olderThan ?? '30d');
  const deleted = service.gc(threshold);

  if (options.json) {
    console.log(JSON.stringify({ deleted }));
    return;
  }

  if (deleted === 0) {
    console.log('Nothing to clean up.');
  } else {
    console.log(`${chalk.green('Cleaned up')} ${deleted} session${deleted === 1 ? '' : 's'}.`);
  }
}

interface SweepOptions {
  threshold?: string;
  json?: boolean;
}

const DEFAULT_THRESHOLD_MS = 10 * 60 * 1000;

export function sweepCli(service: SessionService, options: SweepOptions): void {
  const thresholdMs = options.threshold
    ? parseDuration(options.threshold)
    : DEFAULT_THRESHOLD_MS;
  const swept = service.sweep(thresholdMs);

  if (options.json) {
    console.log(JSON.stringify({ swept }));
    return;
  }

  if (swept === 0) {
    console.log('No stale sessions found.');
  } else {
    console.log(`${chalk.green('Swept')} ${swept} stale session${swept === 1 ? '' : 's'}.`);
  }
}
