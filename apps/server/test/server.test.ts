import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from '@life-logger/persistence';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { PushSyncRequest } from '@life-logger/sync';

describe('Fastify Server API', () => {
  let db: DatabaseSync;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    app = buildApp({ db, apiKey: 'test-secret-key' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('responds with 200 on /health without requiring auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
  });

  it('rejects protected endpoints when API key is missing', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/markers',
    });

    expect(res.statusCode).toBe(401);
  });

  it('accepts push sync batch and allows pulling it back', async () => {
    const pushPayload: PushSyncRequest = {
      clientId: 'test-phone',
      batchId: 'batch-001',
      records: [
        {
          entityType: 'marker',
          entityId: 'marker-sync-1',
          data: {
            id: 'marker-sync-1',
            dayId: 'day-2026-10-14',
            markedAt: '2026-10-14T14:30:00.000Z',
            timezoneOffsetMinutes: 0,
            note: 'Walk outside',
            precision: 'exact',
            source: 'live',
            createdAt: '2026-10-14T14:30:00.000Z',
            updatedAt: '2026-10-14T14:30:00.000Z',
            isDeleted: false,
          },
          updatedAt: '2026-10-14T14:30:00.000Z',
          isDeleted: false,
        },
      ],
    };

    const pushRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: {
        'x-api-key': 'test-secret-key',
      },
      payload: pushPayload,
    });

    expect(pushRes.statusCode).toBe(200);
    const pushBody = JSON.parse(pushRes.body);
    expect(pushBody.acceptedCount).toBe(1);

    // Pull delta
    const pullRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull',
      headers: {
        'x-api-key': 'test-secret-key',
      },
    });

    expect(pullRes.statusCode).toBe(200);
    const pullBody = JSON.parse(pullRes.body);
    const markerRecord = pullBody.records.find(
      (record: { entityType: string }) => record.entityType === 'marker'
    );
    expect(markerRecord.entityId).toBe('marker-sync-1');
    expect(markerRecord.data.note).toBe('Walk outside');
    expect(
      pullBody.records.some((record: { entityType: string }) => record.entityType === 'day')
    ).toBe(true);

    // Query markers by day
    const markersRes = await app.inject({
      method: 'GET',
      url: '/api/v1/markers?dayId=day-2026-10-14',
      headers: {
        'x-api-key': 'test-secret-key',
      },
    });

    expect(markersRes.statusCode).toBe(200);
    const markers = JSON.parse(markersRes.body);
    expect(markers).toHaveLength(1);
    expect(markers[0].id).toBe('marker-sync-1');
  });
});
