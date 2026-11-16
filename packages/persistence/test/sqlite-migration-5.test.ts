import { describe, it, expect } from 'vitest';
import { DatabaseSync, runMigrations, MIGRATIONS } from '@life-logger/persistence';
import { Person } from '@life-logger/domain';

function makeDb() {
  return new DatabaseSync(':memory:');
}

function setupSchemaMigrations(db: DatabaseSync) {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL,
      description TEXT NOT NULL
    );
  `);
}

describe('Migration 5: unique alias across all people', () => {
  it('runs on an empty database', () => {
    const db = makeDb();
    runMigrations(db);
    const versions = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
    db.close();
  });

  it('runs on a copy of the 3.9 production database schema', () => {
    const db = makeDb();
    setupSchemaMigrations(db);

    // Apply migrations 1-4 manually to simulate 3.9 state
    for (const m of MIGRATIONS.slice(0, 4)) {
      m.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)'
      ).run(m.version, new Date().toISOString(), m.description);
    }

    // Insert people and aliases
    db.prepare(
      'INSERT INTO people (id, display_name, aliases_json, notes, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)'
    ).run('p1', 'Alice Smith', '[]', null, new Date().toISOString(), new Date().toISOString());
    db.prepare(
      'INSERT INTO people (id, display_name, aliases_json, notes, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)'
    ).run('p2', 'Bob Jones', '[]', null, new Date().toISOString(), new Date().toISOString());

    // Insert some aliases
    db.prepare(
      'INSERT INTO person_aliases (id, person_id, alias, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, 0)'
    ).run('a1', 'p1', 'Alice', new Date().toISOString(), new Date().toISOString());
    db.prepare(
      'INSERT INTO person_aliases (id, person_id, alias, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, 0)'
    ).run('a2', 'p2', 'Bob', new Date().toISOString(), new Date().toISOString());

    // Now run migration 5 - should only apply migration 5
    runMigrations(db);
    const versions = db
      .prepare('SELECT version FROM schema_migrations ORDER BY version')
      .all() as Array<{ version: number }>;
    expect(versions.map((r) => r.version)).toEqual([1, 2, 3, 4, 5]);
    db.close();
  });

  it('fails on a database with duplicate live aliases across people', () => {
    const db = makeDb();
    setupSchemaMigrations(db);

    // Apply migrations 1-4 manually
    for (const m of MIGRATIONS.slice(0, 4)) {
      m.up(db);
      db.prepare(
        'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)'
      ).run(m.version, new Date().toISOString(), m.description);
    }

    // Insert people
    db.prepare(
      'INSERT INTO people (id, display_name, aliases_json, notes, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)'
    ).run('p1', 'Alice Smith', '[]', null, new Date().toISOString(), new Date().toISOString());
    db.prepare(
      'INSERT INTO people (id, display_name, aliases_json, notes, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, ?, 0)'
    ).run('p2', 'Bob Jones', '[]', null, new Date().toISOString(), new Date().toISOString());

    // Insert duplicate alias across two people
    db.prepare(
      'INSERT INTO person_aliases (id, person_id, alias, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, 0)'
    ).run('a1', 'p1', 'Alice', new Date().toISOString(), new Date().toISOString());
    db.prepare(
      'INSERT INTO person_aliases (id, person_id, alias, created_at, updated_at, is_deleted) VALUES (?, ?, ?, ?, ?, 0)'
    ).run('a2', 'p2', 'Alice', new Date().toISOString(), new Date().toISOString());

    expect(() => runMigrations(db)).toThrow(
      /duplicate live aliases across people.*p1:Alice.*p2:Alice/
    );
    db.close();
  });
});
