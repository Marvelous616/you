import { DatabaseSync } from './db.js';
import { Marker, UUID } from '@life-logger/domain';
import { IMarkerRepository, CursorResult } from '../interfaces.js';

interface MarkerRow {
  id: string;
  day_id: string | null;
  marked_at: string;
  timezone_offset_minutes: number;
  note: string | null;
  precision: 'exact' | 'approx' | 'unknown';
  source: 'live' | 'backfill' | 'prompted' | 'imported';
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToMarker(row: MarkerRow): Marker {
  return {
    id: row.id,
    dayId: row.day_id ?? undefined,
    markedAt: row.marked_at,
    timezoneOffsetMinutes: row.timezone_offset_minutes,
    note: row.note ?? undefined,
    precision: row.precision,
    source: row.source,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteMarkerRepository implements IMarkerRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(marker: Marker): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO markers (
        id, day_id, marked_at, timezone_offset_minutes, note, precision, source, created_at, updated_at, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        day_id = excluded.day_id,
        marked_at = excluded.marked_at,
        timezone_offset_minutes = excluded.timezone_offset_minutes,
        note = excluded.note,
        precision = excluded.precision,
        source = excluded.source,
        updated_at = excluded.updated_at,
        is_deleted = excluded.is_deleted
      WHERE excluded.updated_at >= markers.updated_at
    `);

    stmt.run(
      marker.id,
      marker.dayId ?? null,
      marker.markedAt,
      marker.timezoneOffsetMinutes,
      marker.note ?? null,
      marker.precision,
      marker.source,
      marker.createdAt,
      marker.updatedAt,
      marker.isDeleted ? 1 : 0
    );
  }

  async saveBatch(markers: Marker[]): Promise<void> {
    if (markers.length === 0) return;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const m of markers) {
        await this.save(m);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: UUID): Promise<Marker | null> {
    const stmt = this.db.prepare('SELECT * FROM markers WHERE id = ?');
    const row = stmt.get(id) as unknown as MarkerRow | undefined;
    return row ? rowToMarker(row) : null;
  }

  async listByDay(dayId: UUID, includeDeleted = false): Promise<Marker[]> {
    const query = includeDeleted
      ? 'SELECT * FROM markers WHERE day_id = ? ORDER BY marked_at ASC'
      : 'SELECT * FROM markers WHERE day_id = ? AND is_deleted = 0 ORDER BY marked_at ASC';
    const rows = this.db.prepare(query).all(dayId) as unknown as MarkerRow[];
    return rows.map(rowToMarker);
  }

  async listAll(includeDeleted = false): Promise<Marker[]> {
    const query = includeDeleted
      ? 'SELECT * FROM markers ORDER BY marked_at ASC'
      : 'SELECT * FROM markers WHERE is_deleted = 0 ORDER BY marked_at ASC';
    const rows = this.db.prepare(query).all() as unknown as MarkerRow[];
    return rows.map(rowToMarker);
  }

  async listModifiedSince(cursor: string = '', limit: number = 100): Promise<CursorResult<Marker>> {
    // If cursor is provided, retrieve records strictly after cursor
    const query = cursor
      ? 'SELECT * FROM markers WHERE updated_at > ? ORDER BY updated_at ASC, id ASC LIMIT ?'
      : 'SELECT * FROM markers ORDER BY updated_at ASC, id ASC LIMIT ?';

    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as MarkerRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map(rowToMarker);
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return {
      records,
      nextCursor,
      hasMore,
    };
  }
}
