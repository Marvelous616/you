import { describe, it, expect } from 'vitest';
import { Event, Day } from '../src/types.js';
import { computeTimelineLanes, findTimelineGaps, mergeIntervals } from '../src/timeline.js';

function event(id: string, startAt: string, endAt?: string): Event {
  return {
    id,
    dayId: 'day-2026-10-14',
    title: id,
    startAt,
    endAt,
    startPrecision: 'exact',
    endPrecision: 'exact',
    source: 'live',
    createdAt: startAt,
    updatedAt: startAt,
    isDeleted: false,
  };
}

function day(wakeAt?: string, sleepAt?: string): Day {
  return {
    id: 'day-2026-10-14',
    localDate: '2026-10-14',
    wakeAt,
    sleepAt,
    timezone: 'UTC',
    reviewStatus: 'unreviewed',
    fidelity: 'skipped',
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
    isDeleted: false,
  };
}

describe('computeTimelineLanes', () => {
  it('places three overlapping events on three lanes', () => {
    const events = [
      event('commute', '2026-10-14T08:30:00.000Z', '2026-10-14T09:15:00.000Z'),
      event('podcast', '2026-10-14T08:35:00.000Z', '2026-10-14T09:10:00.000Z'),
      event('texting', '2026-10-14T08:50:00.000Z', '2026-10-14T09:00:00.000Z'),
    ];

    const lanes = computeTimelineLanes(events);
    const byId = Object.fromEntries(lanes.map((lane) => [lane.event.id, lane]));

    expect(byId.commute.laneIndex).toBe(0);
    expect(byId.podcast.laneIndex).toBe(1);
    expect(byId.texting.laneIndex).toBe(2);
    expect(lanes.every((lane) => lane.totalLanes === 3)).toBe(true);
  });

  it('reuses lanes for non-overlapping events and keeps them full width', () => {
    const lanes = computeTimelineLanes([
      event('a', '2026-10-14T08:00:00.000Z', '2026-10-14T09:00:00.000Z'),
      event('b', '2026-10-14T09:00:00.000Z', '2026-10-14T10:00:00.000Z'),
      event('c', '2026-10-14T11:00:00.000Z', '2026-10-14T12:00:00.000Z'),
    ]);

    expect(lanes.find((lane) => lane.event.id === 'b')?.laneIndex).toBe(0);
    expect(lanes.find((lane) => lane.event.id === 'c')?.laneIndex).toBe(0);
    expect(lanes.every((lane) => lane.totalLanes === 1)).toBe(true);
  });

  it('treats a point event as a zero-length interval', () => {
    const lanes = computeTimelineLanes([
      event('point', '2026-10-14T08:00:00.000Z'),
      event('after', '2026-10-14T08:00:00.000Z', '2026-10-14T09:00:00.000Z'),
    ]);

    expect(lanes).toHaveLength(2);
    expect(lanes.find((lane) => lane.event.id === 'after')?.laneIndex).toBe(0);
    expect(lanes.find((lane) => lane.event.id === 'point')?.laneIndex).toBe(1);
    expect(lanes.every((lane) => lane.totalLanes === 2)).toBe(true);
  });
});

describe('findTimelineGaps', () => {
  it('returns unlogged gaps between events, ignoring overlaps', () => {
    const gaps = findTimelineGaps(
      day('2026-10-14T08:00:00.000Z', '2026-10-14T18:00:00.000Z'),
      [
        event('a', '2026-10-14T09:00:00.000Z', '2026-10-14T10:00:00.000Z'),
        event('b', '2026-10-14T09:30:00.000Z', '2026-10-14T10:30:00.000Z'),
        event('c', '2026-10-14T12:00:00.000Z', '2026-10-14T13:00:00.000Z'),
      ]
    );

    expect(gaps.map((gap) => [gap.startAt, gap.endAt])).toEqual([
      ['2026-10-14T08:00:00.000Z', '2026-10-14T09:00:00.000Z'],
      ['2026-10-14T10:30:00.000Z', '2026-10-14T12:00:00.000Z'],
      ['2026-10-14T13:00:00.000Z', '2026-10-14T18:00:00.000Z'],
    ]);
    expect(gaps.map((gap) => gap.durationMinutes)).toEqual([60, 90, 300]);
  });

  it('uses now as the end bound while the day is still open', () => {
    const gaps = findTimelineGaps(
      day('2026-10-14T08:00:00.000Z'),
      [event('a', '2026-10-14T09:00:00.000Z', '2026-10-14T10:00:00.000Z')],
      15,
      new Date('2026-10-14T12:00:00.000Z')
    );

    expect(gaps).toHaveLength(2);
    expect(gaps[1]).toMatchObject({
      startAt: '2026-10-14T10:00:00.000Z',
      endAt: '2026-10-14T12:00:00.000Z',
      durationMinutes: 120,
    });
  });

  it('filters out gaps shorter than the threshold', () => {
    const gaps = findTimelineGaps(
      day('2026-10-14T08:00:00.000Z', '2026-10-14T18:00:00.000Z'),
      [
        event('a', '2026-10-14T08:00:00.000Z', '2026-10-14T09:00:00.000Z'),
        event('b', '2026-10-14T09:10:00.000Z', '2026-10-14T18:00:00.000Z'),
      ],
      15
    );

    expect(gaps).toEqual([]);
  });

  it('returns no gaps when wake time is unknown', () => {
    expect(findTimelineGaps(day(), [event('a', '2026-10-14T09:00:00.000Z')])).toEqual([]);
  });
});

describe('mergeIntervals', () => {
  it('merges overlapping and touching intervals and clips to a window', () => {
    const merged = mergeIntervals(
      [
        { startMs: 0, endMs: 10 },
        { startMs: 10, endMs: 20 },
        { startMs: 15, endMs: 30 },
        { startMs: 50, endMs: 60 },
      ],
      5,
      55
    );

    expect(merged).toEqual([
      { startMs: 5, endMs: 30 },
      { startMs: 50, endMs: 55 },
    ]);
  });
});
