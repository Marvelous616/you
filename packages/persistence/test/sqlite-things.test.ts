import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync, runMigrations, SqliteTypeDefinitionRepository, SqliteEventThingRepository, SqliteEventRepository, SqliteDayRepository } from '@life-logger/persistence';
import { TypeDefinition, EventThing, Event, Day } from '@life-logger/domain';

describe('Things: type definitions and event things', () => {
  let db: DatabaseSync;
  let typeRepo: SqliteTypeDefinitionRepository;
  let thingRepo: SqliteEventThingRepository;
  let eventRepo: SqliteEventRepository;
  let dayRepo: SqliteDayRepository;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    typeRepo = new SqliteTypeDefinitionRepository(db);
    thingRepo = new SqliteEventThingRepository(db);
    eventRepo = new SqliteEventRepository(db);
    dayRepo = new SqliteDayRepository(db);
    await dayRepo.save({
      id: 'day-2026-01-01',
      localDate: '2026-01-01',
      timezone: 'UTC',
      reviewStatus: 'unreviewed',
      fidelity: 'detailed',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      isDeleted: false,
    } as Day);
  });

  afterEach(() => {
    db.close();
  });

  describe('SqliteTypeDefinitionRepository', () => {
    it('saves and finds a type definition', async () => {
      const def: TypeDefinition = {
        id: 'type-1',
        name: 'Sleep',
        fieldType: 'number',
        schema: { unit: 'hours' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      };
      await typeRepo.save(def);

      const found = await typeRepo.findById('type-1');
      expect(found?.name).toBe('Sleep');
      expect(found?.fieldType).toBe('number');
      expect(found?.schema).toEqual({ unit: 'hours' });
      expect(found?.isDeleted).toBe(false);
    });

    it('lists only live type definitions', async () => {
      const def: TypeDefinition = {
        id: 'type-2',
        name: 'Mood',
        fieldType: 'text',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      };
      await typeRepo.save(def);
      await typeRepo.save({ ...def, id: 'type-3', name: 'Old', isDeleted: true });

      const all = await typeRepo.listAll();
      expect(all.map((t) => t.id)).toEqual(['type-2']);
    });
  });

  describe('SqliteEventThingRepository', () => {
    it('saves and finds an event thing', async () => {
      await eventRepo.save({
        id: 'event-1',
        dayId: 'day-2026-01-01',
        title: 'Sleep',
        startAt: '2026-01-01T23:00:00.000Z',
        startPrecision: 'exact',
        endPrecision: 'unknown',
        source: 'live',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      } as Event);

      await typeRepo.save({
        id: 'type-1',
        name: 'Sleep',
        fieldType: 'number',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      });

      const thing: EventThing = {
        id: 'thing-1',
        eventId: 'event-1',
        typeDefinitionId: 'type-1',
        value: { hours: 7.5 },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      };
      await thingRepo.save(thing);

      const found = await thingRepo.findByEventId('event-1');
      expect(found?.typeDefinitionId).toBe('type-1');
      expect(found?.value).toEqual({ hours: 7.5 });
    });
  });
});
