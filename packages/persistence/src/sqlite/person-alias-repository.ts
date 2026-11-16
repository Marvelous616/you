import { DatabaseSync } from './db.js';
import { PersonAlias, UUID } from '@life-logger/domain';
import {
  CursorResult,
  IPersonAliasRepository,
} from '../interfaces.js';

interface PersonAliasRow {
  id: string;
  person_id: string;
  alias: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToPersonAlias(row: PersonAliasRow): PersonAlias {
  return {
    id: row.id,
    personId: row.person_id,
    alias: row.alias,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqlitePersonAliasRepository implements IPersonAliasRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(alias: PersonAlias): Promise<void> {
    // Reject cross-person duplicate live aliases (case-insensitive).
    const existing = await this.findByAlias(alias.alias);
    if (existing && existing.personId !== alias.personId) {
      throw new Error(
        `Alias "${alias.alias}" is already used by person ${existing.personId}`
      );
    }

    this.db
      .prepare(`
        INSERT INTO person_aliases (
          id, person_id, alias, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          person_id = excluded.person_id,
          alias = excluded.alias,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= person_aliases.updated_at
      `)
      .run(
        alias.id,
        alias.personId,
        alias.alias,
        alias.createdAt,
        alias.updatedAt,
        alias.isDeleted ? 1 : 0
      );
  }

  async saveBatch(aliases: PersonAlias[]): Promise<void> {
    if (aliases.length === 0) return;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const alias of aliases) {
        await this.save(alias);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: UUID): Promise<PersonAlias | null> {
    const row = this.db
      .prepare('SELECT * FROM person_aliases WHERE id = ?')
      .get(id) as unknown as PersonAliasRow | undefined;
    return row ? rowToPersonAlias(row) : null;
  }

  async findByAlias(alias: string): Promise<PersonAlias | null> {
    const needle = alias.toLowerCase();
    const row = this.db
      .prepare(
        'SELECT * FROM person_aliases WHERE LOWER(alias) = ? AND is_deleted = 0 ORDER BY updated_at DESC LIMIT 1'
      )
      .get(needle) as unknown as PersonAliasRow | undefined;
    return row ? rowToPersonAlias(row) : null;
  }

  async listByPerson(personId: UUID): Promise<PersonAlias[]> {
    const rows = this.db
      .prepare(
        'SELECT * FROM person_aliases WHERE person_id = ? AND is_deleted = 0 ORDER BY alias ASC'
      )
      .all(personId) as unknown as PersonAliasRow[];
    return rows.map(rowToPersonAlias);
  }

  async deleteForPerson(personId: UUID): Promise<void> {
    this.db
      .prepare('DELETE FROM person_aliases WHERE person_id = ?')
      .run(personId);
  }

  async listModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<PersonAlias>> {
    const query = cursor
      ? `SELECT * FROM person_aliases WHERE updated_at > ? ORDER BY updated_at ASC LIMIT ?`
      : `SELECT * FROM person_aliases ORDER BY updated_at ASC LIMIT ?`;
    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as PersonAliasRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    return {
      records: recordsToReturn.map(rowToPersonAlias),
      nextCursor:
        recordsToReturn.length > 0
          ? recordsToReturn[recordsToReturn.length - 1].updated_at
          : cursor,
      hasMore,
    };
  }
}
