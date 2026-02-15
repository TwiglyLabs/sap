import * as esbuild from 'esbuild';
import { chmodSync } from 'fs';

await esbuild.build({
  entryPoints: ['src/cli.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: 'dist/sap.cjs',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: ['better-sqlite3'],
  minify: process.argv.includes('--minify'),
});

chmodSync('dist/sap.cjs', 0o755);
