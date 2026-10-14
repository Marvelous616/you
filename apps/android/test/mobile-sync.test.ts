import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMobileStorage } from '../src/local-store.js';
import { MobileSyncClient } from '../src/sync-client.js';
import { Marker } from '@life-logger/domain';

describe('Android Mobile Offline Capture & Sync (Spike A)', () => {
  let storage: InMemoryMobileStorage;

  beforeEach(() => {
    storage = new InMemoryMobileStorage();
  });

  it('saves a marker offline within the <50ms latency budget', async () => {
    const marker: Marker = {
      id: 'phone-marker-1',
      markedAt: new Date().toISOString(),
      timezoneOffsetMinutes: -300,
      note: 'Quick coffee marker',
      precision: 'exact',
      source: 'live',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
    };

    const { saveDurationMs } = await storage.saveMarkerAndEnqueueOutbox(marker);
    expect(saveDurationMs).toBeLessThan(50); // Quality Gate marker budget

    const pendingCount = await storage.getPendingCount();
    expect(pendingCount).toBe(1);

    const pending = await storage.getPendingOutboxItems();
    expect(pending[0].entityId).toBe('phone-marker-1');
  });

  it('preserves outbox items when sync fails due to network disconnect', async () => {
    const marker: Marker = {
      id: 'phone-marker-2',
      markedAt: new Date().toISOString(),
      timezoneOffsetMinutes: 0,
      precision: 'exact',
      source: 'live',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      isDeleted: false,
    };

    await storage.saveMarkerAndEnqueueOutbox(marker);

    const client = new MobileSyncClient(storage, {
      serverUrl: 'http://localhost:9999-invalid-host',
      clientId: 'android-phone-test',
    });

    const result = await client.syncNow();
    expect(result.syncedCount).toBe(0);
    expect(result.error).toBeDefined();

    // Outbox item must remain intact
    const pendingCount = await storage.getPendingCount();
    expect(pendingCount).toBe(1);
  });
});
