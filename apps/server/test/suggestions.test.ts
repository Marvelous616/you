import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from '@life-logger/persistence';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';
import { PushSyncRequest } from '@life-logger/sync';
import { calendarSuggestionId } from '@life-logger/domain';

const AUTH = { 'x-api-key': 'test-secret-key' };

function ics(body: string): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', body, 'END:VCALENDAR'].join('\r\n');
}

const PLANNING_ICS = ics(
  [
    'BEGIN:VEVENT',
    'UID:planning@example.com',
    'SUMMARY:Team planning',
    'DTSTART:20261014T100000Z',
    'DTEND:20261014T110000Z',
    'LOCATION:Room 4',
    'END:VEVENT',
  ].join('\r\n')
);

describe('Suggestion inbox and Calendar extension API', () => {
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

  async function importCalendar(): Promise<{ importedCount: number; suggestions: unknown[] }> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/calendar/import',
      headers: AUTH,
      payload: { ics: PLANNING_ICS },
    });
    expect(res.statusCode).toBe(200);
    return JSON.parse(res.body);
  }

  it('lists the registered extensions', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/extensions',
      headers: AUTH,
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.map((extension: { id: string }) => extension.id)).toEqual(['calendar']);
  });

  it('imports calendar events as pending suggestions with approx precision', async () => {
    const body = await importCalendar();

    expect(body.importedCount).toBe(1);
    const suggestion = body.suggestions[0] as {
      id: string;
      source: string;
      status: string;
      proposed: { title: string; startPrecision: string; notes: string };
    };
    expect(suggestion.id).toBe(calendarSuggestionId('planning@example.com'));
    expect(suggestion.source).toBe('calendar');
    expect(suggestion.status).toBe('pending');
    expect(suggestion.proposed.title).toBe('Team planning');
    expect(suggestion.proposed.startPrecision).toBe('approx');
    expect(suggestion.proposed.notes).toContain('Location: Room 4');

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/v1/suggestions?status=pending',
      headers: AUTH,
    });
    const list = JSON.parse(listRes.body);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(suggestion.id);
  });

  it('does not re-propose an already declined calendar item', async () => {
    const first = await importCalendar();
    const suggestionId = (first.suggestions[0] as { id: string }).id;

    const rejectRes = await app.inject({
      method: 'POST',
      url: `/api/v1/suggestions/${suggestionId}/reject`,
      headers: AUTH,
    });
    expect(rejectRes.statusCode).toBe(200);
    expect(JSON.parse(rejectRes.body).status).toBe('rejected');

    const second = (await importCalendar()) as {
      importedCount: number;
      duplicateCount: number;
      duplicates: Array<{ suggestionId: string; status: string }>;
    };
    expect(second.importedCount).toBe(0);
    expect(second.duplicateCount).toBe(1);
    expect(second.duplicates[0]).toEqual({
      externalId: 'planning@example.com',
      suggestionId,
      status: 'rejected',
    });

    const pendingRes = await app.inject({
      method: 'GET',
      url: '/api/v1/suggestions?status=pending',
      headers: AUTH,
    });
    expect(JSON.parse(pendingRes.body)).toHaveLength(0);
  });

  it('accepts a suggestion into an imported event and records calendar metadata', async () => {
    const imported = await importCalendar();
    const suggestionId = (imported.suggestions[0] as { id: string }).id;

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/suggestions/${suggestionId}/accept`,
      headers: AUTH,
      payload: {
        eventId: 'event-imported-1',
        dayId: 'day-2026-10-14',
        now: '2026-10-14T09:00:00.000Z',
        overrides: {
          title: 'Team planning (confirmed)',
          tagPaths: ['work/planning'],
        },
      },
    });

    expect(acceptRes.statusCode).toBe(200);
    const body = JSON.parse(acceptRes.body);
    expect(body.suggestion.status).toBe('accepted');
    expect(body.suggestion.acceptedEventId).toBe('event-imported-1');
    expect(body.event.source).toBe('imported');
    expect(body.event.title).toBe('Team planning (confirmed)');
    expect(body.event.startPrecision).toBe('approx');
    expect(body.event.dayId).toBe('day-2026-10-14');
    expect(body.tags.map((tag: { path: string }) => tag.path)).toContain('work/planning');

    const timelineRes = await app.inject({
      method: 'GET',
      url: '/api/v1/days/day-2026-10-14/timeline',
      headers: AUTH,
    });
    const timeline = JSON.parse(timelineRes.body);
    expect(timeline.events).toHaveLength(1);
    expect(timeline.events[0].id).toBe('event-imported-1');

    const calendarItem = db
      .prepare('SELECT * FROM calendar_items WHERE event_id = ?')
      .get('event-imported-1') as { external_id: string } | undefined;
    expect(calendarItem?.external_id).toBe('planning@example.com');

    const acceptAgain = await app.inject({
      method: 'POST',
      url: `/api/v1/suggestions/${suggestionId}/accept`,
      headers: AUTH,
    });
    expect(acceptAgain.statusCode).toBe(409);
  });

  it('edits a pending suggestion before accepting it', async () => {
    const imported = await importCalendar();
    const suggestionId = (imported.suggestions[0] as { id: string }).id;

    const editRes = await app.inject({
      method: 'PATCH',
      url: `/api/v1/suggestions/${suggestionId}`,
      headers: AUTH,
      payload: {
        title: 'Planning moved',
        startAt: '2026-10-14T12:00:00.000Z',
        endAt: '2026-10-14T13:00:00.000Z',
      },
    });

    expect(editRes.statusCode).toBe(200);
    const edited = JSON.parse(editRes.body);
    expect(edited.status).toBe('pending');
    expect(edited.proposed.title).toBe('Planning moved');
    expect(edited.proposed.startAt).toBe('2026-10-14T12:00:00.000Z');

    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/suggestions/${suggestionId}/accept`,
      headers: AUTH,
      payload: { eventId: 'event-edited' },
    });
    const accepted = JSON.parse(acceptRes.body);
    expect(accepted.event.title).toBe('Planning moved');
    expect(accepted.event.startAt).toBe('2026-10-14T12:00:00.000Z');
  });

  it('syncs suggestions through push and pull', async () => {
    const suggestion = {
      id: 'suggestion-sync-1',
      source: 'calendar',
      confidence: 0.8,
      proposed: {
        title: 'Synced plan',
        startAt: '2026-10-14T15:00:00.000Z',
        startPrecision: 'approx',
        endPrecision: 'unknown',
      },
      status: 'pending',
      externalId: 'sync-uid',
      createdAt: '2026-10-14T08:00:00.000Z',
      updatedAt: '2026-10-14T08:00:00.000Z',
      isDeleted: false,
    };

    const pushPayload: PushSyncRequest = {
      clientId: 'android',
      batchId: 'batch-suggestion',
      records: [
        {
          entityType: 'suggestion',
          entityId: suggestion.id,
          data: suggestion,
          updatedAt: suggestion.updatedAt,
          isDeleted: false,
        },
      ],
    };

    const pushRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: AUTH,
      payload: pushPayload,
    });
    expect(pushRes.statusCode).toBe(200);
    expect(JSON.parse(pushRes.body).acceptedCount).toBe(1);

    const pullRes = await app.inject({
      method: 'GET',
      url: '/api/v1/sync/pull?cursor=2026-10-14T00:00:00.000Z',
      headers: AUTH,
    });
    const pulled = JSON.parse(pullRes.body);
    const record = pulled.records.find(
      (entry: { entityType: string }) => entry.entityType === 'suggestion'
    );
    expect(record.entityId).toBe(suggestion.id);
    expect(record.data.proposed.title).toBe('Synced plan');
  });

  it('records calendar metadata when a client accepts a suggestion offline', async () => {
    const event = {
      id: 'event-offline-accepted',
      dayId: 'day-2026-10-14',
      title: 'Offline accepted plan',
      startAt: '2026-10-14T15:00:00.000Z',
      endAt: '2026-10-14T16:00:00.000Z',
      startPrecision: 'approx',
      endPrecision: 'approx',
      source: 'imported',
      createdAt: '2026-10-14T08:00:00.000Z',
      updatedAt: '2026-10-14T08:00:00.000Z',
      isDeleted: false,
    };
    const acceptedSuggestion = {
      id: 'suggestion-offline-accepted',
      source: 'calendar',
      confidence: 0.9,
      proposed: {
        title: event.title,
        startAt: event.startAt,
        endAt: event.endAt,
        startPrecision: 'approx',
        endPrecision: 'approx',
      },
      status: 'accepted',
      externalId: 'offline-uid',
      acceptedEventId: event.id,
      reviewedAt: '2026-10-14T08:00:01.000Z',
      createdAt: '2026-10-14T08:00:00.000Z',
      updatedAt: '2026-10-14T08:00:01.000Z',
      isDeleted: false,
    };

    const pushRes = await app.inject({
      method: 'POST',
      url: '/api/v1/sync/push',
      headers: AUTH,
      payload: {
        clientId: 'android',
        batchId: 'batch-offline-accept',
        records: [
          {
            entityType: 'event',
            entityId: event.id,
            data: event,
            updatedAt: event.updatedAt,
            isDeleted: false,
          },
          {
            entityType: 'suggestion',
            entityId: acceptedSuggestion.id,
            data: acceptedSuggestion,
            updatedAt: acceptedSuggestion.updatedAt,
            isDeleted: false,
          },
        ],
      } satisfies PushSyncRequest,
    });
    expect(pushRes.statusCode).toBe(200);
    expect(JSON.parse(pushRes.body).acceptedCount).toBe(2);

    const item = db
      .prepare('SELECT external_id FROM calendar_items WHERE event_id = ?')
      .get(event.id) as { external_id: string } | undefined;
    expect(item?.external_id).toBe('offline-uid');

    const reimportRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/calendar/import',
      headers: AUTH,
      payload: {
        ics: ics(
          [
            'BEGIN:VEVENT',
            'UID:offline-uid',
            'SUMMARY:Offline accepted plan',
            'DTSTART:20261014T150000Z',
            'DTEND:20261014T160000Z',
            'END:VEVENT',
          ].join('\r\n')
        ),
      },
    });
    const reimport = JSON.parse(reimportRes.body);
    expect(reimport.importedCount).toBe(0);
    expect(reimport.duplicates[0].status).toBe('accepted');
  });
});
