import { describe, it, expect, beforeEach } from 'vitest';
import {
  DatabaseSync,
  MIGRATIONS,
  runMigrations,
  SqliteCalendarItemRepository,
  SqliteDayRepository,
  SqliteEventRepository,
  SqliteSuggestionRepository,
} from '../src/index.js';
import {
  CalendarItem,
  Day,
  Event,
  Suggestion,
  buildSuggestion,
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

function makeEvent(): Event {
  return {
    id: 'e-1',
    dayId: 'day-2026-10-14',
    title: 'Imported planning',
    startAt: '2026-10-14T10:00:00.000Z',
    endAt: '2026-10-14T11:00:00.000Z',
    startPrecision: 'approx',
    endPrecision: 'approx',
    source: 'imported',
    createdAt: T0,
    updatedAt: T0,
    isDeleted: false,
  };
}

function makeSuggestion(patch: Partial<Suggestion> = {}): Suggestion {
  const base = buildSuggestion(
    {
      source: 'calendar',
      confidence: 0.9,
      externalId: 'uid-1',
      proposed: {
        title: 'Planning',
        startAt: '2026-10-14T10:00:00.000Z',
        endAt: '2026-10-14T11:00:00.000Z',
        startPrecision: 'approx',
        endPrecision: 'approx',
        notes: 'Location: Room 4',
      },
    },
    { id: 'suggestion-1', now: new Date(T0) }
  );
  return { ...base, ...patch };
}

function makeCalendarItem(patch: Partial<CalendarItem> = {}): CalendarItem {
  return {
    eventId: 'e-1',
    externalId: 'uid-1',
    calendarName: 'Work',
    recurrenceRule: 'FREQ=WEEKLY',
    organizer: 'Alex',
    attendees: ['Rahul', 'Sam'],
    importedAt: '2026-10-14T09:00:00.000Z',
    ...patch,
  };
}

describe('Migration 3 and Increment 3 repositories', () => {
  let db: DatabaseSync;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    await new SqliteDayRepository(db).save(makeDay());
  });

  it('creates the Increment 3 tables from an empty database', () => {
    const versions = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all() as Array<{ name: string }>;
    expect(tables.map((row) => row.name)).toEqual(
      expect.arrayContaining(['suggestions', 'calendar_items'])
    );

    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'index'")
      .all() as Array<{ name: string }>;
    expect(indexes.map((row) => row.name)).toEqual(
      expect.arrayContaining([
        'idx_suggestions_status',
        'idx_suggestions_external',
        'idx_calendar_items_external',
      ])
    );
  });

  it('upgrades an existing Increment 2 database without losing data', async () => {
    const legacy = new DatabaseSync(':memory:');
    legacy.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL,
        description TEXT NOT NULL
      );
    `);
    for (const migration of [MIGRATIONS[0], MIGRATIONS[1]]) {
      migration.up(legacy);
      legacy
        .prepare('INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)')
        .run(migration.version, T0, migration.description);
    }
    await new SqliteDayRepository(legacy).save(makeDay());
    await new SqliteEventRepository(legacy).save(makeEvent());

    runMigrations(legacy);

    const versions = legacy
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((row) => row.version)).toEqual([1, 2, 3]);
    expect((await new SqliteEventRepository(legacy).findById('e-1'))?.title).toBe(
      'Imported planning'
    );
    expect((await new SqliteSuggestionRepository(legacy).findById('suggestion-1'))).toBeNull();
  });

  it('saves suggestions and applies last-write-wins updates', async () => {
    const repo = new SqliteSuggestionRepository(db);
    await repo.save(makeSuggestion());

    expect((await repo.findById('suggestion-1'))?.proposed.title).toBe('Planning');
    expect((await repo.findByExternalId('calendar', 'uid-1'))?.id).toBe('suggestion-1');
    expect(await repo.findByExternalId('calendar', 'missing')).toBeNull();

    await repo.save(
      makeSuggestion({ status: 'accepted', updatedAt: '2026-10-14T12:00:00.000Z' })
    );
    expect((await repo.findById('suggestion-1'))?.status).toBe('accepted');

    await repo.save(
      makeSuggestion({ status: 'rejected', updatedAt: '2026-10-14T11:00:00.000Z' })
    );
    expect((await repo.findById('suggestion-1'))?.status).toBe('accepted');
  });

  it('filters by status, hides soft deletes and pages by updated_at', async () => {
    const repo = new SqliteSuggestionRepository(db);
    await repo.saveBatch([
      makeSuggestion({ id: 's-1', externalId: 'uid-1' }),
      makeSuggestion({
        id: 's-2',
        externalId: 'uid-2',
        status: 'rejected',
        updatedAt: '2026-10-14T10:00:00.000Z',
      }),
    ]);

    expect((await repo.listByStatus('pending')).map((row) => row.id)).toEqual(['s-1']);
    expect((await repo.listByStatus('rejected')).map((row) => row.id)).toEqual(['s-2']);

    await repo.save(
      makeSuggestion({ id: 's-1', isDeleted: true, updatedAt: '2026-10-14T13:00:00.000Z' })
    );
    expect(await repo.listAll()).toHaveLength(1);
    expect(await repo.listAll(true)).toHaveLength(2);

    const page = await repo.listModifiedSince('', 1);
    expect(page.records).toHaveLength(1);
    expect(page.hasMore).toBe(true);

    const next = await repo.listModifiedSince(page.nextCursor, 10);
    expect(next.records.length).toBeGreaterThan(0);
    expect(next.records[0].updatedAt >= page.nextCursor).toBe(true);
  });

  it('keeps rejected suggestions findable so they are not re-proposed', async () => {
    const repo = new SqliteSuggestionRepository(db);
    await repo.save(makeSuggestion({ status: 'rejected' }));

    const found = await repo.findByExternalId('calendar', 'uid-1');
    expect(found?.status).toBe('rejected');

    const pending = await repo.listByStatus('pending');
    expect(pending).toHaveLength(0);
  });

  it('stores calendar metadata by reference to an accepted event', async () => {
    await new SqliteEventRepository(db).save(makeEvent());
    const repo = new SqliteCalendarItemRepository(db);

    await repo.save(makeCalendarItem());
    const found = await repo.findByEventId('e-1');
    expect(found).toEqual(makeCalendarItem());

    await repo.save(makeCalendarItem({ attendees: ['Rahul'], calendarName: 'Personal' }));
    expect((await repo.listAll())).toEqual([
      makeCalendarItem({ attendees: ['Rahul'], calendarName: 'Personal' }),
    ]);
    expect((await repo.findByExternalId('uid-1'))?.calendarName).toBe('Personal');
    expect(await repo.findByExternalId('missing')).toBeNull();
  });

  it('removes calendar metadata when the accepted event is deleted', async () => {
    await new SqliteEventRepository(db).save(makeEvent());
    const repo = new SqliteCalendarItemRepository(db);
    await repo.save(makeCalendarItem());

    db.prepare('DELETE FROM events WHERE id = ?').run('e-1');

    expect(await repo.findByEventId('e-1')).toBeNull();
  });
});
