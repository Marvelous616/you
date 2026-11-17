import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from '@life-logger/persistence';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

const AUTH = { 'x-api-key': 'test-secret-key' };

describe('Search API', () => {
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

  it('returns events whose title or notes match the query', async () => {
    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: AUTH,
      payload: {
        event: {
          id: 'e-search-1',
          dayId: 'day-2026-10-14',
          title: 'Deep work',
          startAt: '2026-10-14T09:00:00.000Z',
          startPrecision: 'exact',
          endPrecision: 'unknown',
          source: 'live',
          notes: 'Shipped the parser rewrite today.',
          createdAt: '2026-10-14T00:00:00.000Z',
          updatedAt: '2026-10-14T00:00:00.000Z',
          isDeleted: false,
        },
      },
    });
    expect(eventRes.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=deep',
      headers: AUTH,
    });

    const body = JSON.parse(res.body);
    expect(body.query).toBe('deep');
    expect(Array.isArray(body.hits)).toBe(true);
    expect(body.hits).toHaveLength(1);
    expect(body.hits[0]).toMatchObject({
      entityType: 'event',
      entityId: 'e-search-1',
      title: 'Deep work',
    });
  });

  it('returns journal entries whose body matches the query', async () => {
    const eventRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: AUTH,
      payload: {
        event: {
          id: 'e-search-2',
          dayId: 'day-2026-10-14',
          title: 'Walk',
          startAt: '2026-10-14T08:00:00.000Z',
          startPrecision: 'exact',
          endPrecision: 'unknown',
          source: 'live',
          createdAt: '2026-10-14T00:00:00.000Z',
          updatedAt: '2026-10-14T00:00:00.000Z',
          isDeleted: false,
        },
      },
    });
    expect(eventRes.statusCode).toBe(200);

    const journalRes = await app.inject({
      method: 'POST',
      url: '/api/v1/days/day-2026-10-14/journal',
      headers: AUTH,
      payload: { body: 'Feeling stuck on the sync contract this week.' },
    });
    expect(journalRes.statusCode).toBe(200);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=stuck',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.hits.length).toBeGreaterThan(0);
    const journalHit = body.hits.find((hit: { entityType: string }) => hit.entityType === 'journal_entry');
    expect(journalHit).toBeDefined();
    expect(journalHit.entityId).toBeTruthy();
  });

  it('returns empty hits for a query with no matches', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/search?q=zzzznotfound',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.query).toBe('zzzznotfound');
    expect(body.hits).toEqual([]);
  });
});
