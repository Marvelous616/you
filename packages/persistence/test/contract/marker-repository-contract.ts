import { describe, it, expect, beforeEach } from 'vitest';
import { IMarkerRepository } from '../../src/interfaces.js';
import { Marker } from '@life-logger/domain';

export function runMarkerRepositoryContractTests(
  name: string,
  setupRepo: () => Promise<IMarkerRepository>
) {
  describe(`MarkerRepository Contract Suite: ${name}`, () => {
    let repo: IMarkerRepository;

    beforeEach(async () => {
      repo = await setupRepo();
    });

    it('saves and finds a marker by id', async () => {
      const marker: Marker = {
        id: 'm-1',
        markedAt: '2026-10-14T12:00:00.000Z',
        timezoneOffsetMinutes: 330,
        note: 'Coffee break',
        precision: 'exact',
        source: 'live',
        createdAt: '2026-10-14T12:00:00.000Z',
        updatedAt: '2026-10-14T12:00:00.000Z',
        isDeleted: false,
      };

      await repo.save(marker);
      const found = await repo.findById('m-1');

      expect(found).not.toBeNull();
      expect(found?.id).toBe('m-1');
      expect(found?.note).toBe('Coffee break');
      expect(found?.isDeleted).toBe(false);
    });

    it('updates an existing marker when updatedAt is newer (LWW)', async () => {
      const initial: Marker = {
        id: 'm-2',
        markedAt: '2026-10-14T12:00:00.000Z',
        timezoneOffsetMinutes: 0,
        note: 'Initial note',
        precision: 'exact',
        source: 'live',
        createdAt: '2026-10-14T12:00:00.000Z',
        updatedAt: '2026-10-14T12:00:00.000Z',
        isDeleted: false,
      };

      await repo.save(initial);

      const updated: Marker = {
        ...initial,
        note: 'Updated note',
        updatedAt: '2026-10-14T12:05:00.000Z',
      };

      await repo.save(updated);
      const found = await repo.findById('m-2');
      expect(found?.note).toBe('Updated note');
    });

    it('ignores stale updates when updatedAt is older', async () => {
      const current: Marker = {
        id: 'm-3',
        markedAt: '2026-10-14T12:00:00.000Z',
        timezoneOffsetMinutes: 0,
        note: 'Current valid note',
        precision: 'exact',
        source: 'live',
        createdAt: '2026-10-14T12:00:00.000Z',
        updatedAt: '2026-10-14T12:10:00.000Z',
        isDeleted: false,
      };

      await repo.save(current);

      const stale: Marker = {
        ...current,
        note: 'Stale offline edit',
        updatedAt: '2026-10-14T12:01:00.000Z',
      };

      await repo.save(stale);
      const found = await repo.findById('m-3');
      expect(found?.note).toBe('Current valid note');
    });

    it('persists soft deletion and filters correctly', async () => {
      const marker: Marker = {
        id: 'm-4',
        dayId: 'day-1',
        markedAt: '2026-10-14T12:00:00.000Z',
        timezoneOffsetMinutes: 0,
        note: 'To delete',
        precision: 'exact',
        source: 'live',
        createdAt: '2026-10-14T12:00:00.000Z',
        updatedAt: '2026-10-14T12:00:00.000Z',
        isDeleted: false,
      };

      await repo.save(marker);

      const deleted: Marker = {
        ...marker,
        isDeleted: true,
        updatedAt: '2026-10-14T12:15:00.000Z',
      };

      await repo.save(deleted);

      const activeList = await repo.listByDay('day-1', false);
      expect(activeList.find((m) => m.id === 'm-4')).toBeUndefined();

      const fullList = await repo.listByDay('day-1', true);
      expect(fullList.find((m) => m.id === 'm-4')?.isDeleted).toBe(true);
    });

    it('lists records modified since a cursor in order', async () => {
      const m1: Marker = {
        id: 'm-c1',
        markedAt: '2026-10-14T10:00:00.000Z',
        timezoneOffsetMinutes: 0,
        note: 'First',
        precision: 'exact',
        source: 'live',
        createdAt: '2026-10-14T10:00:00.000Z',
        updatedAt: '2026-10-14T10:00:00.000Z',
        isDeleted: false,
      };

      const m2: Marker = {
        id: 'm-c2',
        markedAt: '2026-10-14T11:00:00.000Z',
        timezoneOffsetMinutes: 0,
        note: 'Second',
        precision: 'exact',
        source: 'live',
        createdAt: '2026-10-14T11:00:00.000Z',
        updatedAt: '2026-10-14T11:00:00.000Z',
        isDeleted: false,
      };

      await repo.saveBatch([m1, m2]);

      const delta = await repo.listModifiedSince('2026-10-14T10:30:00.000Z');
      expect(delta.records).toHaveLength(1);
      expect(delta.records[0].id).toBe('m-c2');
    });
  });
}
