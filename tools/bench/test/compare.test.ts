import { describe, it, expect } from 'vitest';
import {
  BenchmarkDocument,
  compareBenchmarks,
  formatRegression,
  MAX_REGRESSION_FACTOR,
} from '../src/compare.js';

function doc(metrics: Record<string, number>): BenchmarkDocument {
  return { timestamp: '2026-10-25T00:00:00.000Z', metrics };
}

describe('benchmark regression comparison', () => {
  const baseline = doc({
    singleMarkerSaveAvgMs: 0.25,
    batchIngest5000RecordsMs: 120,
    quickEntryParseAvgMs: 0.01,
  });

  it('passes when comparing the baseline against itself', () => {
    expect(compareBenchmarks(baseline, baseline)).toEqual([]);
  });

  it('fails when any metric is more than three times slower', () => {
    const slowed = doc({
      singleMarkerSaveAvgMs: 0.25,
      batchIngest5000RecordsMs: 120 * MAX_REGRESSION_FACTOR + 0.1,
      quickEntryParseAvgMs: 0.01,
    });

    const regressions = compareBenchmarks(slowed, baseline);
    expect(regressions).toHaveLength(1);
    expect(regressions[0].name).toBe('batchIngest5000RecordsMs');
    expect(regressions[0].ratio).toBeGreaterThan(MAX_REGRESSION_FACTOR);
  });

  it('passes exactly at the threshold and fails just above it', () => {
    const atLimit = doc({ batchIngest5000RecordsMs: 120 * MAX_REGRESSION_FACTOR });
    const aboveLimit = doc({ batchIngest5000RecordsMs: 120 * MAX_REGRESSION_FACTOR + 0.01 });

    expect(compareBenchmarks(atLimit, baseline)).toEqual([]);
    expect(compareBenchmarks(aboveLimit, baseline)).toHaveLength(1);
  });

  it('ignores metrics that are new, missing, or non-positive in the baseline', () => {
    const current = doc({ batchIngest5000RecordsMs: 120, brandNewMetricMs: 999 });
    const sparseBaseline = doc({ batchIngest5000RecordsMs: 120, zeroBaselineMs: 0 });

    expect(compareBenchmarks(current, sparseBaseline)).toEqual([]);
  });

  it('formats a regression with both values and the limit', () => {
    const message = formatRegression({
      name: 'batchIngest5000RecordsMs',
      baselineMs: 120,
      currentMs: 480,
      ratio: 4,
    });

    expect(message).toContain('batchIngest5000RecordsMs');
    expect(message).toContain('480.000 ms');
    expect(message).toContain('4.00x');
    expect(message).toContain('120.000 ms');
    expect(message).toContain('limit 3x');
  });
});
