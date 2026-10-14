import { DatabaseSync } from './db.js';

export interface Migration {
  version: number;
  description: string;
  up: (db: DatabaseSync) => void;
}

export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: 'Initial schema for Walking Skeleton: days and markers',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS days (
          id TEXT PRIMARY KEY,
          local_date TEXT NOT NULL UNIQUE,
          wake_at TEXT,
          sleep_at TEXT,
          timezone TEXT NOT NULL,
          review_status TEXT NOT NULL DEFAULT 'unreviewed',
          fidelity TEXT NOT NULL DEFAULT 'skipped',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS markers (
          id TEXT PRIMARY KEY,
          day_id TEXT REFERENCES days(id) ON DELETE SET NULL,
          marked_at TEXT NOT NULL,
          timezone_offset_minutes INTEGER NOT NULL,
          note TEXT,
          precision TEXT NOT NULL DEFAULT 'exact',
          source TEXT NOT NULL DEFAULT 'live',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_markers_marked_at ON markers(marked_at);
        CREATE INDEX IF NOT EXISTS idx_markers_day_id ON markers(day_id);
        CREATE INDEX IF NOT EXISTS idx_markers_updated_at ON markers(updated_at);
      `);
    },
  },
];

export function runMigrations(db: DatabaseSync): void {
  // Ensure WAL mode and foreign keys
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

  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const appliedSet = new Set(appliedRows.map((r) => r.version));

  for (const migration of MIGRATIONS) {
    if (!appliedSet.has(migration.version)) {
      db.exec('BEGIN TRANSACTION');
      try {
        migration.up(db);
        db.prepare(
          'INSERT INTO schema_migrations (version, applied_at, description) VALUES (?, ?, ?)'
        ).run(migration.version, new Date().toISOString(), migration.description);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw new Error(`Failed to apply migration ${migration.version} (${migration.description}): ${err}`);
      }
    }
  }
}
