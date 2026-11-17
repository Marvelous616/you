import { DatabaseSync } from './db.js';
import { EventThing, UUID } from '@life-logger/domain';
import { CursorResult, IEventThingRepository } from '../interfaces.js';

interface EventThingRow {
  id: string;
  event_id: string;
  type_definition_id: string;
  value_json: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToEventThing(row: EventThingRow): EventThing {
  let value: Record<string, unknown> = {};
  try {
    value = JSON.parse(row.value_json) as Record<string, unknown>;
  } catch {
    value = {};
  }

  return {
    id: row.id,
    eventId: row.event_id as UUID,
    typeDefinitionId: row.type_definition_id as UUID,
    value,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteEventThingRepository implements IEventThingRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(thing: EventThing): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO event_things (
          id, event_id, type_definition_id, value_json, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          event_id = excluded.event_id,
          type_definition_id = excluded.type_definition_id,
          value_json = excluded.value_json,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= event_things.updated_at`
      )
      .run(
        thing.id,
        thing.eventId,
        thing.typeDefinitionId,
        JSON.stringify(thing.value),
        thing.createdAt,
        thing.updatedAt,
        thing.isDeleted ? 1 : 0
      );
  }

  async findById(id: UUID): Promise<EventThing | null> {
    const row = this.db
      .prepare('SELECT * FROM event_things WHERE id = ?')
      .get(id) as unknown as EventThingRow | undefined;
    return row ? rowToEventThing(row) : null;
  }

  async findByEventId(eventId: UUID): Promise<EventThing | null> {
    const row = this.db
      .prepare('SELECT * FROM event_things WHERE event_id = ? AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 1')
      .get(eventId) as unknown as EventThingRow | undefined;
    return row ? rowToEventThing(row) : null;
  }

  async listAll(includeDeleted = false): Promise<EventThing[]> {
    const query = includeDeleted
      ? 'SELECT * FROM event_things ORDER BY updated_at DESC, id ASC'
      : 'SELECT * FROM event_things WHERE is_deleted = 0 ORDER BY updated_at DESC, id ASC';
    const rows = this.db.prepare(query).all() as unknown as EventThingRow[];
    return rows.map(rowToEventThing);
  }

  async listModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<EventThing>> {
    const query = cursor
      ? 'SELECT * FROM event_things WHERE updated_at > ? ORDER BY updated_at ASC, id ASC LIMIT ?'
      : 'SELECT * FROM event_things ORDER BY updated_at ASC, id ASC LIMIT ?';
    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as EventThingRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map(rowToEventThing);
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return { records, nextCursor, hasMore };
  }

  async findByEventAndType(eventId: UUID, typeDefinitionId: UUID): Promise<EventThing | null> {
    const row = this.db
      .prepare(
        'SELECT * FROM event_things WHERE event_id = ? AND type_definition_id = ? AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 1'
      )
      .get(eventId, typeDefinitionId) as unknown as EventThingRow | undefined;
    return row ? rowToEventThing(row) : null;
  }

  async softDelete(id: UUID): Promise<void> {
    const existing = await this.findById(id);
    if (!existing || existing.isDeleted) return;

    this.db
      .prepare('UPDATE event_things SET is_deleted = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }
}
