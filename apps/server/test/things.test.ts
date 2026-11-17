import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from '@life-logger/persistence';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

const AUTH = { 'x-api-key': 'test-secret-key' };

describe('Things API', () => {
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

  describe('type definitions', () => {
    it('creates, lists, patches and soft deletes a type definition', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/type-definitions',
        headers: AUTH,
        payload: { name: 'Sleep', fieldType: 'number', schema: { unit: 'hours' } },
      });
      expect(createRes.statusCode).toBe(200);
      const created = JSON.parse(createRes.body);
      expect(created.name).toBe('Sleep');
      expect(created.fieldType).toBe('number');
      expect(created.schema).toEqual({ unit: 'hours' });

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/type-definitions',
        headers: AUTH,
      });
      expect(listRes.statusCode).toBe(200);
      expect(JSON.parse(listRes.body)).toHaveLength(1);

      const dupRes = await app.inject({
        method: 'POST',
        url: '/api/v1/type-definitions',
        headers: AUTH,
        payload: { name: 'Sleep', fieldType: 'text' },
      });
      expect(dupRes.statusCode).toBe(409);

      const badRes = await app.inject({
        method: 'POST',
        url: '/api/v1/type-definitions',
        headers: AUTH,
        payload: { name: 'NoFieldType' },
      });
      expect(badRes.statusCode).toBe(400);

      const patchRes = await app.inject({
        method: 'PATCH',
        url: `/api/v1/type-definitions/${created.id}`,
        headers: AUTH,
        payload: { fieldType: 'duration' },
      });
      expect(patchRes.statusCode).toBe(200);
      expect(JSON.parse(patchRes.body).fieldType).toBe('duration');

      const patchMissingRes = await app.inject({
        method: 'PATCH',
        url: '/api/v1/type-definitions/type-missing',
        headers: AUTH,
        payload: { fieldType: 'text' },
      });
      expect(patchMissingRes.statusCode).toBe(404);

      const delRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/type-definitions/${created.id}`,
        headers: AUTH,
      });
      expect(delRes.statusCode).toBe(200);

      const delMissingRes = await app.inject({
        method: 'DELETE',
        url: '/api/v1/type-definitions/type-missing',
        headers: AUTH,
      });
      expect(delMissingRes.statusCode).toBe(404);
    });
  });

  describe('event things', () => {
    it('attaches a typed value to an event and updates it', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/type-definitions',
        headers: AUTH,
        payload: { name: 'Sleep', fieldType: 'number' },
      });
      const typeDef = JSON.parse(createRes.body);

      const eventRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events',
        headers: AUTH,
        payload: {
          event: {
            id: 'e-thing',
            dayId: 'day-2026-10-14',
            title: 'Sleep',
            startAt: '2026-10-14T23:00:00.000Z',
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

      const attachRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events/e-thing/things',
        headers: AUTH,
        payload: { typeDefinitionId: typeDef.id, value: { hours: 7.5 } },
      });
      expect(attachRes.statusCode).toBe(200);
      const thing = JSON.parse(attachRes.body);
      expect(thing.eventId).toBe('e-thing');
      expect(thing.value).toEqual({ hours: 7.5 });

      const attachAgain = await app.inject({
        method: 'POST',
        url: '/api/v1/events/e-thing/things',
        headers: AUTH,
        payload: { typeDefinitionId: typeDef.id, value: { hours: 8 } },
      });
      expect(attachAgain.statusCode).toBe(200);
      expect(JSON.parse(attachAgain.body).value).toEqual({ hours: 8 });

      const missingTypeRes = await app.inject({
        method: 'POST',
        url: '/api/v1/events/e-thing/things',
        headers: AUTH,
        payload: { typeDefinitionId: 'type-missing', value: {} },
      });
      expect(missingTypeRes.statusCode).toBe(400);

      const detachRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/events/e-thing/things/${typeDef.id}`,
        headers: AUTH,
      });
      expect(detachRes.statusCode).toBe(200);

      const detachAgainRes = await app.inject({
        method: 'DELETE',
        url: `/api/v1/events/e-thing/things/${typeDef.id}`,
        headers: AUTH,
      });
      expect(detachAgainRes.statusCode).toBe(404);
    });
  });

  describe('sync', () => {
    it('accepts type_definition and event_thing entities in push and returns them in pull', async () => {
      const pushRes = await app.inject({
        method: 'POST',
        url: '/api/v1/sync/push',
        headers: AUTH,
        payload: {
          clientId: 'phone',
          batchId: 'b-things',
          records: [
            {
              entityType: 'event',
              entityId: 'e-sync',
              data: {
                id: 'e-sync',
                dayId: 'day-2026-10-14',
                title: 'Coding',
                startAt: '2026-10-14T09:00:00.000Z',
                endAt: '2026-10-14T17:30:00.000Z',
                startPrecision: 'exact',
                endPrecision: 'exact',
                source: 'live',
                createdAt: '2026-10-14T00:00:00.000Z',
                updatedAt: '2026-10-14T00:00:00.000Z',
                isDeleted: false,
              },
              updatedAt: '2026-10-14T00:00:00.000Z',
              isDeleted: false,
            },
            {
              entityType: 'type_definition',
              entityId: 'type-sync',
              data: {
                id: 'type-sync',
                name: 'Mood',
                fieldType: 'text',
                createdAt: '2026-10-14T00:00:00.000Z',
                updatedAt: '2026-10-14T00:00:00.000Z',
                isDeleted: false,
              },
              updatedAt: '2026-10-14T00:00:00.000Z',
              isDeleted: false,
            },
            {
              entityType: 'event_thing',
              entityId: 'thing-sync',
              data: {
                id: 'thing-sync',
                eventId: 'e-sync',
                typeDefinitionId: 'type-sync',
                value: { mood: 'ok' },
                createdAt: '2026-10-14T00:00:00.000Z',
                updatedAt: '2026-10-14T00:00:00.000Z',
                isDeleted: false,
              },
              updatedAt: '2026-10-14T00:00:00.000Z',
              isDeleted: false,
            },
          ],
        },
      });

      expect(pushRes.statusCode).toBe(200);
      const pushBody = JSON.parse(pushRes.body);
      expect(pushBody.acceptedCount).toBe(3);
      expect(pushBody.rejected).toEqual([]);

      const pullRes = await app.inject({
        method: 'GET',
        url: '/api/v1/sync/pull',
        headers: AUTH,
      });
      expect(pullRes.statusCode).toBe(200);
      const pullBody = JSON.parse(pullRes.body);
      const types = new Set(
        pullBody.records.map((record: { entityType: string }) => record.entityType)
      );
      expect(types.has('type_definition')).toBe(true);
      expect(types.has('event_thing')).toBe(true);

      const thing = pullBody.records.find(
        (record: { entityType: string }) => record.entityType === 'event_thing'
      );
      expect(thing.data.value).toEqual({ mood: 'ok' });
    });
  });
});
