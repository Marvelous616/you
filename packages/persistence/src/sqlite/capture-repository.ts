import { DatabaseSync } from './db.js';
import { Capture, UUID } from '@life-logger/domain';
import { CursorResult, ICaptureRepository } from '../interfaces.js';

interface CaptureRow {
  id: string;
  raw_text: string;
  captured_at: string;
  parsed_by: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToCapture(row: CaptureRow): Capture {
  return {
    id: row.id,
    rawText: row.raw_text,
    capturedAt: row.captured_at,
    parsedBy: row.parsed_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteCaptureRepository implements ICaptureRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(capture: Capture): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO captures (
          id, raw_text, captured_at, parsed_by, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          raw_text = excluded.raw_text,
          captured_at = excluded.captured_at,
          parsed_by = excluded.parsed_by,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= captures.updated_at
      `)
      .run(
        capture.id,
        capture.rawText,
        capture.capturedAt,
        capture.parsedBy,
        capture.createdAt,
        capture.updatedAt,
        capture.isDeleted ? 1 : 0
      );
  }

  async findById(id: UUID): Promise<Capture | null> {
    const row = this.db.prepare('SELECT * FROM captures WHERE id = ?').get(id) as unknown as
      | CaptureRow
      | undefined;
    return row ? rowToCapture(row) : null;
  }

  async listAll(includeDeleted = false): Promise<Capture[]> {
    const query = includeDeleted
      ? 'SELECT * FROM captures ORDER BY captured_at ASC, id ASC'
      : 'SELECT * FROM captures WHERE is_deleted = 0 ORDER BY captured_at ASC, id ASC';
    const rows = this.db.prepare(query).all() as unknown as CaptureRow[];
    return rows.map(rowToCapture);
  }

  async listModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<Capture>> {
    const query = cursor
      ? 'SELECT * FROM captures WHERE updated_at > ? ORDER BY updated_at ASC, id ASC LIMIT ?'
      : 'SELECT * FROM captures ORDER BY updated_at ASC, id ASC LIMIT ?';

    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as CaptureRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map(rowToCapture);
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return { records, nextCursor, hasMore };
  }
}
