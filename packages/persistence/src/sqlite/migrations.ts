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
  {
    version: 2,
    description: 'Daily Loop entities: events, tags, people, journal entries and captures',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          path TEXT NOT NULL UNIQUE,
          color TEXT,
          parent_id TEXT REFERENCES tags(id) ON DELETE CASCADE,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS events (
          id TEXT PRIMARY KEY,
          day_id TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
          title TEXT NOT NULL,
          start_at TEXT NOT NULL,
          end_at TEXT,
          start_precision TEXT NOT NULL DEFAULT 'exact',
          end_precision TEXT NOT NULL DEFAULT 'exact',
          source TEXT NOT NULL DEFAULT 'live',
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS event_tags (
          event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
          is_primary INTEGER NOT NULL DEFAULT 0,
          PRIMARY KEY (event_id, tag_id)
        );

        CREATE TABLE IF NOT EXISTS people (
          id TEXT PRIMARY KEY,
          display_name TEXT NOT NULL,
          aliases_json TEXT NOT NULL DEFAULT '[]',
          notes TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS event_participants (
          event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
          person_id TEXT NOT NULL REFERENCES people(id) ON DELETE CASCADE,
          role TEXT NOT NULL DEFAULT 'with',
          medium TEXT NOT NULL DEFAULT 'in_person',
          initiated_by TEXT NOT NULL DEFAULT 'mutual',
          PRIMARY KEY (event_id, person_id)
        );

        CREATE TABLE IF NOT EXISTS journal_entries (
          id TEXT PRIMARY KEY,
          day_id TEXT NOT NULL REFERENCES days(id) ON DELETE CASCADE,
          body TEXT NOT NULL,
          written_at TEXT NOT NULL,
          source TEXT NOT NULL DEFAULT 'live',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS captures (
          id TEXT PRIMARY KEY,
          raw_text TEXT NOT NULL,
          captured_at TEXT NOT NULL,
          parsed_by TEXT NOT NULL DEFAULT 'rule-parser-v0',
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0
        );

        CREATE INDEX IF NOT EXISTS idx_events_day_id ON events(day_id);
        CREATE INDEX IF NOT EXISTS idx_events_start_at ON events(start_at);
        CREATE INDEX IF NOT EXISTS idx_events_updated_at ON events(updated_at);
        CREATE INDEX IF NOT EXISTS idx_tags_path ON tags(path);
        CREATE INDEX IF NOT EXISTS idx_journal_day_id ON journal_entries(day_id);
        CREATE INDEX IF NOT EXISTS idx_journal_updated_at ON journal_entries(updated_at);
        CREATE INDEX IF NOT EXISTS idx_people_updated_at ON people(updated_at);
        CREATE INDEX IF NOT EXISTS idx_captures_updated_at ON captures(updated_at);
      `);
    },
  },
  {
    version: 3,
    description: 'Suggestion inbox core table and Calendar extension table',
    up: (db: DatabaseSync) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS suggestions (
          id TEXT PRIMARY KEY,
          source TEXT NOT NULL,
          confidence REAL NOT NULL DEFAULT 1,
          proposed_json TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          external_id TEXT,
          accepted_event_id TEXT REFERENCES events(id) ON DELETE SET NULL,
          reviewed_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          is_deleted INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS calendar_items (
          event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
          external_id TEXT NOT NULL,
          calendar_name TEXT,
          recurrence_rule TEXT,
          organizer TEXT,
          attendees_json TEXT NOT NULL DEFAULT '[]',
          imported_at TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_suggestions_status ON suggestions(status);
        CREATE INDEX IF NOT EXISTS idx_suggestions_external ON suggestions(source, external_id);
        CREATE INDEX IF NOT EXISTS idx_suggestions_updated_at ON suggestions(updated_at);
        CREATE INDEX IF NOT EXISTS idx_calendar_items_external ON calendar_items(external_id);
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
