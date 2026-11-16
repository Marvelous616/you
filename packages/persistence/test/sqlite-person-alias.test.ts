import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync, runMigrations } from '@life-logger/persistence';
import { SqlitePersonAliasRepository } from '@life-logger/persistence';
import { SqlitePersonRepository } from '@life-logger/persistence';
import { PersonAlias, Person } from '@life-logger/domain';

function makeDb() {
  const db = new DatabaseSync(':memory:');
  runMigrations(db);
  return db;
}

function makePerson(id: string, displayName: string): Person {
  return {
    id,
    displayName,
    aliases: [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  };
}

function makeAlias(
  personId: string,
  alias: string,
  id = `alias-${personId}-${alias.replace(/[^a-z0-9]+/g, '-')}`
): PersonAlias {
  return {
    id,
    personId,
    alias,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    isDeleted: false,
  };
}

describe('Person alias uniqueness (cross-person, case-insensitive)', () => {
  let db: DatabaseSync;
  let repo: SqlitePersonAliasRepository;
  let personRepo: SqlitePersonRepository;

  beforeEach(() => {
    db = makeDb();
    repo = new SqlitePersonAliasRepository(db);
    personRepo = new SqlitePersonRepository(db);
    // Create people first so FK constraints are satisfied
    personRepo.save(makePerson('person-1', 'Alice Smith'));
    personRepo.save(makePerson('person-2', 'Bob Jones'));
  });

  afterEach(() => {
    db.close();
  });

  it('saves aliases for two people with different names', async () => {
    await repo.save(makeAlias('person-1', 'alice'));
    await repo.save(makeAlias('person-2', 'bob'));

    const found = await repo.findByAlias('alice');
    expect(found?.personId).toBe('person-1');
  });

  it('rejects the same alias for a different person', async () => {
    await repo.save(makeAlias('person-1', 'alice'));

    await expect(
      repo.save(makeAlias('person-2', 'alice'))
    ).rejects.toThrow(/already used by person person-1/);
  });

  it('rejects an alias differing only in case', async () => {
    await repo.save(makeAlias('person-1', 'Alice'));

    await expect(
      repo.save(makeAlias('person-2', 'ALICE'))
    ).rejects.toThrow(/already used by person person-1/);
  });

  it('allows reusing a deleted alias', async () => {
    await repo.save(makeAlias('person-1', 'alice'));
    await repo.save({ ...makeAlias('person-1', 'alice'), isDeleted: true });

    // Deleting the alias record, then re-saving should work
    await repo.deleteForPerson('person-1');
    await repo.save(makeAlias('person-2', 'alice'));

    const found = await repo.findByAlias('alice');
    expect(found?.personId).toBe('person-2');
  });

  it('finds alias case-insensitively', async () => {
    await repo.save(makeAlias('person-1', 'Alice'));

    const found = await repo.findByAlias('ALICE');
    expect(found?.personId).toBe('person-1');
    expect(found?.alias).toBe('Alice');
  });
});
