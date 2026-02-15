import { Command } from 'commander';

const program = new Command();

program
  .name('sap')
  .description('Session Awareness Protocol — status tracking for Claude Code sessions')
  .version('0.1.0');

program.parse();
