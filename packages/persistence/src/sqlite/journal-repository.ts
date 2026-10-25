import { DatabaseSync } from './db.js';
import { CaptureSource, JournalEntry, UUID } from '@life-logger/domain';
import { CursorResult, IJournalRepository } from '../interfaces.js';

interface JournalRow {
  id: string;
  day_id: string;
  body: string;
  written_at: string;
  source: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToEntry(row: JournalRow): JournalEntry {
  return {
    id: row.id,
    dayId: row.day_id,
    body: row.body,
    writtenAt: row.written_at,
    source: row.source as CaptureSource,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteJournalRepository implements IJournalRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(entry: JournalEntry): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO journal_entries (
          id, day_id, body, written_at, source, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          day_id = excluded.day_id,
          body = excluded.body,
          written_at = excluded.written_at,
          source = excluded.source,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= journal_entries.updated_at
      `)
      .run(
        entry.id,
        entry.dayId,
        entry.body,
        entry.writtenAt,
        entry.source,
        entry.createdAt,
        entry.updatedAt,
        entry.isDeleted ? 1 : 0
      );
  }

  async saveBatch(entries: JournalEntry[]): Promise<void> {
    if (entries.length === 0) return;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const entry of entries) {
        await this.save(entry);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: UUID): Promise<JournalEntry | null> {
    const row = this.db.prepare('SELECT * FROM journal_entries WHERE id = ?').get(id) as unknown as
      | JournalRow
      | undefined;
    return row ? rowToEntry(row) : null;
  }

  async listByDay(dayId: UUID, includeDeleted = false): Promise<JournalEntry[]> {
    const query = includeDeleted
      ? 'SELECT * FROM journal_entries WHERE day_id = ? ORDER BY written_at ASC, id ASC'
      : 'SELECT * FROM journal_entries WHERE day_id = ? AND is_deleted = 0 ORDER BY written_at ASC, id ASC';
    const rows = this.db.prepare(query).all(dayId) as unknown as JournalRow[];
    return rows.map(rowToEntry);
  }

  async listAll(includeDeleted = false): Promise<JournalEntry[]> {
    const query = includeDeleted
      ? 'SELECT * FROM journal_entries ORDER BY written_at ASC, id ASC'
      : 'SELECT * FROM journal_entries WHERE is_deleted = 0 ORDER BY written_at ASC, id ASC';
    const rows = this.db.prepare(query).all() as unknown as JournalRow[];
    return rows.map(rowToEntry);
  }

  async listModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<JournalEntry>> {
    const query = cursor
      ? 'SELECT * FROM journal_entries WHERE updated_at > ? ORDER BY updated_at ASC, id ASC LIMIT ?'
      : 'SELECT * FROM journal_entries ORDER BY updated_at ASC, id ASC LIMIT ?';

    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as JournalRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map(rowToEntry);
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return { records, nextCursor, hasMore };
  }
}
