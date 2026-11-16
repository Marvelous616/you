import { DatabaseSync } from './db.js';
import { TemplateTag, UUID } from '@life-logger/domain';
import {
  CursorResult,
  ITemplateTagRepository,
  TimestampedEventTag,
} from '../interfaces.js';

interface TemplateTagRow {
  template_id: string;
  tag_id: string;
  is_primary: number;
}

function rowToTemplateTag(row: TemplateTagRow): TemplateTag {
  return {
    templateId: row.template_id,
    tagId: row.tag_id,
    isPrimary: row.is_primary === 1,
  };
}

export class SqliteTemplateTagRepository implements ITemplateTagRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(link: TemplateTagLink): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO template_tags (template_id, tag_id, is_primary)
        VALUES (?, ?, ?)
        ON CONFLICT(template_id, tag_id) DO UPDATE SET
          is_primary = excluded.is_primary
      `)
      .run(link.templateId, link.tagId, link.isPrimary ? 1 : 0);
  }

  async saveBatch(links: TemplateTagLink[]): Promise<void> {
    if (links.length === 0) return;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const link of links) {
        await this.save(link);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async deleteForTemplate(templateId: UUID): Promise<void> {
    this.db
      .prepare('DELETE FROM template_tags WHERE template_id = ?')
      .run(templateId);
  }

  async listByTemplate(templateId: UUID): Promise<TemplateTag[]> {
    const rows = this.db
      .prepare('SELECT * FROM template_tags WHERE template_id = ? ORDER BY tag_id ASC')
      .all(templateId) as unknown as TemplateTagRow[];
    return rows.map(rowToTemplateTag);
  }

  async listModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<TimestampedEventTag>> {
    // Template tags don't have their own updated_at; use template's updated_at as proxy
    const query = cursor
      ? `SELECT tt.template_id, tt.tag_id, tt.is_primary, t.updated_at
         FROM template_tags tt JOIN templates t ON t.id = tt.template_id
         WHERE t.updated_at > ?
         ORDER BY t.updated_at ASC, tt.template_id ASC, tt.tag_id ASC LIMIT ?`
      : `SELECT tt.template_id, tt.tag_id, tt.is_primary, t.updated_at
         FROM template_tags tt JOIN templates t ON t.id = tt.template_id
         ORDER BY t.updated_at ASC, tt.template_id ASC, tt.tag_id ASC LIMIT ?`;
    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as TemplateTagRow[] & { updated_at: string }[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map((row) => ({
      link: rowToTemplateTag(row),
      updatedAt: row.updated_at ?? '',
    }));
    const nextCursor =
      records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return { records, nextCursor, hasMore };
  }
}

interface TemplateTagLink {
  templateId: UUID;
  tagId: UUID;
  isPrimary: boolean;
}
