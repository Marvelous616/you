import { describe, it, expect } from 'vitest';
import { Tag, Person } from '../src/types.js';
import {
  buildTagTree,
  normalizeTagPath,
  resolveTagsForEvent,
  tagNameFromPath,
} from '../src/tags.js';
import {
  findPersonByNameOrAlias,
  resolvePeopleForEvent,
} from '../src/people.js';

function tag(id: string, path: string, parentId?: string): Tag {
  return {
    id,
    name: tagNameFromPath(path),
    path,
    parentId,
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
    isDeleted: false,
  };
}

describe('tag paths and hierarchy', () => {
  it('normalizes free-form tags into canonical paths', () => {
    expect(normalizeTagPath('  #Work/Coding  ')).toBe('work/coding');
    expect(normalizeTagPath('Food & Drink/Lunch')).toBe('food-drink/lunch');
    expect(normalizeTagPath('//a//b//')).toBe('a/b');
    expect(normalizeTagPath('#')).toBe('');
  });

  it('derives a display name from the final path segment', () => {
    expect(tagNameFromPath('work/deep-work')).toBe('Deep Work');
    expect(tagNameFromPath('reading')).toBe('Reading');
  });

  it('builds a sorted tree and attaches orphans at the root', () => {
    const tree = buildTagTree([
      tag('t-work', 'work'),
      tag('t-coding', 'work/coding', 't-work'),
      tag('t-food', 'food'),
      tag('t-orphan', 'misc/orphan', 'missing-parent'),
    ]);

    expect(tree.map((node) => node.tag.path)).toEqual(['food', 'misc/orphan', 'work']);
    expect(tree[2].children.map((node) => node.tag.path)).toEqual(['work/coding']);
  });

  it('creates missing ancestors and marks the first requested tag primary', () => {
    const result = resolveTagsForEvent(
      'event-1',
      ['#Work/Coding', 'reading'],
      [tag('t-reading', 'reading')],
      { now: new Date('2026-10-14T12:00:00.000Z') }
    );

    expect(result.tags.map((created) => created.path)).toEqual(['work', 'work/coding']);
    expect(result.tags.find((created) => created.path === 'work/coding')?.parentId).toBe('tag-work');
    expect(result.eventTags).toEqual([
      { eventId: 'event-1', tagId: 'tag-work-coding', isPrimary: true },
      { eventId: 'event-1', tagId: 't-reading', isPrimary: false },
    ]);
    expect(result.primaryTag?.path).toBe('work/coding');
  });

  it('deduplicates repeated tag paths', () => {
    const result = resolveTagsForEvent('event-1', ['food', 'FOOD', 'food/lunch'], []);
    expect(result.eventTags.map((link) => link.tagId)).toEqual(['tag-food', 'tag-food-lunch']);
  });
});

describe('people resolution', () => {
  const people: Person[] = [
    {
      id: 'p-rahul',
      displayName: 'Rahul',
      aliases: ['rahul.k', 'rah'],
      createdAt: '2026-10-14T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
      isDeleted: false,
    },
  ];

  it('matches display names and aliases case-insensitively', () => {
    expect(findPersonByNameOrAlias(people, '@RAHUL')?.id).toBe('p-rahul');
    expect(findPersonByNameOrAlias(people, 'Rahul.K')?.id).toBe('p-rahul');
    expect(findPersonByNameOrAlias(people, 'sarah')).toBeUndefined();
  });

  it('creates missing people and deduplicates mentions', () => {
    const result = resolvePeopleForEvent(
      'event-1',
      ['@Rahul', '@sarah', '@Sarah', '@rahul.k'],
      people,
      { now: new Date('2026-10-14T12:00:00.000Z') }
    );

    expect(result.people.map((person) => person.displayName)).toEqual(['sarah']);
    expect(result.participants.map((participant) => participant.personId)).toEqual([
      'p-rahul',
      'person-sarah',
    ]);
    expect(result.participants.every((participant) => participant.role === 'with')).toBe(true);
  });
});
