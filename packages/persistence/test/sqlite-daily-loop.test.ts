import { describe, it, expect, beforeEach } from 'vitest';
import {
  DatabaseSync,
  MIGRATIONS,
  runMigrations,
  SqliteCaptureRepository,
  SqliteDayRepository,
  SqliteEventRepository,
  SqliteJournalRepository,
  SqlitePersonRepository,
  SqliteTagRepository,
} from '../src/index.js';
import {
  Capture,
  Day,
  Event,
  EventParticipant,
  EventTag,
  JournalEntry,
  Person,
  Tag,
} from '@life-logger/domain';

const T0 = '2026-10-14T00:00:00.000Z';

function makeDay(): Day {
  return {
    id: 'day-2026-10-14',
    localDate: '2026-10-14',
    timezone: 'UTC',
    reviewStatus: 'unreviewed',
    fidelity: 'skipped',
    createdAt: T0,
    updatedAt: T0,
    isDeleted: false,
  };
}

function makeEvent(patch: Partial<Event> = {}): Event {
  return {
    id: 'e-1',
    dayId: 'day-2026-10-14',
    title: 'Coding',
    startAt: '2026-10-14T14:00:00.000Z',
    endAt: '2026-10-14T17:00:00.000Z',
    startPrecision: 'exact',
    endPrecision: 'exact',
    source: 'live',
    createdAt: T0,
    updatedAt: T0,
    isDeleted: false,
    ...patch,
  };
}

function makeTag(id: string, path: string, parentId?: string): Tag {
  return {
    id,
    name: path,
    path,
    parentId,
    createdAt: T0,
    updatedAt: T0,
    isDeleted: false,
  };
}

describe('Migration 2 and Daily Loop repositories', () => {
  let db: DatabaseSync;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    await new SqliteDayRepository(db).save(makeDay());
  });

  it('upgrades an existing Increment 1 database in place', async () => {
    const legacy = new DatabaseSync(':memory:');
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      );
    `);
    MIGRATIONS[0].up(legacy);
    legacy
      .prepare('INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)')
      .run(1, T0, MIGRATIONS[0].description);

    runMigrations(legacy);

    const versions = legacy
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual([1, 2]);

    const tables = legacy
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    const names = tables.map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'days',
        'markers',
        'events',
        'tags',
        'event_tags',
        'people',
        'event_participants',
        'journal_entries',
        'captures',
      ])
    );
  });

  it('saves events, applies LWW updates and lists them by day', async () => {
    const repo = new SqliteEventRepository(db);
    await repo.save(makeEvent());

    const updated = await new SqliteEventRepository(db).findById('e-1');
    expect(updated?.title).toBe('Coding');

    await repo.save(makeEvent({ title: 'Coding v2', updatedAt: '2026-10-14T18:00:00.000Z' }));
    expect((await repo.findById('e-1'))?.title).toBe('Coding v2');

    await repo.save(makeEvent({ title: 'Stale', updatedAt: '2026-10-14T17:00:00.000Z' }));
    expect((await repo.findById('e-1'))?.title).toBe('Coding v2');

    expect(await repo.listByDay('day-2026-10-14')).toHaveLength(1);
  });

  it('supports event soft deletion and batched writes', async () => {
    const repo = new SqliteEventRepository(db);
    await repo.saveBatch([
      makeEvent({ id: 'e-1' }),
      makeEvent({ id: 'e-2', title: 'Reading', startAt: '2026-10-14T18:00:00.000Z' }),
    ]);

    await repo.save(makeEvent({ id: 'e-1', isDeleted: true, updatedAt: '2026-10-14T19:00:00.000Z' }));

    expect(await repo.listByDay('day-2026-10-14')).toHaveLength(1);
    expect(await repo.listByDay('day-2026-10-14', true)).toHaveLength(2);
  });

  it('assigns tags and enforces a single primary tag', async () => {
    const tags = new SqliteTagRepository(db);
    await tags.saveBatch([
      makeTag('tag-work', 'work'),
      makeTag('tag-work-coding', 'work/coding', 'tag-work'),
      makeTag('tag-reading', 'reading'),
    ]);

    await new SqliteEventRepository(db).save(makeEvent());
    await tags.assignTagsToEvent('e-1', [
      { eventId: 'e-1', tagId: 'tag-work-coding', isPrimary: true },
      { eventId: 'e-1', tagId: 'tag-reading', isPrimary: true },
    ]);

    const links = await tags.listEventTags('e-1');
    expect(links).toEqual([
      { eventId: 'e-1', tagId: 'tag-work-coding', isPrimary: true },
      { eventId: 'e-1', tagId: 'tag-reading', isPrimary: false },
    ]);
    expect((await tags.findByPath('work/coding'))?.name).toBe('work/coding');
    expect((await tags.listTree()).map((tag) => tag.path)).toEqual([
      'reading',
      'work',
      'work/coding',
    ]);
  });

  it('finds people by alias, links participants and lists them for a day', async () => {
    const people = new SqlitePersonRepository(db);
    const person: Person = {
      id: 'p-1',
      displayName: 'Rahul',
      aliases: ['rahul.k'],
      createdAt: T0,
      updatedAt: T0,
      isDeleted: false,
    };
    await people.save(person);
    await new SqliteEventRepository(db).save(makeEvent());

    expect((await people.findByNameOrAlias('@RAHUL.K'))?.id).toBe('p-1');
    expect(await people.findByNameOrAlias('nobody')).toBeNull();

    const participant: EventParticipant = {
      eventId: 'e-1',
      personId: 'p-1',
      role: 'with',
      medium: 'call',
      initiatedBy: 'me',
    };
    await people.linkParticipant(participant);

    expect(await people.listParticipants('e-1')).toEqual([participant]);
    expect(await people.listParticipantsForDay('day-2026-10-14')).toEqual([participant]);
  });

  it('stores journal entries and captures with soft deletes', async () => {
    const journal = new SqliteJournalRepository(db);
    const entry: JournalEntry = {
      id: 'j-1',
      dayId: 'day-2026-10-14',
      body: 'A good day',
      writtenAt: '2026-10-14T22:00:00.000Z',
      source: 'live',
      createdAt: T0,
      updatedAt: T0,
      isDeleted: false,
    };
    await journal.save(entry);
    expect(await journal.listByDay('day-2026-10-14')).toHaveLength(1);

    await journal.save({ ...entry, isDeleted: true, updatedAt: '2026-10-14T23:00:00.000Z' });
    expect(await journal.listByDay('day-2026-10-14')).toHaveLength(0);
    expect(await journal.listByDay('day-2026-10-14', true)).toHaveLength(1);

    const captures = new SqliteCaptureRepository(db);
    const capture: Capture = {
      id: 'c-1',
      rawText: 'lunch at 1pm #food',
      capturedAt: '2026-10-14T13:00:00.000Z',
      parsedBy: 'rule-parser-v0',
      createdAt: T0,
      updatedAt: T0,
      isDeleted: false,
    };
    await captures.save(capture);
    expect((await captures.findById('c-1'))?.rawText).toBe(capture.rawText);
  });

  it('returns link deltas alongside their parent event timestamp for sync', async () => {
    const tags = new SqliteTagRepository(db);
    await tags.save(makeTag('tag-work', 'work'));
    await new SqliteEventRepository(db).save(makeEvent());
    await tags.assignTagsToEvent('e-1', [
      { eventId: 'e-1', tagId: 'tag-work', isPrimary: true },
    ]);

    const delta = await tags.listEventTagsModifiedSince('');
    expect(delta.records).toEqual([
      {
        link: { eventId: 'e-1', tagId: 'tag-work', isPrimary: true },
        updatedAt: T0,
      },
    ]);
  });

  it('keeps a single primary tag when none was requested', async () => {
    const tags = new SqliteTagRepository(db);
    await tags.saveBatch([makeTag('tag-a', 'a'), makeTag('tag-b', 'b')]);
    await new SqliteEventRepository(db).save(makeEvent());

    const links: EventTag[] = [
      { eventId: 'e-1', tagId: 'tag-a', isPrimary: false },
      { eventId: 'e-1', tagId: 'tag-b', isPrimary: false },
    ];
    await tags.assignTagsToEvent('e-1', links);

    const saved = await tags.listEventTags('e-1');
    expect(saved.filter((link) => link.isPrimary)).toHaveLength(1);
  });
});
