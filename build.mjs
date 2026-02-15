import * as esbuild from 'esbuild';
import { chmodSync } from 'fs';

const minify = process.argv.includes('--minify');

// CLI binary — unchanged
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
  minify,
});

chmodSync('dist/sap.cjs', 0o755);

// Library module — new
await esbuild.build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: 'dist/index.js',
  external: ['better-sqlite3'],
  sourcemap: true,
  minify,
});
