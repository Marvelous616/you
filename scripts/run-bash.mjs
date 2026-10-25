#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const gitBashCandidates = [
  'C:\\Program Files\\Git\\bin\\bash.exe',
  'C:\\Program Files (x86)\\Git\\bin\\bash.exe',
];

const bash =
  process.platform === 'win32'
    ? (gitBashCandidates.find((candidate) => existsSync(candidate)) ?? 'bash')
    : 'bash';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('Usage: node scripts/run-bash.mjs <script> [args...]');
  process.exit(2);
}

const result = spawnSync(bash, args, { stdio: 'inherit' });
if (result.error) {
  console.error(`Could not start bash (${bash}): ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
