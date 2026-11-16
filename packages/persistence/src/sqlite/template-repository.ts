import { DatabaseSync } from './db.js';
import { Template, UUID } from '@life-logger/domain';
import {
  CursorResult,
  ITemplateRepository,
} from '../interfaces.js';

interface TemplateRow {
  id: string;
  name: string;
  title: string;
  default_duration_minutes: number | null;
  special: string | null;
  is_pinned: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToTemplate(row: TemplateRow): Template {
  return {
    id: row.id,
    name: row.name,
    title: row.title,
    defaultDurationMinutes: row.default_duration_minutes ?? undefined,
    tagIds: [],
    special: row.special as Template['special'] ?? undefined,
    isPinned: row.is_pinned === 1,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteTemplateRepository implements ITemplateRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(template: Template): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO templates (
          id, name, title, default_duration_minutes, special, is_pinned,
          sort_order, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          title = excluded.title,
          default_duration_minutes = excluded.default_duration_minutes,
          special = excluded.special,
          is_pinned = excluded.is_pinned,
          sort_order = excluded.sort_order,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= templates.updated_at
      `)
      .run(
        template.id,
        template.name,
        template.title,
        template.defaultDurationMinutes ?? null,
        template.special ?? null,
        template.isPinned ? 1 : 0,
        template.sortOrder,
        template.createdAt,
        template.updatedAt,
        template.isDeleted ? 1 : 0
      );
  }

  async saveBatch(templates: Template[]): Promise<void> {
    if (templates.length === 0) return;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const template of templates) {
        await this.save(template);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: UUID): Promise<Template | null> {
    const row = this.db
      .prepare('SELECT * FROM templates WHERE id = ?')
      .get(id) as unknown as TemplateRow | undefined;
    if (!row) return null;

    const template = rowToTemplate(row);

    // Load associated tag links
    const tagLinks = this.db
      .prepare('SELECT tag_id FROM template_tags WHERE template_id = ?')
      .all(id) as unknown as { tag_id: string }[];
    template.tagIds = tagLinks.map((link) => link.tag_id);

    return template;
  }

  async findByName(name: string): Promise<Template | null> {
    const row = this.db
      .prepare('SELECT * FROM templates WHERE name = ? AND is_deleted = 0')
      .get(name) as unknown as TemplateRow | undefined;
    return row ? rowToTemplate(row) : null;
  }

  async listAll(includeDeleted = false): Promise<Template[]> {
    const query = includeDeleted
      ? 'SELECT * FROM templates ORDER BY sort_order ASC, name ASC'
      : 'SELECT * FROM templates WHERE is_deleted = 0 ORDER BY sort_order ASC, name ASC';
    const rows = this.db.prepare(query).all() as unknown as TemplateRow[];
    return rows.map(rowToTemplate);
  }

  async listModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<Template>> {
    const query = cursor
      ? `SELECT * FROM templates WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?`
      : `SELECT * FROM templates ORDER BY updated_at ASC LIMIT ?`;
    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as TemplateRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    return {
      records: recordsToReturn.map(rowToTemplate),
      nextCursor:
        recordsToReturn.length > 0
          ? recordsToReturn[recordsToReturn.length - 1].updated_at
          : cursor,
      hasMore,
    };
  }

  async create(template: Template): Promise<Template> {
    await this.save(template);
    return template;
  }

  async patch(id: UUID, patch: Partial<Template>): Promise<Template> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`Template ${id} not found`);
    }

    const updated: Template = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    await this.save(updated);
    return updated;
  }

  async softDelete(id: UUID): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;

    this.db
      .prepare(
        'UPDATE templates SET is_deleted = 1, updated_at = ? WHERE id = ?'
      )
      .run(new Date().toISOString(), id);
  }

  async restore(id: UUID): Promise<void> {
    const existing = await this.findById(id);
    if (!existing) return;

    this.db
      .prepare(
        'UPDATE templates SET is_deleted = 0, updated_at = ? WHERE id = ?'
      )
      .run(new Date().toISOString(), id);
  }
}
