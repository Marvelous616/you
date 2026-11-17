import { DatabaseSync } from './db.js';
import { normalizeSearchQuery, SearchHit } from '@life-logger/domain';
import { ISearchRepository } from '../interfaces.js';

/**
 * Escapes LIKE wildcards so user input is matched literally.
 */
function escapeLike(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function snippetOf(value: string | null | undefined, maxLength = 120): string {
  const text = (value ?? '').trim();
  if (text.length > maxLength) {
    return `${text.slice(0, maxLength)}…`;
  }
  return text;
}

export class SqliteSearchRepository implements ISearchRepository {
  constructor(private readonly db: DatabaseSync) {}

  async search(query: string, limit = 50): Promise<SearchHit[]> {
    const normalized = normalizeSearchQuery(query);
    const hits: SearchHit[] = [];
    if (!normalized) return hits;

    const pattern = `%${escapeLike(normalized)}%`;

    const eventRows = this.db
      .prepare(
        `SELECT id, title, notes, updated_at
         FROM events
         WHERE is_deleted = 0
           AND (LOWER(title) LIKE ? ESCAPE '\\' OR LOWER(COALESCE(notes, '')) LIKE ? ESCAPE '\\')`
      )
      .all(pattern, pattern) as Array<{
      id: string;
      title: string;
      notes: string | null;
      updated_at: string;
    }>;

    for (const row of eventRows) {
      const title = row.title ?? '';
      const notes = row.notes ?? '';
      const score = title.toLowerCase().startsWith(normalized)
        ? 3
        : title.toLowerCase().includes(normalized)
          ? 2
          : 1;
      hits.push({
        entityType: 'event',
        entityId: row.id,
        title,
        snippet: snippetOf(notes),
        updatedAt: row.updated_at,
        score,
      });
    }

    const journalRows = this.db
      .prepare(
        `SELECT id, body, updated_at
         FROM journal_entries
         WHERE is_deleted = 0 AND LOWER(body) LIKE ? ESCAPE '\\'`
      )
      .all(pattern) as Array<{
      id: string;
      body: string;
      updated_at: string;
    }>;

    for (const row of journalRows) {
      const snippet = snippetOf(row.body, 80);
      hits.push({
        entityType: 'journal_entry',
        entityId: row.id,
        title: snippet,
        snippet,
        updatedAt: row.updated_at,
        score: 1,
      });
    }

    hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || b.updatedAt.localeCompare(a.updatedAt));

    return hits.slice(0, limit);
  }
}
