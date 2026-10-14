import { describe, it, expect } from 'vitest';
import { resolveLogicalDay, getLocalDateString } from '../src/day-boundary.js';

describe('day-boundary & logical day resolution', () => {
  it('formats calendar dates correctly according to timezone', () => {
    // 2026-10-14 23:00 UTC is 2026-10-15 04:30 in Asia/Kolkata (+5:30)
    const date = new Date('2026-10-14T23:00:00.000Z');
    expect(getLocalDateString(date, 'UTC')).toBe('2026-10-14');
    expect(getLocalDateString(date, 'Asia/Kolkata')).toBe('2026-10-15');
  });

  it('keeps late night / early morning events in the current logical day before sleep', () => {
    // User woke up at 08:00 AM on 2026-10-14
    const activeDay = {
      localDate: '2026-10-14',
      wakeAt: '2026-10-14T08:00:00.000Z',
      // sleepAt is undefined, user is still awake past midnight
    };

    // Event occurs at 01:45 AM on Oct 15 UTC
    const eventTime = '2026-10-15T01:45:00.000Z';

    const logicalDay = resolveLogicalDay(eventTime, 'UTC', activeDay);
    expect(logicalDay).toBe('2026-10-14');
  });

  it('assigns event to new calendar day after user has gone to sleep', () => {
    // User went to sleep at 01:30 AM
    const completedDay = {
      localDate: '2026-10-14',
      wakeAt: '2026-10-14T08:00:00.000Z',
      sleepAt: '2026-10-15T01:30:00.000Z',
    };

    // Next event occurs at 02:00 AM (after sleep)
    const eventTime = '2026-10-15T02:00:00.000Z';

    const logicalDay = resolveLogicalDay(eventTime, 'UTC', completedDay);
    expect(logicalDay).toBe('2026-10-15');
  });

  it('handles Daylight Saving Time transitions gracefully (Spike C)', () => {
    // Autumn clock-back transition: New York turns clocks back at 2:00 AM on 2026-11-01
    // EDT is UTC-4, EST is UTC-5
    const preFallback = new Date('2026-11-01T05:30:00.000Z'); // 1:30 AM EDT
    const postFallback = new Date('2026-11-01T06:30:00.000Z'); // 1:30 AM EST

    expect(getLocalDateString(preFallback, 'America/New_York')).toBe('2026-11-01');
    expect(getLocalDateString(postFallback, 'America/New_York')).toBe('2026-11-01');
  });
});
