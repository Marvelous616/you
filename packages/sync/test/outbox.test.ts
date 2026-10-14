import { describe, it, expect } from 'vitest';
import { createOutboxItem, outboxItemsToPushRequest } from '../src/outbox.js';

describe('sync outbox logic', () => {
  it('creates a well-formed outbox item', () => {
    const markerData = { note: 'Coffee break', markedAt: '2026-10-14T11:00:00.000Z' };
    const item = createOutboxItem(
      'outbox-1',
      'marker',
      'marker-123',
      'UPSERT',
      markerData,
      '2026-10-14T11:00:00.000Z'
    );

    expect(item.id).toBe('outbox-1');
    expect(item.entityType).toBe('marker');
    expect(item.entityId).toBe('marker-123');
    expect(item.operation).toBe('UPSERT');
    expect(item.status).toBe('PENDING');

    const parsed = JSON.parse(item.payloadJson);
    expect(parsed.data.note).toBe('Coffee break');
    expect(parsed.isDeleted).toBe(false);
  });

  it('converts outbox items into a push request batch', () => {
    const item1 = createOutboxItem(
      'outbox-1',
      'marker',
      'm-1',
      'UPSERT',
      { note: 'Test 1' },
      '2026-10-14T11:00:00.000Z'
    );
    const item2 = createOutboxItem(
      'outbox-2',
      'marker',
      'm-2',
      'DELETE',
      { note: 'Test 2' },
      '2026-10-14T11:05:00.000Z',
      true
    );

    const pushRequest = outboxItemsToPushRequest('android-client-1', 'batch-abc', [item1, item2]);

    expect(pushRequest.clientId).toBe('android-client-1');
    expect(pushRequest.batchId).toBe('batch-abc');
    expect(pushRequest.records).toHaveLength(2);
    expect(pushRequest.records[0].entityId).toBe('m-1');
    expect(pushRequest.records[1].isDeleted).toBe(true);
  });
});
