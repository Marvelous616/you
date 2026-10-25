import * as os from 'node:os';
import * as path from 'node:path';
import { MAX_REGRESSION_FACTOR } from './compare.js';

export interface BenchOptions {
  outputPath: string;
  hostLabel: string;
  comparePath?: string;
}

export const DEFAULT_OUTPUT = path.join('docs', 'benchmarks', 'bench-current.json');

export const USAGE = `Usage: node dist/index.js [options]

Runs the Life Logger benchmark suite and writes a JSON result file.

Options:
  --output <path>       Where to write the result JSON
                        (default: ${DEFAULT_OUTPUT})
  --host-label <label>  Label recorded in the result, for example "pc" or "server"
                        (default: $HOST_LABEL or the machine hostname)
  --compare <path>      Read a baseline JSON and fail if any metric is more
                        than ${MAX_REGRESSION_FACTOR}x slower than that baseline
  --help                Show this message
`;

function readValue(argv: string[], index: number, name: string): { value: string; next: number } {
  const inline = argv[index];
  const equals = inline.indexOf('=');
  if (equals !== -1) {
    const value = inline.slice(equals + 1);
    if (value.length === 0) throw new Error(`Missing value for ${name}`);
    return { value, next: index };
  }

  const value = argv[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${name}`);
  }
  return { value, next: index + 1 };
}

export function parseArgs(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env,
  hostname: string = os.hostname()
): BenchOptions {
  const options: BenchOptions = {
    outputPath: DEFAULT_OUTPUT,
    hostLabel: env.HOST_LABEL?.trim() || hostname,
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];

    if (arg === '--help' || arg === '-h') {
      throw new HelpRequested();
    } else if (arg === '--output' || arg.startsWith('--output=')) {
      const parsed = readValue(argv, index, '--output');
      options.outputPath = parsed.value;
      index = parsed.next;
    } else if (arg === '--host-label' || arg.startsWith('--host-label=')) {
      const parsed = readValue(argv, index, '--host-label');
      options.hostLabel = parsed.value;
      index = parsed.next;
    } else if (arg === '--compare' || arg.startsWith('--compare=')) {
      const parsed = readValue(argv, index, '--compare');
      options.comparePath = parsed.value;
      index = parsed.next;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
}

export class HelpRequested extends Error {
  constructor() {
    super('Help requested');
    this.name = 'HelpRequested';
  }
}
