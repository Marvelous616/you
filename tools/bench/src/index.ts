import {
  DatabaseSync,
  runMigrations,
  SqliteMarkerRepository,
  SqliteDayRepository,
  SqliteEventRepository,
  SqliteSuggestionRepository,
} from '@life-logger/persistence';
import {
  acceptSuggestion,
  buildEventFromSuggestion,
  calendarEventsToSuggestions,
  computeTimelineLanes,
  parseIcsCalendar,
  parseQuickEntry,
} from '@life-logger/domain';
import { generateEventDataset, generateSyntheticDataset } from './generator.js';
import * as fs from 'node:fs';
import * as path from 'node:path';

const PARSER_SAMPLES = [
  'lunch with @rahul at 1pm #food/lunch',
  'coding 2pm - 5pm #work/coding',
  'read #reading for 45m',
  'call @mom at 9:15am',
  'gym 6pm to 7:30pm #health',
  'coffee #food at 10',
  'write review for 1.5h #work',
  'walk with @sarah #health/walk',
  'deep work noon - 3pm #work/coding',
  'shower #hygiene/morning for 15m',
];

function percentile(sortedSamples: number[], ratio: number): number {
  return sortedSamples[Math.min(sortedSamples.length - 1, Math.floor(sortedSamples.length * ratio))];
}

function generateIcsCalendar(count: number): string {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Life Logger Bench//EN'];
  for (let index = 0; index < count; index++) {
    const day = String((index % 28) + 1).padStart(2, '0');
    const hour = String(9 + (index % 8)).padStart(2, '0');
    lines.push(
      'BEGIN:VEVENT',
      `UID:bench-event-${index}@example.com`,
      `SUMMARY:Bench event ${index}`,
      `DTSTART:202610${day}T${hour}0000Z`,
      `DTEND:202610${day}T${hour}3000Z`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

async function runBenchmark() {
  console.log('====================================================');
  console.log('Running Life Logger Increment 3 Benchmark Suite');
  console.log('====================================================');

  const db = new DatabaseSync(':memory:');
  runMigrations(db);

  const markerRepo = new SqliteMarkerRepository(db);
  const dayRepo = new SqliteDayRepository(db);
  const eventRepo = new SqliteEventRepository(db);
  const suggestionRepo = new SqliteSuggestionRepository(db);

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
  const avgSingleSaveMs =
    singleMarkerSamples.reduce((a, b) => a + b, 0) / singleMarkerSamples.length;
  const p95SingleSaveMs = percentile([...singleMarkerSamples].sort((a, b) => a - b), 0.95);

  console.log(
    `[Metric 1] Single Marker Save (Avg): ${avgSingleSaveMs.toFixed(3)} ms (Target: < 50 ms)`
  );
  console.log(`[Metric 1] Single Marker Save (p95): ${p95SingleSaveMs.toFixed(3)} ms`);

  // 2. Batch Sync Ingest of 5,000 records (Target: < 500ms)
  const batchStart = performance.now();
  await markerRepo.saveBatch(markers);
  const batchDurationMs = performance.now() - batchStart;

  console.log(
    `[Metric 2] Batch Sync Ingest (${datasetSize} records): ${batchDurationMs.toFixed(
      2
    )} ms (Target: < 500 ms)`
  );

  // 3. Single Day Markers Query Latency (Target: < 15ms)
  const targetDayId = days[0].id;
  const querySamples: number[] = [];
  for (let i = 0; i < 50; i++) {
    const qStart = performance.now();
    await markerRepo.listByDay(targetDayId);
    querySamples.push(performance.now() - qStart);
  }
  const avgQueryMs = querySamples.reduce((a, b) => a + b, 0) / querySamples.length;
  console.log(
    `[Metric 3] Day Timeline Query (Avg): ${avgQueryMs.toFixed(3)} ms (Target: < 15 ms)`
  );

  // 4. Quick-entry parser latency (Target: < 2ms, never throws)
  const parseSamples: number[] = [];
  for (let i = 0; i < 2000; i++) {
    const sample = PARSER_SAMPLES[i % PARSER_SAMPLES.length];
    const pStart = performance.now();
    parseQuickEntry(sample, new Date());
    parseSamples.push(performance.now() - pStart);
  }
  const avgParseMs = parseSamples.reduce((a, b) => a + b, 0) / parseSamples.length;
  const sortedParse = [...parseSamples].sort((a, b) => a - b);
  const p95ParseMs = percentile(sortedParse, 0.95);
  console.log(
    `[Metric 4] Quick-Entry Parse (Avg): ${avgParseMs.toFixed(3)} ms (Target: < 2 ms)`
  );
  console.log(`[Metric 4] Quick-Entry Parse (p95): ${p95ParseMs.toFixed(3)} ms`);

  // 5. Single event save latency (Target: < 15ms)
  const events = generateEventDataset(targetDayId, 50);
  const eventSaveSamples: number[] = [];
  for (const event of events) {
    const eStart = performance.now();
    await eventRepo.save(event);
    eventSaveSamples.push(performance.now() - eStart);
  }
  const avgEventSaveMs = eventSaveSamples.reduce((a, b) => a + b, 0) / eventSaveSamples.length;
  console.log(
    `[Metric 5] Single Event Save (Avg): ${avgEventSaveMs.toFixed(3)} ms (Target: < 15 ms)`
  );

  // 6. Multi-lane timeline computation for a 50-event day (Target: < 30ms)
  const laneSamples: number[] = [];
  for (let i = 0; i < 200; i++) {
    const lStart = performance.now();
    computeTimelineLanes(events);
    laneSamples.push(performance.now() - lStart);
  }
  const avgLaneMs = laneSamples.reduce((a, b) => a + b, 0) / laneSamples.length;
  const sortedLane = [...laneSamples].sort((a, b) => a - b);
  const p95LaneMs = percentile(sortedLane, 0.95);
  console.log(
    `[Metric 6] 50-Event Lane Layout (Avg): ${avgLaneMs.toFixed(3)} ms (Target: < 30 ms)`
  );
  console.log(`[Metric 6] 50-Event Lane Layout (p95): ${p95LaneMs.toFixed(3)} ms`);

  // 7. Calendar (ICS) parse latency for a 200-event file (Target: < 50ms)
  const icsText = generateIcsCalendar(200);
  const icsSamples: number[] = [];
  let parsedEvents = parseIcsCalendar(icsText).events;
  for (let i = 0; i < 50; i++) {
    const icsStart = performance.now();
    const parsed = parseIcsCalendar(icsText);
    icsSamples.push(performance.now() - icsStart);
    parsedEvents = parsed.events;
  }
  const avgIcsParseMs = icsSamples.reduce((a, b) => a + b, 0) / icsSamples.length;
  console.log(
    `[Metric 7] ICS Parse (200 events): ${avgIcsParseMs.toFixed(3)} ms (Target: < 50 ms)`
  );

  // 8. Calendar event to deterministic suggestion conversion (Target: < 25ms)
  const suggestionNow = new Date('2026-10-14T08:00:00.000Z');
  const buildSamples: number[] = [];
  let calendarSuggestions = calendarEventsToSuggestions(parsedEvents, { now: suggestionNow });
  for (let i = 0; i < 50; i++) {
    const buildStart = performance.now();
    calendarSuggestions = calendarEventsToSuggestions(parsedEvents, { now: suggestionNow });
    buildSamples.push(performance.now() - buildStart);
  }
  const avgSuggestionBuildMs =
    buildSamples.reduce((a, b) => a + b, 0) / buildSamples.length;
  console.log(
    `[Metric 8] Calendar Suggestion Build (200 events): ${avgSuggestionBuildMs.toFixed(
      3
    )} ms (Target: < 25 ms)`
  );

  // 9. Suggestion inbox write latency (Target: < 15ms)
  const suggestionSaveSamples: number[] = [];
  for (const suggestion of calendarSuggestions) {
    const saveStart = performance.now();
    await suggestionRepo.save(suggestion);
    suggestionSaveSamples.push(performance.now() - saveStart);
  }
  const avgSuggestionSaveMs =
    suggestionSaveSamples.reduce((a, b) => a + b, 0) / suggestionSaveSamples.length;
  console.log(
    `[Metric 9] Suggestion Save (Avg): ${avgSuggestionSaveMs.toFixed(3)} ms (Target: < 15 ms)`
  );

  // 10. Pending suggestion inbox query (Target: < 15ms)
  const listSamples: number[] = [];
  for (let i = 0; i < 50; i++) {
    const listStart = performance.now();
    await suggestionRepo.listByStatus('pending');
    listSamples.push(performance.now() - listStart);
  }
  const avgSuggestionListMs = listSamples.reduce((a, b) => a + b, 0) / listSamples.length;
  console.log(
    `[Metric 10] Pending Suggestion Query (Avg): ${avgSuggestionListMs.toFixed(
      3
    )} ms (Target: < 15 ms)`
  );

  // 11. Accept flow: suggestion update plus imported event write (Target: < 25ms)
  const acceptSamples: number[] = [];
  const pendingSuggestions = await suggestionRepo.listByStatus('pending');
  for (let i = 0; i < 50 && i < pendingSuggestions.length; i++) {
    const suggestion = pendingSuggestions[i];
    const acceptStart = performance.now();
    const acceptedAt = new Date(
      Math.max(
        suggestionNow.getTime(),
        new Date(suggestion.updatedAt).getTime()
      ) + i + 1
    );
    const accepted = acceptSuggestion(suggestion, undefined, {
      eventId: `bench-accepted-${i}`,
      dayId: targetDayId,
      now: acceptedAt,
      source: 'imported',
    });
    const acceptedEvent = buildEventFromSuggestion(accepted.proposed, {
      eventId: `bench-accepted-${i}`,
      dayId: targetDayId,
      now: acceptedAt,
      source: 'imported',
    });
    await eventRepo.save(acceptedEvent);
    await suggestionRepo.save(accepted.suggestion);
    acceptSamples.push(performance.now() - acceptStart);
  }
  const avgAcceptFlowMs = acceptSamples.reduce((a, b) => a + b, 0) / acceptSamples.length;
  console.log(
    `[Metric 11] Suggestion Accept Flow (Avg): ${avgAcceptFlowMs.toFixed(
      3
    )} ms (Target: < 25 ms)`
  );

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
      quickEntryParseAvgMs: avgParseMs,
      quickEntryParseP95Ms: p95ParseMs,
      singleEventSaveAvgMs: avgEventSaveMs,
      timelineLanes50EventsAvgMs: avgLaneMs,
      timelineLanes50EventsP95Ms: p95LaneMs,
      icsParse200EventsAvgMs: avgIcsParseMs,
      calendarSuggestionBuild200EventsAvgMs: avgSuggestionBuildMs,
      singleSuggestionSaveAvgMs: avgSuggestionSaveMs,
      pendingSuggestionQueryAvgMs: avgSuggestionListMs,
      suggestionAcceptFlowAvgMs: avgAcceptFlowMs,
    },
    passedTargets: {
      singleMarkerSave: avgSingleSaveMs < 50,
      batchIngest: batchDurationMs < 500,
      dayTimelineQuery: avgQueryMs < 15,
      quickEntryParse: avgParseMs < 2,
      singleEventSave: avgEventSaveMs < 15,
      timelineLanes50Events: avgLaneMs < 30,
      icsParse200Events: avgIcsParseMs < 50,
      calendarSuggestionBuild200Events: avgSuggestionBuildMs < 25,
      singleSuggestionSave: avgSuggestionSaveMs < 15,
      pendingSuggestionQuery: avgSuggestionListMs < 15,
      suggestionAcceptFlow: avgAcceptFlowMs < 25,
    },
  };

  const outputDir = path.resolve(process.cwd(), 'docs', 'benchmarks');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const outputPath = path.join(outputDir, 'increment-3-baseline.json');
  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf8');
  console.log(`\nBenchmark metrics successfully recorded to ${outputPath}`);

  const failedTargets = Object.entries(results.passedTargets)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
  if (failedTargets.length > 0) {
    throw new Error(`Benchmark targets failed: ${failedTargets.join(', ')}`);
  }
}

runBenchmark().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
