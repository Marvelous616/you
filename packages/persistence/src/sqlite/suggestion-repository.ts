import {
  ProposedEvent,
  Suggestion,
  SuggestionSource,
  SuggestionStatus,
  UUID,
} from '@life-logger/domain';
import { CursorResult, ISuggestionRepository } from '../interfaces.js';
import { DatabaseSync } from './db.js';

interface SuggestionRow {
  id: string;
  source: string;
  confidence: number;
  proposed_json: string;
  status: string;
  external_id: string | null;
  accepted_event_id: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToSuggestion(row: SuggestionRow): Suggestion {
  let proposed: ProposedEvent;
  try {
    proposed = JSON.parse(row.proposed_json) as ProposedEvent;
  } catch {
    proposed = {
      title: '(invalid suggestion)',
      startAt: row.created_at,
      startPrecision: 'unknown',
      endPrecision: 'unknown',
    };
  }

  return {
    id: row.id,
    source: row.source as SuggestionSource,
    confidence: row.confidence,
    proposed,
    status: row.status as SuggestionStatus,
    externalId: row.external_id ?? undefined,
    acceptedEventId: row.accepted_event_id ?? undefined,
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteSuggestionRepository implements ISuggestionRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(suggestion: Suggestion): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO suggestions (
          id, source, confidence, proposed_json, status, external_id,
          accepted_event_id, reviewed_at, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          source = excluded.source,
          confidence = excluded.confidence,
          proposed_json = excluded.proposed_json,
          status = excluded.status,
          external_id = excluded.external_id,
          accepted_event_id = excluded.accepted_event_id,
          reviewed_at = excluded.reviewed_at,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= suggestions.updated_at
      `)
      .run(
        suggestion.id,
        suggestion.source,
        suggestion.confidence,
        JSON.stringify(suggestion.proposed),
        suggestion.status,
        suggestion.externalId ?? null,
        suggestion.acceptedEventId ?? null,
        suggestion.reviewedAt ?? null,
        suggestion.createdAt,
        suggestion.updatedAt,
        suggestion.isDeleted ? 1 : 0
      );
  }

  async saveBatch(suggestions: Suggestion[]): Promise<void> {
    if (suggestions.length === 0) return;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const suggestion of suggestions) {
        await this.save(suggestion);
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  async findById(id: UUID): Promise<Suggestion | null> {
    const row = this.db.prepare('SELECT * FROM suggestions WHERE id = ?').get(id) as unknown as
      | SuggestionRow
      | undefined;
    return row ? rowToSuggestion(row) : null;
  }

  async findByExternalId(source: string, externalId: string): Promise<Suggestion | null> {
    const row = this.db
      .prepare(
        'SELECT * FROM suggestions WHERE source = ? AND external_id = ? AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 1'
      )
      .get(source, externalId) as unknown as SuggestionRow | undefined;
    return row ? rowToSuggestion(row) : null;
  }

  async listByStatus(status: SuggestionStatus, includeDeleted = false): Promise<Suggestion[]> {
    const query = includeDeleted
      ? 'SELECT * FROM suggestions WHERE status = ? ORDER BY created_at ASC, id ASC'
      : 'SELECT * FROM suggestions WHERE status = ? AND is_deleted = 0 ORDER BY created_at ASC, id ASC';
    const rows = this.db.prepare(query).all(status) as unknown as SuggestionRow[];
    return rows.map(rowToSuggestion);
  }

  async listAll(includeDeleted = false): Promise<Suggestion[]> {
    const query = includeDeleted
      ? 'SELECT * FROM suggestions ORDER BY created_at ASC, id ASC'
      : 'SELECT * FROM suggestions WHERE is_deleted = 0 ORDER BY created_at ASC, id ASC';
    const rows = this.db.prepare(query).all() as unknown as SuggestionRow[];
    return rows.map(rowToSuggestion);
  }

  async listModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<Suggestion>> {
    const query = cursor
      ? 'SELECT * FROM suggestions WHERE updated_at > ? ORDER BY updated_at ASC, id ASC LIMIT ?'
      : 'SELECT * FROM suggestions ORDER BY updated_at ASC, id ASC LIMIT ?';

    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as SuggestionRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map(rowToSuggestion);
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return { records, nextCursor, hasMore };
  }
}
