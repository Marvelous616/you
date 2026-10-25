import { describe, it, expect } from 'vitest';
import { Day, Event, JournalEntry } from '../src/types.js';
import {
  beginDayReview,
  calculateDayCoverage,
  calculateDayFidelity,
  completeDayReview,
  sleepDay,
  wakeDay,
} from '../src/day-lifecycle.js';

function makeDay(patch: Partial<Day> = {}): Day {
  return {
    id: 'day-2026-10-14',
    localDate: '2026-10-14',
    timezone: 'UTC',
    reviewStatus: 'unreviewed',
    fidelity: 'skipped',
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
    isDeleted: false,
    ...patch,
  };
}

function event(id: string, startAt: string, endAt: string): Event {
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

function journal(body: string): JournalEntry {
  return {
    id: 'j-1',
    dayId: 'day-2026-10-14',
    body,
    writtenAt: '2026-10-14T22:00:00.000Z',
    source: 'live',
    createdAt: '2026-10-14T22:00:00.000Z',
    updatedAt: '2026-10-14T22:00:00.000Z',
    isDeleted: false,
  };
}

describe('Day lifecycle', () => {
  it('records wake once and records sleep without closing the review', () => {
    const day = makeDay();
    const woken = wakeDay(day, '2026-10-14T08:00:00.000Z', {
      now: new Date('2026-10-14T08:00:00.000Z'),
    });
    const reWoken = wakeDay(woken, '2026-10-14T09:00:00.000Z', {
      now: new Date('2026-10-14T09:00:00.000Z'),
    });
    const slept = sleepDay(reWoken, '2026-10-14T23:00:00.000Z', {
      now: new Date('2026-10-14T23:00:00.000Z'),
    });

    expect(reWoken.wakeAt).toBe('2026-10-14T08:00:00.000Z');
    expect(slept.sleepAt).toBe('2026-10-14T23:00:00.000Z');
    expect(slept.reviewStatus).toBe('unreviewed');
  });

  it('moves the review through in_progress to completed', () => {
    const day = makeDay({
      wakeAt: '2026-10-14T08:00:00.000Z',
      sleepAt: '2026-10-14T18:00:00.000Z',
    });
    const inReview = beginDayReview(day, { now: new Date('2026-10-14T22:00:00.000Z') });
    expect(inReview.reviewStatus).toBe('in_progress');

    const completed = completeDayReview(
      inReview,
      [event('work', '2026-10-14T09:00:00.000Z', '2026-10-14T17:30:00.000Z')],
      [journal('A good day.')],
      { now: new Date('2026-10-14T22:00:00.000Z') }
    );
    expect(completed.reviewStatus).toBe('completed');
    expect(completed.fidelity).toBe('detailed');
  });
});

describe('calculateDayFidelity', () => {
  it('returns skipped without a wake time', () => {
    expect(calculateDayFidelity(makeDay(), [], [])).toBe('skipped');
  });

  it('returns detailed for >=75% coverage plus a journal', () => {
    const day = makeDay({
      wakeAt: '2026-10-14T08:00:00.000Z',
      sleepAt: '2026-10-14T18:00:00.000Z',
    });
    const events = [
      event('a', '2026-10-14T08:00:00.000Z', '2026-10-14T15:30:00.000Z'),
    ];
    expect(calculateDayFidelity(day, events, [journal('Busy day')])).toBe('detailed');
  });

  it('does not double-count overlapping events', () => {
    const day = makeDay({
      wakeAt: '2026-10-14T08:00:00.000Z',
      sleepAt: '2026-10-14T18:00:00.000Z',
    });
    const events = [
      event('a', '2026-10-14T08:00:00.000Z', '2026-10-14T12:00:00.000Z'),
      event('b', '2026-10-14T10:00:00.000Z', '2026-10-14T14:00:00.000Z'),
    ];
    // Union is 08:00-14:00 = 6h = 60%, which is summary, not detailed.
    expect(calculateDayFidelity(day, events, [])).toBe('summary');
  });

  it('returns summary for >=30% coverage without a journal', () => {
    const day = makeDay({
      wakeAt: '2026-10-14T08:00:00.000Z',
      sleepAt: '2026-10-14T18:00:00.000Z',
    });
    const events = [
      event('a', '2026-10-14T08:00:00.000Z', '2026-10-14T11:30:00.000Z'),
    ];
    expect(calculateDayFidelity(day, events, [])).toBe('summary');
  });

  it('returns summary for a journal even with no coverage', () => {
    const day = makeDay({
      wakeAt: '2026-10-14T08:00:00.000Z',
      sleepAt: '2026-10-14T18:00:00.000Z',
    });
    expect(calculateDayFidelity(day, [], [journal('Reflected')])).toBe('summary');
  });

  it('returns skipped when there is little coverage and no journal', () => {
    const day = makeDay({
      wakeAt: '2026-10-14T08:00:00.000Z',
      sleepAt: '2026-10-14T18:00:00.000Z',
    });
    const events = [
      event('a', '2026-10-14T08:00:00.000Z', '2026-10-14T10:00:00.000Z'),
    ];
    expect(calculateDayFidelity(day, events, [])).toBe('skipped');
  });

  it('ignores whitespace-only journal entries', () => {
    const day = makeDay({
      wakeAt: '2026-10-14T08:00:00.000Z',
      sleepAt: '2026-10-14T18:00:00.000Z',
    });
    expect(calculateDayFidelity(day, [], [journal('   ')])).toBe('skipped');
  });

  it('reports coverage as a 0..1 ratio clipped to the waking window', () => {
    const day = makeDay({
      wakeAt: '2026-10-14T08:00:00.000Z',
      sleepAt: '2026-10-14T18:00:00.000Z',
    });
    const events = [
      event('a', '2026-10-14T07:00:00.000Z', '2026-10-14T13:00:00.000Z'),
    ];
    expect(calculateDayCoverage(day, events)).toBeCloseTo(0.5, 5);
  });
});
