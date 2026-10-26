#!/usr/bin/env node
//
// Bundles the compiled Fastify server into a single CommonJS file so the
// package needs no node_modules. Run after `npm run build`, from the repository
// root: `node packaging/bundle-server.mjs <outfile>`.
//
// CommonJS output keeps Fastify's dynamic requires working. `import.meta.url`
// is replaced with the bundle's own location, which is what the persistence
// package uses to create its `node:sqlite` require.
import { build } from 'esbuild';
import { mkdirSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';

const outfile = resolve(process.argv[2] ?? 'build/server.cjs');
const entry = resolve('apps/server/dist/index.js');

mkdirSync(dirname(outfile), { recursive: true });

await build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  define: { 'import.meta.url': '__lifelogger_import_meta_url' },
  banner: {
    js: "const __lifelogger_import_meta_url = require('node:url').pathToFileURL(__filename).href;",
  },
});

console.log(`Bundled ${relative(process.cwd(), entry)} -> ${relative(process.cwd(), outfile)}`);
