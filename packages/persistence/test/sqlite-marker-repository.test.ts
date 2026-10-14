import { DatabaseSync } from '../src/sqlite/db.js';
import { runMigrations } from '../src/sqlite/migrations.js';
import { SqliteMarkerRepository } from '../src/sqlite/marker-repository.js';
import { runMarkerRepositoryContractTests } from './contract/marker-repository-contract.js';

runMarkerRepositoryContractTests('SqliteMarkerRepository (in-memory WAL)', async () => {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  // Seed parent day for foreign key tests
  db.prepare(`
    INSERT INTO days (id, local_date, timezone, created_at, updated_at)
    VALUES ('day-1', '2026-10-14', 'UTC', '2026-10-14T00:00:00.000Z', '2026-10-14T00:00:00.000Z')
  `).run();
  return new SqliteMarkerRepository(db);
});
