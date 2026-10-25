import { describe, it, expect } from 'vitest';
import { parseQuickEntry, buildEventFromQuickEntry } from '../src/quick-entry.js';

const NOW = new Date(2026, 9, 14, 10, 0, 0, 0);

function startParts(iso: string): { day: number; hours: number; minutes: number } {
  const date = new Date(iso);
  return { day: date.getDate(), hours: date.getHours(), minutes: date.getMinutes() };
}

describe('parseQuickEntry: tags and people', () => {
  it('extracts tags, people and a point time, leaving a clean title', () => {
    const parsed = parseQuickEntry('lunch with @rahul at 1pm #food/lunch', NOW);

    expect(parsed.title).toBe('lunch with');
    expect(parsed.tagPaths).toEqual(['food/lunch']);
    expect(parsed.primaryTagPath).toBe('food/lunch');
    expect(parsed.peopleNames).toEqual(['rahul']);
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 13, minutes: 0 });
    expect(parsed.endAt).toBeUndefined();
    expect(parsed.hasExplicitTime).toBe(true);
  });

  it('normalizes tag path case and uses the first tag as primary', () => {
    const parsed = parseQuickEntry('#Work #Deep/Focus at 9am', NOW);
    expect(parsed.tagPaths).toEqual(['work', 'deep/focus']);
    expect(parsed.primaryTagPath).toBe('work');
  });

  it('supports multiple people and strips mention punctuation', () => {
    const parsed = parseQuickEntry('talk to @alice and @bob. at 3pm', NOW);
    expect(parsed.peopleNames).toEqual(['alice', 'bob']);
    expect(parsed.title).toBe('talk to and');
  });

  it('preserves the raw input always', () => {
    const raw = '  #onlytag @onlyperson  ';
    expect(parseQuickEntry(raw, NOW).rawText).toBe(raw);
  });

  it('leaves unrecognised text in the title', () => {
    const parsed = parseQuickEntry('notes about 99:99 and nothing else', NOW);
    expect(parsed.hasExplicitTime).toBe(false);
    expect(parsed.title).toBe('notes about 99:99 and nothing else');
  });
});

describe('parseQuickEntry: time ranges', () => {
  it('parses a "to" range with meridiem', () => {
    const parsed = parseQuickEntry('coding 2pm to 5pm #work', NOW);
    expect(parsed.title).toBe('coding');
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 14, minutes: 0 });
    expect(startParts(parsed.endAt!)).toMatchObject({ hours: 17, minutes: 0 });
  });

  it('parses a dash range with 24-hour times', () => {
    const parsed = parseQuickEntry('coded backend 10:00-11:30 #work/coding', NOW);
    expect(parsed.title).toBe('coded backend');
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 10, minutes: 0 });
    expect(startParts(parsed.endAt!)).toMatchObject({ hours: 11, minutes: 30 });
  });

  it('parses a dash range with meridiem', () => {
    const parsed = parseQuickEntry('gym 6:30am-7:45am #health', NOW);
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 6, minutes: 30 });
    expect(startParts(parsed.endAt!)).toMatchObject({ hours: 7, minutes: 45 });
  });

  it('parses "from ... until ..."', () => {
    const parsed = parseQuickEntry('deep work from 2pm until 4pm', NOW);
    expect(parsed.title).toBe('deep work');
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 14, minutes: 0 });
    expect(startParts(parsed.endAt!)).toMatchObject({ hours: 16, minutes: 0 });
  });

  it('rolls a range across midnight', () => {
    const parsed = parseQuickEntry('slept 11pm to 1am #sleep', NOW);
    expect(startParts(parsed.startAt)).toMatchObject({ day: 14, hours: 23, minutes: 0 });
    expect(startParts(parsed.endAt!)).toMatchObject({ day: 15, hours: 1, minutes: 0 });
  });

  it('parses a range preceded by "at"', () => {
    const parsed = parseQuickEntry('meeting at 14:30 to 16:00', NOW);
    expect(parsed.title).toBe('meeting');
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 14, minutes: 30 });
    expect(startParts(parsed.endAt!)).toMatchObject({ hours: 16, minutes: 0 });
  });
});

describe('parseQuickEntry: point times and durations', () => {
  it('parses "at <hour>" in 24-hour form', () => {
    const parsed = parseQuickEntry('standup at 9 #work', NOW);
    expect(parsed.title).toBe('standup');
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 9, minutes: 0 });
  });

  it('parses a bare "at 2" as 02:00 deterministically', () => {
    const parsed = parseQuickEntry('meeting at 2', NOW);
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 2, minutes: 0 });
  });

  it('parses a timestamp without "at"', () => {
    const parsed = parseQuickEntry('coffee 9:15am #food', NOW);
    expect(parsed.title).toBe('coffee');
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 9, minutes: 15 });
  });

  it('parses noon and midnight', () => {
    expect(startParts(parseQuickEntry('lunch at noon #food/lunch', NOW).startAt)).toMatchObject({
      hours: 12,
    });
    expect(startParts(parseQuickEntry('late snack at midnight #food', NOW).startAt)).toMatchObject({
      hours: 0,
    });
  });

  it('parses 12am and 12pm correctly', () => {
    expect(startParts(parseQuickEntry('call at 12am @sarah', NOW).startAt)).toMatchObject({ hours: 0 });
    expect(startParts(parseQuickEntry('lunch at 12pm', NOW).startAt)).toMatchObject({ hours: 12 });
  });

  it('applies a minute duration to the parsed start', () => {
    const parsed = parseQuickEntry('read for 45m #reading', NOW);
    expect(parsed.title).toBe('read');
    expect(parsed.durationMinutes).toBe(45);
    expect(new Date(parsed.endAt!).getTime() - new Date(parsed.startAt).getTime()).toBe(45 * 60_000);
  });

  it('applies an hour duration', () => {
    const parsed = parseQuickEntry('walk the dog at 7am for 2 hours', NOW);
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 7 });
    expect(new Date(parsed.endAt!).getTime() - new Date(parsed.startAt).getTime()).toBe(120 * 60_000);
  });

  it('applies a fractional-hour duration', () => {
    const parsed = parseQuickEntry('meeting at 14:30 for 1.5h @sarah', NOW);
    expect(parsed.durationMinutes).toBe(90);
    expect(startParts(parsed.endAt!)).toMatchObject({ hours: 16, minutes: 0 });
  });

  it('applies a combined hour+minute duration', () => {
    const parsed = parseQuickEntry('focus for 1h30m', NOW);
    expect(parsed.durationMinutes).toBe(90);
  });

  it('applies a minutes-only duration expressed with "min"', () => {
    const parsed = parseQuickEntry('focus for 90 min', NOW);
    expect(parsed.durationMinutes).toBe(90);
  });
});

describe('parseQuickEntry: safety and invariants', () => {
  it('does not mistake a distance for a time', () => {
    const parsed = parseQuickEntry('run 5k at 6pm', NOW);
    expect(parsed.title).toBe('run 5k');
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 18 });
  });

  it('does not consume dates as ranges', () => {
    const parsed = parseQuickEntry('Task 2026-10-14 at 10am', NOW);
    expect(parsed.title).toBe('Task 2026-10-14');
    expect(startParts(parsed.startAt)).toMatchObject({ hours: 10 });
  });

  it('rejects impossible times without throwing', () => {
    expect(() => parseQuickEntry('at 99:99', NOW)).not.toThrow();
    const parsed = parseQuickEntry('at 99:99', NOW);
    expect(parsed.hasExplicitTime).toBe(false);
    expect(parsed.title).toBe('at 99:99');
  });

  it('rejects an impossible bare hour', () => {
    const parsed = parseQuickEntry('meeting at 25', NOW);
    expect(parsed.hasExplicitTime).toBe(false);
    expect(parsed.title).toBe('meeting at 25');
  });

  it('defaults to now when no time is present', () => {
    const parsed = parseQuickEntry('breakfast #food', NOW);
    expect(parsed.hasExplicitTime).toBe(false);
    expect(new Date(parsed.startAt).getTime()).toBe(NOW.getTime());
    expect(parsed.title).toBe('breakfast');
  });

  it('never discards a title, even when the input is only tokens', () => {
    const parsed = parseQuickEntry('#work #deep', NOW);
    expect(parsed.title).toBe('#work #deep');
    expect(parsed.tagPaths).toEqual(['work', 'deep']);
  });

  it('parses a duration-only entry without discarding the raw title', () => {
    const parsed = parseQuickEntry('for 30m', NOW);
    expect(parsed.durationMinutes).toBe(30);
    expect(parsed.title).toBe('for 30m');
  });

  it('does not throw on arbitrary malformed input', () => {
    const inputs = ['', '###', '@@@', 'at', 'for', ' to ', '-', 'at pm', '2: - 4:', '😀 at 1pm'];
    for (const input of inputs) {
      expect(() => parseQuickEntry(input, NOW)).not.toThrow();
    }
  });

  it('stays well within the parser speed budget', () => {
    const samples = [
      'lunch with @rahul at 1pm #food/lunch',
      'coding 2pm to 5pm #work',
      'read for 45m #reading',
      'standup at 9 #work',
    ];
    const start = performance.now();
    for (let i = 0; i < 500; i++) {
      parseQuickEntry(samples[i % samples.length], NOW);
    }
    const averageMs = (performance.now() - start) / 500;
    expect(averageMs).toBeLessThan(5);
  });
});

describe('buildEventFromQuickEntry', () => {
  it('builds an Event with the parsed fields and source', () => {
    const parsed = parseQuickEntry('coding 2pm to 5pm #work', NOW);
    const event = buildEventFromQuickEntry(parsed, {
      id: 'e-1',
      dayId: 'day-2026-10-14',
      source: 'backfill',
      now: new Date('2026-10-14T12:00:00.000Z'),
    });

    expect(event).toMatchObject({
      id: 'e-1',
      dayId: 'day-2026-10-14',
      title: 'coding',
      source: 'backfill',
      startPrecision: 'exact',
      endPrecision: 'exact',
      isDeleted: false,
    });
    expect(event.startAt).toBe(parsed.startAt);
    expect(event.endAt).toBe(parsed.endAt);
  });
});
