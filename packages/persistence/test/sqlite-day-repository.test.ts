import { describe, it, expect, beforeEach } from 'vitest';
import { DatabaseSync } from '../src/sqlite/db.js';
import { runMigrations } from '../src/sqlite/migrations.js';
import { SqliteDayRepository } from '../src/sqlite/day-repository.js';
import { Day } from '@life-logger/domain';

describe('SqliteDayRepository', () => {
  let db: DatabaseSync;
  let repo: SqliteDayRepository;

  beforeEach(() => {
    db = new DatabaseSync(':memory:');
    runMigrations(db);
    repo = new SqliteDayRepository(db);
  });

  it('saves and retrieves Day entity by local date and id', async () => {
    const day: Day = {
      id: 'day-1',
      localDate: '2026-10-14',
      timezone: 'UTC',
      reviewStatus: 'unreviewed',
      fidelity: 'skipped',
      createdAt: '2026-10-14T08:00:00.000Z',
      updatedAt: '2026-10-14T08:00:00.000Z',
      isDeleted: false,
    };

    await repo.save(day);

    const byId = await repo.findById('day-1');
    expect(byId).not.toBeNull();
    expect(byId?.localDate).toBe('2026-10-14');

    const byDate = await repo.findByLocalDate('2026-10-14');
    expect(byDate).not.toBeNull();
    expect(byDate?.id).toBe('day-1');
  });
});
