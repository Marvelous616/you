import { DatabaseSync } from './db.js';
import { Day, UUID, DayReviewStatus, DayFidelity } from '@life-logger/domain';
import { IDayRepository, CursorResult } from '../interfaces.js';

interface DayRow {
  id: string;
  local_date: string;
  wake_at: string | null;
  sleep_at: string | null;
  timezone: string;
  review_status: string;
  fidelity: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToDay(row: DayRow): Day {
  return {
    id: row.id,
    localDate: row.local_date,
    wakeAt: row.wake_at ?? undefined,
    sleepAt: row.sleep_at ?? undefined,
    timezone: row.timezone,
    reviewStatus: row.review_status as DayReviewStatus,
    fidelity: row.fidelity as DayFidelity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteDayRepository implements IDayRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(day: Day): Promise<void> {
    const stmt = this.db.prepare(`
      INSERT INTO days (
        id, local_date, wake_at, sleep_at, timezone, review_status, fidelity, created_at, updated_at, is_deleted
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        wake_at = excluded.wake_at,
        sleep_at = excluded.sleep_at,
        timezone = excluded.timezone,
        review_status = excluded.review_status,
        fidelity = excluded.fidelity,
        updated_at = excluded.updated_at,
        is_deleted = excluded.is_deleted
      WHERE excluded.updated_at >= days.updated_at
    `);

    stmt.run(
      day.id,
      day.localDate,
      day.wakeAt ?? null,
      day.sleepAt ?? null,
      day.timezone,
      day.reviewStatus,
      day.fidelity,
      day.createdAt,
      day.updatedAt,
      day.isDeleted ? 1 : 0
    );
  }

  async findById(id: UUID): Promise<Day | null> {
    const stmt = this.db.prepare('SELECT * FROM days WHERE id = ?');
    const row = stmt.get(id) as unknown as DayRow | undefined;
    return row ? rowToDay(row) : null;
  }

  async findByLocalDate(date: string): Promise<Day | null> {
    const stmt = this.db.prepare('SELECT * FROM days WHERE local_date = ?');
    const row = stmt.get(date) as unknown as DayRow | undefined;
    return row ? rowToDay(row) : null;
  }

  async listAll(includeDeleted = false): Promise<Day[]> {
    const query = includeDeleted
      ? 'SELECT * FROM days ORDER BY local_date DESC'
      : 'SELECT * FROM days WHERE is_deleted = 0 ORDER BY local_date DESC';
    const rows = this.db.prepare(query).all() as unknown as DayRow[];
    return rows.map(rowToDay);
  }

  async listModifiedSince(cursor: string = '', limit: number = 100): Promise<CursorResult<Day>> {
    const query = cursor
      ? 'SELECT * FROM days WHERE updated_at > ? ORDER BY updated_at ASC, id ASC LIMIT ?'
      : 'SELECT * FROM days ORDER BY updated_at ASC, id ASC LIMIT ?';

    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as DayRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map(rowToDay);
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return {
      records,
      nextCursor,
      hasMore,
    };
  }
}
