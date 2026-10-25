import { describe, it, expect } from 'vitest';
import { DEFAULT_OUTPUT, HelpRequested, parseArgs } from '../src/cli.js';

describe('benchmark CLI arguments', () => {
  it('uses documented defaults', () => {
    const options = parseArgs([], {}, 'test-host');

    expect(options.outputPath).toBe(DEFAULT_OUTPUT);
    expect(options.hostLabel).toBe('test-host');
    expect(options.comparePath).toBeUndefined();
  });

  it('accepts separate and inline flag values', () => {
    expect(
      parseArgs(
        ['--output', 'out.json', '--host-label=server', '--compare', 'docs/benchmarks/pc.json'],
        {},
        'ignored'
      )
    ).toEqual({
      outputPath: 'out.json',
      hostLabel: 'server',
      comparePath: 'docs/benchmarks/pc.json',
    });

    expect(parseArgs(['--output=pc.json', '--compare=baseline.json'], {}, 'pc')).toEqual({
      outputPath: 'pc.json',
      hostLabel: 'pc',
      comparePath: 'baseline.json',
    });
  });

  it('prefers HOST_LABEL from the environment over the hostname', () => {
    expect(parseArgs([], { HOST_LABEL: 'pentium-server' }, 'hostname').hostLabel).toBe(
      'pentium-server'
    );
  });

  it('rejects unknown arguments and missing values', () => {
    expect(() => parseArgs(['--nope'], {}, 'pc')).toThrow(/Unknown argument/);
    expect(() => parseArgs(['--output'], {}, 'pc')).toThrow(/Missing value for --output/);
    expect(() => parseArgs(['--compare', '--host-label', 'pc'], {}, 'pc')).toThrow(
      /Missing value for --compare/
    );
  });

  it('reports help without running the benchmark', () => {
    expect(() => parseArgs(['--help'], {}, 'pc')).toThrow(HelpRequested);
  });
});
