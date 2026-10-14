import { DatabaseSync, runMigrations, SqliteMarkerRepository, SqliteDayRepository } from '@life-logger/persistence';
import { generateSyntheticDataset } from './generator.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

async function runBenchmark() {
  console.log('====================================================');
  console.log('🚀 Running Life Logger Increment 1 Benchmark Suite');
  console.log('====================================================');

  const db = new DatabaseSync(':memory:');
  runMigrations(db);

  const markerRepo = new SqliteMarkerRepository(db);
  const dayRepo = new SqliteDayRepository(db);

  const datasetSize = 5000;
  console.log(`Generating synthetic dataset with ${datasetSize} markers...`);
  const { days, markers } = generateSyntheticDataset(datasetSize);

  for (const d of days) {
    await dayRepo.save(d);
  }

  // 1. Single Marker Save Latency (Phone Target: < 50ms)
  const singleMarkerSamples: number[] = [];
  for (let i = 0; i < 50; i++) {
    const testMarker = markers[i];
    const start = performance.now();
    await markerRepo.save(testMarker);
    const duration = performance.now() - start;
    singleMarkerSamples.push(duration);
  }
  const avgSingleSaveMs = singleMarkerSamples.reduce((a, b) => a + b, 0) / singleMarkerSamples.length;
  const p95SingleSaveMs = singleMarkerSamples.sort((a, b) => a - b)[Math.floor(singleMarkerSamples.length * 0.95)];

  console.log(`[Metric 1] Single Marker Save (Avg): ${avgSingleSaveMs.toFixed(3)} ms (Target: < 50 ms)`);
  console.log(`[Metric 1] Single Marker Save (p95): ${p95SingleSaveMs.toFixed(3)} ms`);

  // 2. Batch Sync Ingest of 5,000 records (Target: < 500ms)
  const batchStart = performance.now();
  await markerRepo.saveBatch(markers);
  const batchDurationMs = performance.now() - batchStart;

  console.log(`[Metric 2] Batch Sync Ingest (${datasetSize} records): ${batchDurationMs.toFixed(2)} ms (Target: < 500 ms)`);

  // 3. Single Day Markers Query Latency (Target: < 15ms)
  const targetDayId = days[0].id;
  const querySamples: number[] = [];
  for (let i = 0; i < 50; i++) {
    const qStart = performance.now();
    const dayMarkers = await markerRepo.listByDay(targetDayId);
    const qDur = performance.now() - qStart;
    querySamples.push(qDur);
    if (i === 0) {
      console.log(`  Loaded ${dayMarkers.length} markers for day ${targetDayId}`);
    }
  }
  const avgQueryMs = querySamples.reduce((a, b) => a + b, 0) / querySamples.length;
  console.log(`[Metric 3] Day Timeline Query (Avg): ${avgQueryMs.toFixed(3)} ms (Target: < 15 ms)`);

  const results = {
    timestamp: new Date().toISOString(),
    environment: {
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    metrics: {
      singleMarkerSaveAvgMs: avgSingleSaveMs,
      singleMarkerSaveP95Ms: p95SingleSaveMs,
      batchIngest5000RecordsMs: batchDurationMs,
      dayTimelineQueryAvgMs: avgQueryMs,
    },
    passedTargets: {
      singleMarkerSave: avgSingleSaveMs < 50,
      batchIngest: batchDurationMs < 500,
      dayTimelineQuery: avgQueryMs < 15,
    },
  };

  const outputDir = path.resolve(process.cwd(), 'docs', 'benchmarks');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'increment-1-baseline.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\n✅ Benchmark metrics successfully recorded to ${outputPath}`);
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
