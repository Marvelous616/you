import { DatabaseSync } from './db.js';
import { EventTag, Tag, UUID } from '@life-logger/domain';
import {
  CursorResult,
  ITagRepository,
  TimestampedEventTag,
} from '../interfaces.js';

interface TagRow {
  id: string;
  name: string;
  path: string;
  color: string | null;
  parent_id: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

interface EventTagRow {
  event_id: string;
  tag_id: string;
  is_primary: number;
  updated_at?: string;
}

function rowToTag(row: TagRow): Tag {
  return {
    id: row.id,
    name: row.name,
    path: row.path,
    color: row.color ?? undefined,
    parentId: row.parent_id ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

function rowToEventTag(row: EventTagRow): EventTag {
  return {
    eventId: row.event_id,
    tagId: row.tag_id,
    isPrimary: row.is_primary === 1,
  };
}

export class SqliteTagRepository implements ITagRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(tag: Tag): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO tags (
          id, name, path, color, parent_id, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          path = excluded.path,
          color = excluded.color,
          parent_id = excluded.parent_id,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= tags.updated_at
      `)
      .run(
        tag.id,
        tag.name,
        tag.path,
        tag.color ?? null,
        tag.parentId ?? null,
        tag.createdAt,
        tag.updatedAt,
        tag.isDeleted ? 1 : 0
      );
  }

  async saveBatch(tags: Tag[]): Promise<void> {
    if (tags.length === 0) return;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const tag of tags) {
        await this.save(tag);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: UUID): Promise<Tag | null> {
    const row = this.db.prepare('SELECT * FROM tags WHERE id = ?').get(id) as unknown as
      | TagRow
      | undefined;
    return row ? rowToTag(row) : null;
  }

  async findByPath(path: string): Promise<Tag | null> {
    const row = this.db.prepare('SELECT * FROM tags WHERE path = ?').get(path) as unknown as
      | TagRow
      | undefined;
    return row ? rowToTag(row) : null;
  }

  async listTree(includeDeleted = false): Promise<Tag[]> {
    const query = includeDeleted
      ? 'SELECT * FROM tags ORDER BY path ASC'
      : 'SELECT * FROM tags WHERE is_deleted = 0 ORDER BY path ASC';
    const rows = this.db.prepare(query).all() as unknown as TagRow[];
    return rows.map(rowToTag);
  }

  async assignTagsToEvent(eventId: UUID, tags: EventTag[]): Promise<void> {
    const requestedPrimaryIndex = tags.findIndex((tag) => tag.isPrimary);
    const primaryIndex = requestedPrimaryIndex === -1 && tags.length > 0 ? 0 : requestedPrimaryIndex;
    const normalized = tags.map((tag, index) => ({
      ...tag,
      eventId,
      isPrimary: index === primaryIndex,
    }));

    this.db.exec('SAVEPOINT assign_event_tags');
    try {
      this.db.prepare('DELETE FROM event_tags WHERE event_id = ?').run(eventId);
      const insert = this.db.prepare(
        'INSERT INTO event_tags (event_id, tag_id, is_primary) VALUES (?, ?, ?)'
      );
      for (const link of normalized) {
        insert.run(eventId, link.tagId, link.isPrimary ? 1 : 0);
      }
      this.db.exec('RELEASE assign_event_tags');
    } catch (err) {
      this.db.exec('ROLLBACK TO assign_event_tags');
      this.db.exec('RELEASE assign_event_tags');
      throw err;
    }
  }

  async linkEventTag(link: EventTag): Promise<void> {
    this.db.exec('SAVEPOINT link_event_tag');
    try {
      if (link.isPrimary) {
        this.db
          .prepare('UPDATE event_tags SET is_primary = 0 WHERE event_id = ?')
          .run(link.eventId);
      }
      this.db
        .prepare(
          `INSERT INTO event_tags (event_id, tag_id, is_primary) VALUES (?, ?, ?)
           ON CONFLICT(event_id, tag_id) DO UPDATE SET is_primary = excluded.is_primary`
        )
        .run(link.eventId, link.tagId, link.isPrimary ? 1 : 0);
      this.db.exec('RELEASE link_event_tag');
    } catch (err) {
      this.db.exec('ROLLBACK TO link_event_tag');
      this.db.exec('RELEASE link_event_tag');
      throw err;
    }
  }

  async removeEventTag(eventId: UUID, tagId: UUID): Promise<void> {
    this.db.prepare('DELETE FROM event_tags WHERE event_id = ? AND tag_id = ?').run(eventId, tagId);
  }

  async listEventTags(eventId: UUID): Promise<EventTag[]> {
    const rows = this.db
      .prepare('SELECT * FROM event_tags WHERE event_id = ? ORDER BY is_primary DESC, tag_id ASC')
      .all(eventId) as unknown as EventTagRow[];
    return rows.map(rowToEventTag);
  }

  async listEventTagsForDay(dayId: UUID): Promise<EventTag[]> {
    const rows = this.db
      .prepare(`
        SELECT et.* FROM event_tags et
        JOIN events e ON e.id = et.event_id
        WHERE e.day_id = ? AND e.is_deleted = 0
        ORDER BY et.event_id ASC, et.is_primary DESC, et.tag_id ASC
      `)
      .all(dayId) as unknown as EventTagRow[];
    return rows.map(rowToEventTag);
  }

  async listAllEventTags(): Promise<EventTag[]> {
    const rows = this.db
      .prepare('SELECT * FROM event_tags ORDER BY event_id ASC, is_primary DESC, tag_id ASC')
      .all() as unknown as EventTagRow[];
    return rows.map(rowToEventTag);
  }

  async listEventTagsModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<TimestampedEventTag>> {
    const query = cursor
      ? `SELECT et.event_id, et.tag_id, et.is_primary, e.updated_at
         FROM event_tags et JOIN events e ON e.id = et.event_id
         WHERE e.updated_at > ?
         ORDER BY e.updated_at ASC, et.event_id ASC, et.tag_id ASC LIMIT ?`
      : `SELECT et.event_id, et.tag_id, et.is_primary, e.updated_at
         FROM event_tags et JOIN events e ON e.id = et.event_id
         ORDER BY e.updated_at ASC, et.event_id ASC, et.tag_id ASC LIMIT ?`;

    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as EventTagRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map((row) => ({
      link: rowToEventTag(row),
      updatedAt: row.updated_at ?? '',
    }));
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return { records, nextCursor, hasMore };
  }
}
