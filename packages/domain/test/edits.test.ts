import { describe, it, expect } from 'vitest';
import { resolvePersonToken } from '@life-logger/domain';
import { Person } from '@life-logger/domain';

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
