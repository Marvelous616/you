import { describe, it, expect } from 'vitest';
import {
  resolvePersonToken,
  applyEventPatch,
  reassignDay,
  recomputeTagPaths,
  wouldCreateCycle,
} from '@life-logger/domain';
import {
  Day,
  Event,
  Person,
  Tag,
  Template,
} from '@life-logger/domain';

describe('resolvePersonToken with aliases', () => {
  const people: Person[] = [
    {
      id: 'p1',
      displayName: 'Alice Smith',
      aliases: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
    },
    {
      id: 'p2',
      displayName: 'Bob Jones',
      aliases: ['bobster', 'BJ'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
    },
    {
      id: 'p3',
      displayName: 'John Doe',
      aliases: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
    },
  ];

  it('resolves by display name', () => {
    const result = resolvePersonToken(people, 'alice smith');
    expect(result.person?.id).toBe('p1');
    expect(result.ambiguity).toBeNull();
  });

  it('resolves by alias', () => {
    const result = resolvePersonToken(people, 'bobster');
    expect(result.person?.id).toBe('p2');
    expect(result.ambiguity).toBeNull();
  });

  it('resolves alias case-insensitively', () => {
    const result = resolvePersonToken(people, 'BOBSTER');
    expect(result.person?.id).toBe('p2');
    expect(result.ambiguity).toBeNull();
  });

  it('returns ambiguity for shared name', () => {
    const peopleWithDup: Person[] = [
      ...people,
      {
        id: 'p4',
        displayName: 'Alice Smith',
        aliases: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      },
    ];
    const result = resolvePersonToken(peopleWithDup, 'alice smith');
    expect(result.person).toBeNull();
    expect(result.ambiguity).toEqual(['Alice Smith', 'Alice Smith']);
  });

  it('uses aliases map when provided', () => {
    const aliases = new Map<string, string[]>();
    aliases.set('p1', ['al', 'ally']);
    aliases.set('p2', ['bobster']);

    // Without aliases map, 'al' matches nothing
    const result1 = resolvePersonToken(people, 'al');
    expect(result1.person).toBeNull();

    // With aliases map, 'al' matches p1
    const result2 = resolvePersonToken(people, 'al', aliases);
    expect(result2.person?.id).toBe('p1');
  });

  it('returns null for unknown token', () => {
    const result = resolvePersonToken(people, 'nobody');
    expect(result.person).toBeNull();
    expect(result.ambiguity).toBeNull();
  });
});

describe('applyEventPatch', () => {
  const baseEvent: Event = {
    id: 'e1',
    dayId: 'day-1',
    title: 'Original title',
    startAt: '2026-01-15T10:00:00.000Z',
    endAt: '2026-01-15T11:00:00.000Z',
    startPrecision: 'exact',
    endPrecision: 'exact',
    source: 'live',
    notes: 'Original notes',
    createdAt: '2026-01-15T09:00:00.000Z',
    updatedAt: '2026-01-15T09:00:00.000Z',
    isDeleted: false,
  };

  it('rejects title longer than 200 characters', () => {
    const result = applyEventPatch(baseEvent, { title: 'x'.repeat(201) });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('title');
    expect(result.errors[0].message).toBe('Event title is at most 200 characters');
  });

  it('rejects empty title after trimming', () => {
    const result = applyEventPatch(baseEvent, { title: '   ' });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('title');
    expect(result.errors[0].message).toBe('Event title is required');
  });

  it('rejects notes longer than 5000 characters', () => {
    const result = applyEventPatch(baseEvent, { notes: 'x'.repeat(5001) });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('notes');
    expect(result.errors[0].message).toBe('Event notes are at most 5,000 characters');
  });

  it('rejects endAt equal to startAt', () => {
    const result = applyEventPatch(baseEvent, {
      endAt: '2026-01-15T10:00:00.000Z',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('endAt');
    expect(result.errors[0].message).toBe('End time must be after start time');
  });

  it('rejects endAt before startAt', () => {
    const result = applyEventPatch(baseEvent, {
      endAt: '2026-01-15T09:00:00.000Z',
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].field).toBe('endAt');
    expect(result.errors[0].message).toBe('End time must be after start time');
  });

  it('keeps source unchanged on edit', () => {
    const result = applyEventPatch(baseEvent, { title: 'New title' });
    expect(result.event.source).toBe('live');
    expect(result.event.title).toBe('New title');
  });

  it('updates start precision to exact on hand edit', () => {
    const event: Event = { ...baseEvent, startPrecision: 'approx' };
    const result = applyEventPatch(event, { startAt: '2026-01-15T11:00:00.000Z' });
    expect(result.event.startPrecision).toBe('exact');
  });
});

describe('reassignDay', () => {
  const wakeDay: Day = {
    id: 'day-2026-01-15',
    localDate: '2026-01-15',
    wakeAt: '2026-01-15T07:00:00.000Z',
    sleepAt: '2026-01-15T23:00:00.000Z',
    timezone: 'UTC',
    reviewStatus: 'unreviewed',
    fidelity: 'skipped',
    createdAt: '2026-01-15T06:00:00.000Z',
    updatedAt: '2026-01-15T06:00:00.000Z',
    isDeleted: false,
  };

  it('keeps event on same day when time stays within day bounds', () => {
    const event: Event = {
      id: 'e1',
      dayId: 'day-2026-01-15',
      title: 'Morning event',
      startAt: '2026-01-15T10:00:00.000Z',
      endAt: '2026-01-15T11:00:00.000Z',
      startPrecision: 'exact',
      endPrecision: 'exact',
      source: 'live',
      createdAt: '2026-01-15T09:00:00.000Z',
      updatedAt: '2026-01-15T09:00:00.000Z',
      isDeleted: false,
    };
    const { dayId } = reassignDay(event, [wakeDay], 'UTC');
    expect(dayId).toBe('day-2026-01-15');
  });

  it('moves event to next day when start crosses midnight', () => {
    const event: Event = {
      id: 'e1',
      dayId: 'day-2026-01-15',
      title: 'Late night event',
      startAt: '2026-01-16T01:00:00.000Z',
      endAt: '2026-01-16T02:00:00.000Z',
      startPrecision: 'exact',
      endPrecision: 'exact',
      source: 'live',
      createdAt: '2026-01-15T09:00:00.000Z',
      updatedAt: '2026-01-15T09:00:00.000Z',
      isDeleted: false,
    };
    const { dayId } = reassignDay(event, [wakeDay], 'UTC');
    expect(dayId).toBe('day-2026-01-16');
  });

  it('respects timezone for day boundary', () => {
    // Asia/Kolkata is UTC+5:30. An event at 20:30 UTC on Jan 15 is 00:00 Jan 16 in Kolkata.
    const event: Event = {
      id: 'e1',
      dayId: 'day-2026-01-15',
      title: 'Late night Kolkata',
      startAt: '2026-01-15T20:30:00.000Z',
      endAt: '2026-01-15T21:30:00.000Z',
      startPrecision: 'exact',
      endPrecision: 'exact',
      source: 'live',
      createdAt: '2026-01-15T09:00:00.000Z',
      updatedAt: '2026-01-15T09:00:00.000Z',
      isDeleted: false,
    };
    const day: Day = { ...wakeDay, timezone: 'Asia/Kolkata' };
    const { dayId } = reassignDay(event, [day], 'Asia/Kolkata');
    expect(dayId).toBe('day-2026-01-16');
  });
});

describe('recomputeTagPaths', () => {
  it('renaming parent updates child paths', () => {
    const tags: Tag[] = [
      {
        id: 't1',
        name: 'Work',
        path: 'Work',
        color: undefined,
        parentId: undefined,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      },
      {
        id: 't2',
        name: 'Coding',
        path: 'Work/Coding',
        color: undefined,
        parentId: 't1',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      },
      {
        id: 't3',
        name: 'Frontend',
        path: 'Work/Coding/Frontend',
        color: undefined,
        parentId: 't2',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      },
    ];

    const changes = recomputeTagPaths(tags, 't1');
    // Rename 'Work' to 'Employment' - all descendants should update
    const renamedTag: Tag = { ...tags[0], name: 'Employment', path: 'Employment' };
    const updatedTags = [renamedTag, tags[1], tags[2]];
    const changes2 = recomputeTagPaths(updatedTags, 't1');

    expect(changes2.length).toBe(2);
    expect(changes2.find((c) => c.tagId === 't2')?.newPath).toBe('Employment/Coding');
    expect(changes2.find((c) => c.tagId === 't3')?.newPath).toBe('Employment/Coding/Frontend');
  });

  it('returns empty when tag path does not change', () => {
    const tags: Tag[] = [
      {
        id: 't1',
        name: 'Work',
        path: 'Work',
        color: undefined,
        parentId: undefined,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      },
    ];
    const changes = recomputeTagPaths(tags, 't1');
    expect(changes).toEqual([]);
  });
});

describe('wouldCreateCycle', () => {
  const tags: Tag[] = [
    {
      id: 't1',
      name: 'Work',
      path: 'Work',
      color: undefined,
      parentId: undefined,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
    },
    {
      id: 't2',
      name: 'Coding',
      path: 'Work/Coding',
      color: undefined,
      parentId: 't1',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
    },
    {
      id: 't3',
      name: 'Frontend',
      path: 'Work/Coding/Frontend',
      color: undefined,
      parentId: 't2',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
    },
  ];

  it('rejects making a tag its own parent', () => {
    expect(wouldCreateCycle(tags, 't1', 't1')).toBe(true);
  });

  it('rejects making a tag a child of its descendant', () => {
    expect(wouldCreateCycle(tags, 't1', 't3')).toBe(true);
    expect(wouldCreateCycle(tags, 't2', 't3')).toBe(true);
  });

  it('accepts a valid move', () => {
    expect(wouldCreateCycle(tags, 't3', 't1')).toBe(false);
    expect(wouldCreateCycle(tags, 't3', undefined)).toBe(false);
  });
});
