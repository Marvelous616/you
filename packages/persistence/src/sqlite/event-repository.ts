import { DatabaseSync } from './db.js';
import {
  CaptureSource,
  Event,
  Precision,
  UUID,
} from '@life-logger/domain';
import { CursorResult, IEventRepository } from '../interfaces.js';

interface EventRow {
  id: string;
  day_id: string;
  title: string;
  start_at: string;
  end_at: string | null;
  start_precision: string;
  end_precision: string;
  source: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToEvent(row: EventRow): Event {
  return {
    id: row.id,
    dayId: row.day_id,
    title: row.title,
    startAt: row.start_at,
    endAt: row.end_at ?? undefined,
    startPrecision: row.start_precision as Precision,
    endPrecision: row.end_precision as Precision,
    source: row.source as CaptureSource,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteEventRepository implements IEventRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(event: Event): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO events (
          id, day_id, title, start_at, end_at, start_precision, end_precision,
          source, notes, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          day_id = excluded.day_id,
          title = excluded.title,
          start_at = excluded.start_at,
          end_at = excluded.end_at,
          start_precision = excluded.start_precision,
          end_precision = excluded.end_precision,
          source = excluded.source,
          notes = excluded.notes,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= events.updated_at
      `)
      .run(
        event.id,
        event.dayId,
        event.title,
        event.startAt,
        event.endAt ?? null,
        event.startPrecision,
        event.endPrecision,
        event.source,
        event.notes ?? null,
        event.createdAt,
        event.updatedAt,
        event.isDeleted ? 1 : 0
      );
  }

  async saveBatch(events: Event[]): Promise<void> {
    if (events.length === 0) return;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const event of events) {
        await this.save(event);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: UUID): Promise<Event | null> {
    const row = this.db.prepare('SELECT * FROM events WHERE id = ?').get(id) as unknown as
      | EventRow
      | undefined;
    return row ? rowToEvent(row) : null;
  }

  async listByDay(dayId: UUID, includeDeleted = false): Promise<Event[]> {
    const query = includeDeleted
      ? 'SELECT * FROM events WHERE day_id = ? ORDER BY start_at ASC, id ASC'
      : 'SELECT * FROM events WHERE day_id = ? AND is_deleted = 0 ORDER BY start_at ASC, id ASC';
    const rows = this.db.prepare(query).all(dayId) as unknown as EventRow[];
    return rows.map(rowToEvent);
  }

  async listAll(includeDeleted = false): Promise<Event[]> {
    const query = includeDeleted
      ? 'SELECT * FROM events ORDER BY start_at ASC, id ASC'
      : 'SELECT * FROM events WHERE is_deleted = 0 ORDER BY start_at ASC, id ASC';
    const rows = this.db.prepare(query).all() as unknown as EventRow[];
    return rows.map(rowToEvent);
  }

  async listModifiedSince(cursor: string = '', limit: number = 100): Promise<CursorResult<Event>> {
    const query = cursor
      ? 'SELECT * FROM events WHERE updated_at > ? ORDER BY updated_at ASC, id ASC LIMIT ?'
      : 'SELECT * FROM events ORDER BY updated_at ASC, id ASC LIMIT ?';

    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as EventRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map(rowToEvent);
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return { records, nextCursor, hasMore };
  }
}
