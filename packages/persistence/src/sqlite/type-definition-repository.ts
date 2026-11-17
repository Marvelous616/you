import { DatabaseSync } from './db.js';
import { TypeDefinition, UUID } from '@life-logger/domain';
import { CursorResult, ITypeDefinitionRepository } from '../interfaces.js';

interface TypeDefinitionRow {
  id: string;
  name: string;
  field_type: string;
  schema_json: string;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

function rowToTypeDefinition(row: TypeDefinitionRow): TypeDefinition {
  let schema: Record<string, unknown> | undefined;
  try {
    schema = JSON.parse(row.schema_json) as Record<string, unknown>;
  } catch {
    schema = undefined;
  }

  return {
    id: row.id,
    name: row.name,
    fieldType: row.field_type,
    schema,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

export class SqliteTypeDefinitionRepository implements ITypeDefinitionRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(typeDefinition: TypeDefinition): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO type_definitions (
          id, name, field_type, schema_json, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          field_type = excluded.field_type,
          schema_json = excluded.schema_json,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= type_definitions.updated_at`
      )
      .run(
        typeDefinition.id,
        typeDefinition.name,
        typeDefinition.fieldType,
        JSON.stringify(typeDefinition.schema ?? {}),
        typeDefinition.createdAt,
        typeDefinition.updatedAt,
        typeDefinition.isDeleted ? 1 : 0
      );
  }

  async findById(id: UUID): Promise<TypeDefinition | null> {
    const row = this.db
      .prepare('SELECT * FROM type_definitions WHERE id = ?')
      .get(id) as unknown as TypeDefinitionRow | undefined;
    return row ? rowToTypeDefinition(row) : null;
  }

  async findByName(name: string): Promise<TypeDefinition | null> {
    const row = this.db
      .prepare('SELECT * FROM type_definitions WHERE name = ? AND is_deleted = 0')
      .get(name) as unknown as TypeDefinitionRow | undefined;
    return row ? rowToTypeDefinition(row) : null;
  }

  async listAll(includeDeleted = false): Promise<TypeDefinition[]> {
    const query = includeDeleted
      ? 'SELECT * FROM type_definitions ORDER BY updated_at DESC, id ASC'
      : 'SELECT * FROM type_definitions WHERE is_deleted = 0 ORDER BY updated_at DESC, id ASC';
    const rows = this.db.prepare(query).all() as unknown as TypeDefinitionRow[];
    return rows.map(rowToTypeDefinition);
  }

  async listModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<TypeDefinition>> {
    const query = cursor
      ? 'SELECT * FROM type_definitions WHERE updated_at > ? ORDER BY updated_at ASC, id ASC LIMIT ?'
      : 'SELECT * FROM type_definitions ORDER BY updated_at ASC, id ASC LIMIT ?';
    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as TypeDefinitionRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map(rowToTypeDefinition);
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return { records, nextCursor, hasMore };
  }

  async create(typeDefinition: TypeDefinition): Promise<TypeDefinition> {
    await this.save(typeDefinition);
    return typeDefinition;
  }

  async patch(id: UUID, patch: Partial<TypeDefinition>): Promise<TypeDefinition> {
    const existing = await this.findById(id);
    if (!existing) {
      throw new Error(`TypeDefinition ${id} not found`);
    }

    const updated: TypeDefinition = {
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
      .prepare('UPDATE type_definitions SET is_deleted = 1, updated_at = ? WHERE id = ?')
      .run(new Date().toISOString(), id);
  }
}
