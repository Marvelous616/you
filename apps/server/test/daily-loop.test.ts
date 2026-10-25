import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from '@life-logger/persistence';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

const AUTH = { 'x-api-key': 'test-secret-key' };
const T0 = '2026-10-14T00:00:00.000Z';

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    id: 'e-1',
    dayId: 'day-2026-10-14',
    title: 'Coding',
    startAt: '2026-10-14T09:00:00.000Z',
    endAt: '2026-10-14T17:30:00.000Z',
    startPrecision: 'exact',
    endPrecision: 'exact',
    source: 'live',
    createdAt: T0,
    updatedAt: T0,
    isDeleted: false,
    ...overrides,
  };
}

describe('Daily Loop API', () => {
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

  it('creates an event with tags, people and a capture', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: AUTH,
      payload: {
        event: eventPayload({ title: 'Deep work' }),
        tagPaths: ['work/coding', 'focus'],
        peopleNames: ['Rahul'],
        capture: {
          id: 'c-1',
          rawText: 'deep work with @rahul #work/coding #focus',
          capturedAt: '2026-10-14T08:00:00.000Z',
          parsedBy: 'rule-parser-v0',
          createdAt: T0,
          updatedAt: T0,
          isDeleted: false,
        },
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.event.id).toBe('e-1');
    expect(body.tags.map((tag: { path: string }) => tag.path)).toEqual([
      'focus',
      'work',
      'work/coding',
    ]);
    expect(body.eventTags).toEqual([
      { eventId: 'e-1', tagId: 'tag-work-coding', isPrimary: true },
      { eventId: 'e-1', tagId: 'tag-focus', isPrimary: false },
    ]);
    expect(body.people).toHaveLength(1);
    expect(body.participants).toEqual([
      {
        eventId: 'e-1',
        personId: 'person-rahul',
        role: 'with',
        medium: 'in_person',
        initiatedBy: 'mutual',
      },
    ]);

    const timeline = await app.inject({
      method: 'GET',
      url: '/api/v1/days/day-2026-10-14/timeline',
      headers: AUTH,
    });
    expect(timeline.statusCode).toBe(200);
    const timelineBody = JSON.parse(timeline.body);
    expect(timelineBody.events).toHaveLength(1);
    expect(timelineBody.tags).toHaveLength(3);
    expect(timelineBody.people).toHaveLength(1);
    expect(timelineBody.coverage).toBe(0);
  });

  it('computes coverage once wake time is known', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: AUTH,
      payload: { event: eventPayload() },
    });
    await app.inject({
      method: 'PATCH',
      url: '/api/v1/days/day-2026-10-14',
      headers: AUTH,
      payload: { wakeAt: '2026-10-14T08:00:00.000Z', sleepAt: '2026-10-14T18:00:00.000Z' },
    });

    const timeline = await app.inject({
      method: 'GET',
      url: '/api/v1/days/day-2026-10-14/timeline',
      headers: AUTH,
    });
    const timelineBody = JSON.parse(timeline.body);
    expect(timelineBody.coverage).toBeCloseTo(0.85, 5);
    expect(timelineBody.gaps[0].durationMinutes).toBe(60);
  });

  it('completes the review and derives day fidelity', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: AUTH,
      payload: {
        event: eventPayload({
          startAt: '2026-10-14T08:00:00.000Z',
          endAt: '2026-10-14T15:30:00.000Z',
        }),
      },
    });

    await app.inject({
      method: 'PATCH',
      url: '/api/v1/days/day-2026-10-14',
      headers: AUTH,
      payload: { wakeAt: '2026-10-14T08:00:00.000Z' },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/days/day-2026-10-14/review',
      headers: AUTH,
      payload: {
        sleepAt: '2026-10-14T18:00:00.000Z',
        journalBody: 'A focused day.',
        now: '2026-10-14T22:00:00.000Z',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.day.reviewStatus).toBe('completed');
    expect(body.day.fidelity).toBe('detailed');
    expect(body.coverage).toBeCloseTo(0.75, 5);
    expect(body.journalEntries).toHaveLength(1);

    const dayRes = await app.inject({
      method: 'GET',
      url: '/api/v1/days/day-2026-10-14',
      headers: AUTH,
    });
    expect(JSON.parse(dayRes.body).fidelity).toBe('detailed');
  });

  it('patches wake and sleep times', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: AUTH,
      payload: { event: eventPayload() },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/days/day-2026-10-14',
      headers: AUTH,
      payload: {
        wakeAt: '2026-10-14T07:30:00.000Z',
        sleepAt: '2026-10-14T23:00:00.000Z',
        reviewStatus: 'in_progress',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.wakeAt).toBe('2026-10-14T07:30:00.000Z');
    expect(body.reviewStatus).toBe('in_progress');
  });

  it('pushes and pulls every Daily Loop entity type', async () => {
    const records = [
      {
        entityType: 'marker',
        entityId: 'm-sync',
        data: {
          id: 'm-sync',
          dayId: 'day-2026-10-14',
          markedAt: '2026-10-14T08:00:00.000Z',
          timezoneOffsetMinutes: 0,
          precision: 'exact',
          source: 'live',
          createdAt: T0,
          updatedAt: T0,
          isDeleted: false,
        },
        updatedAt: T0,
        isDeleted: false,
      },
      {
        entityType: 'tag',
        entityId: 'tag-work',
        data: {
          id: 'tag-work',
          name: 'Work',
          path: 'work',
          createdAt: T0,
          updatedAt: T0,
          isDeleted: false,
        },
        updatedAt: T0,
        isDeleted: false,
      },
      {
        entityType: 'person',
        entityId: 'p-rahul',
        data: {
          id: 'p-rahul',
          displayName: 'Rahul',
          aliases: ['rahul.k'],
          createdAt: T0,
          updatedAt: T0,
          isDeleted: false,
        },
        updatedAt: T0,
        isDeleted: false,
      },
      {
        entityType: 'event',
        entityId: 'e-sync',
        data: eventPayload({ id: 'e-sync' }),
        updatedAt: T0,
        isDeleted: false,
      },
      {
        entityType: 'event_tag',
        entityId: 'e-sync:tag-work',
        data: { eventId: 'e-sync', tagId: 'tag-work', isPrimary: true },
        updatedAt: T0,
        isDeleted: false,
      },
      {
        entityType: 'event_participant',
        entityId: 'e-sync:p-rahul',
        data: {
          eventId: 'e-sync',
          personId: 'p-rahul',
          role: 'with',
          medium: 'call',
          initiatedBy: 'them',
        },
        updatedAt: T0,
        isDeleted: false,
      },
      {
        entityType: 'journal_entry',
        entityId: 'j-sync',
        data: {
          id: 'j-sync',
          dayId: 'day-2026-10-14',
          body: 'Synced reflection',
          writtenAt: '2026-10-14T21:00:00.000Z',
          source: 'live',
          createdAt: T0,
          updatedAt: T0,
          isDeleted: false,
        },
        updatedAt: T0,
        isDeleted: false,
      },
      {
        entityType: 'capture',
        entityId: 'cap-sync',
        data: {
          id: 'cap-sync',
          rawText: 'sync me',
          capturedAt: '2026-10-14T08:00:00.000Z',
          parsedBy: 'rule-parser-v0',
          createdAt: T0,
          updatedAt: T0,
          isDeleted: false,
        },
        updatedAt: T0,
        isDeleted: false,
      },
    ];

    const pushRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: AUTH,
      payload: { clientId: 'phone', batchId: 'b-1', records },
    });

    expect(pushRes.statusCode).toBe(200);
    const pushBody = JSON.parse(pushRes.body);
    expect(pushBody.acceptedCount).toBe(records.length);
    expect(pushBody.rejected).toEqual([]);

    const pullRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull',
      headers: AUTH,
    });

    expect(pullRes.statusCode).toBe(200);
    const pullBody = JSON.parse(pullRes.body);
    const types = new Set(pullBody.records.map((record: { entityType: string }) => record.entityType));
    expect(types).toEqual(
      new Set([
        'marker',
        'day',
        'event',
        'tag',
        'event_tag',
        'person',
        'event_participant',
        'journal_entry',
        'capture',
      ])
    );

    const event = pullBody.records.find(
      (record: { entityType: string }) => record.entityType === 'event'
    );
    expect(event.data.title).toBe('Coding');
  });

  it('removes an event tag when a delete link is pushed', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      headers: AUTH,
      payload: { event: eventPayload(), tagPaths: ['work'] },
    });

    const linkRes = await app.inject({
      method: 'GET',
      url: '/api/v1/events/e-1',
      headers: AUTH,
    });
    expect(JSON.parse(linkRes.body).eventTags).toHaveLength(1);

    const pushRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: AUTH,
      payload: {
        clientId: 'phone',
        batchId: 'b-delete',
        records: [
          {
            entityType: 'event_tag',
            entityId: 'e-1:tag-work',
            data: { eventId: 'e-1', tagId: 'tag-work', isPrimary: true },
            updatedAt: T0,
            isDeleted: true,
          },
        ],
      },
    });
    expect(pushRes.statusCode).toBe(200);

    const after = await app.inject({
      method: 'GET',
      url: '/api/v1/events/e-1',
      headers: AUTH,
    });
    expect(JSON.parse(after.body).eventTags).toEqual([]);
  });
});
