export interface BenchmarkDocument {
  timestamp?: string;
  environment?: Record<string, unknown>;
  metrics: Record<string, number>;
  passedTargets?: Record<string, boolean>;
}

export interface Regression {
  name: string;
  baselineMs: number;
  currentMs: number;
  ratio: number;
}

/** A metric may not be more than this multiple of the baseline value. */
export const MAX_REGRESSION_FACTOR = 3;

/**
 * Compares two benchmark documents metric by metric. Only metrics that are
 * present as positive numbers in both documents are compared, so adding a new
 * metric does not fail against an older baseline.
 */
export function compareBenchmarks(
  current: BenchmarkDocument,
  baseline: BenchmarkDocument,
  factor: number = MAX_REGRESSION_FACTOR
): Regression[] {
  const regressions: Regression[] = [];

  for (const [name, baselineMs] of Object.entries(baseline.metrics)) {
    const currentMs = current.metrics[name];
    if (typeof currentMs !== 'number' || !Number.isFinite(currentMs)) continue;
    if (typeof baselineMs !== 'number' || !Number.isFinite(baselineMs) || baselineMs <= 0) continue;

    const ratio = currentMs / baselineMs;
    if (ratio > factor) {
      regressions.push({ name, baselineMs, currentMs, ratio });
    }
  }

  return regressions.sort((a, b) => b.ratio - a.ratio);
}

export function formatRegression(regression: Regression, factor: number = MAX_REGRESSION_FACTOR): string {
  return (
    `${regression.name}: ${regression.currentMs.toFixed(3)} ms is ` +
    `${regression.ratio.toFixed(2)}x the baseline of ${regression.baselineMs.toFixed(3)} ms ` +
    `(limit ${factor}x)`
  );
}
