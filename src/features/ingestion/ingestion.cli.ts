import chalk from 'chalk';
import { parseDuration } from '../../core/utils.ts';
import type { IngestionService } from './ingestion.service.ts';
import type { BatchOptions } from './ingestion.types.ts';

export interface IngestCliOptions {
  session?: string;
  since?: string;
  force?: boolean;
  json?: boolean;
}

export function ingestCli(service: IngestionService, options: IngestCliOptions): void {
  const batchOptions: BatchOptions = {
    sessionId: options.session,
    force: options.force,
  };

  if (options.since) {
    batchOptions.sinceMs = parseDuration(options.since);
  }

  const result = service.ingestBatch(batchOptions);

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
