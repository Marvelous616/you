import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DatabaseSync } from '@life-logger/persistence';
import { SYNC_PROTOCOL_VERSION } from '@life-logger/sync';
import { buildApp } from '../src/app.js';
import { createShutdownHandler } from '../src/shutdown.js';
import { FastifyInstance } from 'fastify';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

describe('server operations endpoints', () => {
  let db: DatabaseSync;
  let app: FastifyInstance;
  let webDir: string;

  beforeEach(async () => {
    webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-logger-web-'));
    fs.mkdirSync(path.join(webDir, 'assets'));
    fs.writeFileSync(path.join(webDir, 'index.html'), '<html>Life Logger</html>', 'utf8');
    fs.writeFileSync(path.join(webDir, 'assets', 'index-abc123.js'), 'console.log(1);', 'utf8');

    db = new DatabaseSync(':memory:');
    app = buildApp({
      db,
      version: 'v0.3.5-increment-3.5',
      webDir,
    });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(webDir, { recursive: true, force: true });
  });

  it('reports version, schema and sync protocol from /health without auth', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
    expect(body.database).toBe('connected');
    expect(body.version).toBe('v0.3.5-increment-3.5');
    expect(body.schemaVersion).toBe(7);
    expect(body.syncProtocolVersion).toBe(SYNC_PROTOCOL_VERSION);
    expect(body.timestamp).toEqual(expect.any(String));
  });

  it('returns 503 when the database is unavailable', async () => {
    db.close();

    const res = await app.inject({ method: 'GET', url: '/health' });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('error');
    expect(body.database).toBe('unavailable');
    expect(body.version).toBe('v0.3.5-increment-3.5');
  });

  it('serves the web app with cache headers and SPA fallback', async () => {
    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);
    expect(index.body).toContain('Life Logger');
    expect(index.headers['cache-control']).toBe('no-cache');

    const asset = await app.inject({ method: 'GET', url: '/assets/index-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toBe('public, max-age=31536000, immutable');

    const route = await app.inject({ method: 'GET', url: '/day/2026-10-25' });
    expect(route.statusCode).toBe(200);
    expect(route.body).toContain('Life Logger');

    const apiMiss = await app.inject({ method: 'GET', url: '/api/v1/not-a-route' });
    expect(apiMiss.statusCode).toBe(404);
    expect(JSON.parse(apiMiss.body)).toEqual({ error: 'Not Found' });
  });

  it('keeps health and static files available when an API key protects the API', async () => {
    await app.close();
    app = buildApp({
      db: new DatabaseSync(':memory:'),
      apiKey: 'test-secret-key',
      version: 'v0.3.5-increment-3.5',
      webDir,
    });
    await app.ready();

    const health = await app.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);

    const index = await app.inject({ method: 'GET', url: '/' });
    expect(index.statusCode).toBe(200);

    const api = await app.inject({ method: 'GET', url: '/api/v1/tags' });
    expect(api.statusCode).toBe(401);
  });

  it('rejects duplicate alias across people on PUT /people/:id/aliases', async () => {
    // Create two people
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      body: { displayName: 'Alice Smith', aliases: [] },
    });
    const personA = JSON.parse(resA.body);
    const resB = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      body: { displayName: 'Bob Jones', aliases: [] },
    });
    const personB = JSON.parse(resB.body);

    // Give person A an alias
    const res1 = await app.inject({
      method: 'PUT',
      url: `/api/v1/people/${personA.id}/aliases`,
      body: { aliases: ['alice'] },
    });
    expect(res1.statusCode).toBe(200);

    // Person B tries to use the same alias - should conflict
    const res2 = await app.inject({
      method: 'PUT',
      url: `/api/v1/people/${personB.id}/aliases`,
      body: { aliases: ['alice'] },
    });
    expect(res2.statusCode).toBe(409);
    const body2 = JSON.parse(res2.body);
    expect(body2.error).toContain('alice');
    expect(body2.error).toContain(personA.id);

    // Person B tries same alias with different case - should also conflict
    const res3 = await app.inject({
      method: 'PUT',
      url: `/api/v1/people/${personB.id}/aliases`,
      body: { aliases: ['ALICE'] },
    });
    expect(res3.statusCode).toBe(409);
  });

  it('allows reusing a deleted alias', async () => {
    // Create two people
    const resA = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      body: { displayName: 'Alice Smith', aliases: [] },
    });
    const personA = JSON.parse(resA.body);
    const resB = await app.inject({
      method: 'POST',
      url: '/api/v1/people',
      body: { displayName: 'Bob Jones', aliases: [] },
    });
    const personB = JSON.parse(resB.body);

    // Person A gets an alias
    await app.inject({
      method: 'PUT',
      url: `/api/v1/people/${personA.id}/aliases`,
      body: { aliases: ['alice'] },
    });

    // Person A removes the alias
    await app.inject({
      method: 'PUT',
      url: `/api/v1/people/${personA.id}/aliases`,
      body: { aliases: [] },
    });

    // Person B can now use it
    const res = await app.inject({
      method: 'PUT',
      url: `/api/v1/people/${personB.id}/aliases`,
      body: { aliases: ['alice'] },
    });
    expect(res.statusCode).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Increment 4.1 T3: Behaviors the report does not confirm
// ---------------------------------------------------------------------------

describe('Template log and suggestion behavior', () => {
  let db: DatabaseSync;
  let app: FastifyInstance;
  let webDir: string;

  beforeEach(async () => {
    webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'life-logger-web-'));
    fs.mkdirSync(path.join(webDir, 'assets'));
    fs.writeFileSync(path.join(webDir, 'index.html'), '<html>Life Logger</html>', 'utf8');
    fs.writeFileSync(path.join(webDir, 'assets', 'index-abc123.js'), 'console.log(1);', 'utf8');

    db = new DatabaseSync(':memory:');
    app = buildApp({ db, version: 'test', webDir });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
    fs.rmSync(webDir, { recursive: true, force: true });
    db.close();
  });

  it('deleting an event from an accepted suggestion keeps external_id; re-import does not re-propose', async () => {
    // Import an .ics calendar
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:uid-test-1
SUMMARY:Team meeting
DTSTART:20260115T100000Z
DTEND:20260115T110000Z
END:VEVENT
END:VCALENDAR`;

    const importRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/calendar/import',
      body: { ics },
    });
    expect(importRes.statusCode).toBe(200);
    const importBody = JSON.parse(importRes.body);
    expect(importBody.importedCount).toBe(1);

    // Get the suggestion
    const suggestionsRes = await app.inject({
      method: 'GET',
      url: '/api/v1/suggestions?status=pending',
    });
    const suggestions = JSON.parse(suggestionsRes.body);
    expect(suggestions.length).toBe(1);
    const suggestionId = suggestions[0].id;
    expect(suggestions[0].externalId).toBe('uid-test-1');

    // Accept the suggestion
    const acceptRes = await app.inject({
      method: 'POST',
      url: `/api/v1/suggestions/${suggestionId}/accept`,
    });
    expect(acceptRes.statusCode).toBe(200);
    const acceptBody = JSON.parse(acceptRes.body);
    expect(acceptBody.event.id).toBeDefined();

    // Delete the event
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${acceptBody.event.id}`,
    });
    expect(delRes.statusCode).toBe(200);

    // The suggestion should still have external_id
    const suggestionRes = await app.inject({
      method: 'GET',
      url: `/api/v1/suggestions/${suggestionId}`,
    });
    const suggestionBody = JSON.parse(suggestionRes.body);
    expect(suggestionBody.externalId).toBe('uid-test-1');

    // Re-importing the same .ics should not propose again
    const reimportRes = await app.inject({
      method: 'POST',
      url: '/api/v1/extensions/calendar/import',
      body: { ics },
    });
    expect(reimportRes.statusCode).toBe(200);
    const reimportBody = JSON.parse(reimportRes.body);
    expect(reimportBody.importedCount).toBe(0);
    expect(reimportBody.duplicateCount).toBe(1);

    // Restore the event
    const restoreRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${acceptBody.event.id}/restore`,
    });
    expect(restoreRes.statusCode).toBe(200);

    // The restored event should still not be re-proposed (suggestion still has external_id)
    const suggestionAfterRestore = await app.inject({
      method: 'GET',
      url: `/api/v1/suggestions/${suggestionId}`,
    });
    const suggestionAfterRestoreBody = JSON.parse(suggestionAfterRestore.body);
    expect(suggestionAfterRestoreBody.externalId).toBe('uid-test-1');
  });

  it('wake template creates point event and sets day wakeAt', async () => {
    // Create a wake template
    const createTemplateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      body: {
        name: 'Wake up',
        title: 'Wake up',
        special: 'wake',
        isPinned: true,
        sortOrder: 0,
      },
    });
    expect(createTemplateRes.statusCode).toBe(200);
    const templateBody = JSON.parse(createTemplateRes.body);
    const templateId = templateBody.id;

    // Log the template
    const logRes = await app.inject({
      method: 'POST',
      url: `/api/v1/templates/${templateId}/log`,
      body: { startAt: '2026-01-15T07:00:00.000Z' },
    });
    expect(logRes.statusCode).toBe(200);
    const logBody = JSON.parse(logRes.body);
    expect(logBody.event.title).toBe('Wake up');
    expect(logBody.event.endAt).toBeUndefined();
    expect(logBody.dayId).toBeDefined();

    // Check the day has wakeAt set
    const dayRes = await app.inject({
      method: 'GET',
      url: `/api/v1/days/${logBody.dayId}`,
    });
    const dayBody = JSON.parse(dayRes.body);
    expect(dayBody.wakeAt).toBe('2026-01-15T07:00:00.000Z');
  });

  it('sleep template sets day sleepAt', async () => {
    // Create a sleep template
    const createTemplateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      body: {
        name: 'Sleep',
        title: 'Sleep',
        special: 'sleep',
        isPinned: true,
        sortOrder: 1,
      },
    });
    expect(createTemplateRes.statusCode).toBe(200);
    const templateBody = JSON.parse(createTemplateRes.body);
    const templateId = templateBody.id;

    // Log the wake template first so the day exists
    const wakeLogRes = await app.inject({
      method: 'POST',
      url: `/api/v1/templates/${templateId}/log`,
      body: { startAt: '2026-01-15T07:00:00.000Z' },
    });
    expect(wakeLogRes.statusCode).toBe(200);

    // Log the sleep template
    const logRes = await app.inject({
      method: 'POST',
      url: `/api/v1/templates/${templateId}/log`,
      body: { startAt: '2026-01-15T23:00:00.000Z' },
    });
    expect(logRes.statusCode).toBe(200);
    const logBody = JSON.parse(logRes.body);
    expect(logBody.event.title).toBe('Sleep');
    expect(logBody.event.endAt).toBeUndefined();

    // Check the day has sleepAt set
    const dayRes = await app.inject({
      method: 'GET',
      url: '/api/v1/days/day-2026-01-15',
    });
    const dayBody = JSON.parse(dayRes.body);
    expect(dayBody.sleepAt).toBe('2026-01-15T23:00:00.000Z');
  });

  it('second wake log replaces wakeAt (D6)', async () => {
    // Create a wake template
    const createTemplateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      body: {
        name: 'Wake up',
        title: 'Wake up',
        special: 'wake',
        isPinned: true,
        sortOrder: 0,
      },
    });
    expect(createTemplateRes.statusCode).toBe(200);
    const templateBody = JSON.parse(createTemplateRes.body);
    const templateId = templateBody.id;

    // Log wake at 07:00
    const logRes1 = await app.inject({
      method: 'POST',
      url: `/api/v1/templates/${templateId}/log`,
      body: { startAt: '2026-01-15T07:00:00.000Z' },
    });
    expect(logRes1.statusCode).toBe(200);
    const logBody1 = JSON.parse(logRes1.body);
    expect(logBody1.previousWakeAt).toBeUndefined();

    // Log wake again at 08:00 - should replace
    const logRes2 = await app.inject({
      method: 'POST',
      url: `/api/v1/templates/${templateId}/log`,
      body: { startAt: '2026-01-15T08:00:00.000Z' },
    });
    expect(logRes2.statusCode).toBe(200);
    const logBody2 = JSON.parse(logRes2.body);
    expect(logBody2.previousWakeAt).toBe('2026-01-15T07:00:00.000Z');

    // Check the day has the new wakeAt
    const dayRes = await app.inject({
      method: 'GET',
      url: '/api/v1/days/day-2026-01-15',
    });
    const dayBody = JSON.parse(dayRes.body);
    expect(dayBody.wakeAt).toBe('2026-01-15T08:00:00.000Z');
  });

  it('undo after one-tap template deletes event and restores day wakeAt', async () => {
    // Create a wake template
    const createTemplateRes = await app.inject({
      method: 'POST',
      url: '/api/v1/templates',
      body: {
        name: 'Wake up',
        title: 'Wake up',
        special: 'wake',
        isPinned: true,
        sortOrder: 0,
      },
    });
    expect(createTemplateRes.statusCode).toBe(200);
    const templateBody = JSON.parse(createTemplateRes.body);
    const templateId = templateBody.id;

    // Log wake at 07:00
    const logRes = await app.inject({
      method: 'POST',
      url: `/api/v1/templates/${templateId}/log`,
      body: { startAt: '2026-01-15T07:00:00.000Z' },
    });
    expect(logRes.statusCode).toBe(200);
    const logBody = JSON.parse(logRes.body);
    expect(logBody.event.id).toBeDefined();
    expect(logBody.previousWakeAt).toBeUndefined();

    // Delete (undo) the event
    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/v1/events/${logBody.event.id}`,
    });
    expect(delRes.statusCode).toBe(200);

    // Check the day's wakeAt is restored to previous (undefined)
    const dayRes = await app.inject({
      method: 'GET',
      url: '/api/v1/days/day-2026-01-15',
    });
    const dayBody = JSON.parse(dayRes.body);
    expect(dayBody.wakeAt).toBeUndefined();

    // Restore the event
    const restoreRes = await app.inject({
      method: 'POST',
      url: `/api/v1/events/${logBody.event.id}/restore`,
    });
    expect(restoreRes.statusCode).toBe(200);

    // Check the day has wakeAt again
    const dayRes2 = await app.inject({
      method: 'GET',
      url: '/api/v1/days/day-2026-01-15',
    });
    const dayBody2 = JSON.parse(dayRes2.body);
    expect(dayBody2.wakeAt).toBe('2026-01-15T07:00:00.000Z');
  });
});

describe('event edit FK handling', () => {
  let db: DatabaseSync;
  let app: FastifyInstance;

  beforeEach(async () => {
    db = new DatabaseSync(':memory:');
    app = buildApp({ db, version: 'test' });
    await app.ready();
  });

  afterEach(async () => {
    await app.close();
  });

  it('patches an event without an FK error when the start time moves to a new day', async () => {
    // Seed an event on day 2026-01-15 via the active-day + create flow.
    const dayRes = await app.inject({
      method: 'GET',
      url: '/api/v1/days/active?timezone=Pacific/Kiritimati',
    });
    expect(dayRes.statusCode).toBe(200);

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/v1/events',
      payload: {
        event: {
          id: 'e-fk-1',
          dayId: 'day-2026-01-15',
          title: 'Coding',
          startAt: '2026-01-15T10:00:00.000Z',
          endAt: '2026-01-15T11:00:00.000Z',
          startPrecision: 'exact',
          endPrecision: 'exact',
          source: 'live',
          createdAt: '2026-01-15T00:00:00.000Z',
          updatedAt: '2026-01-15T00:00:00.000Z',
          isDeleted: false,
        },
      },
    });
    expect(createRes.statusCode).toBe(200);

    // Move start time to a date whose Day row does not exist yet, and clear end.
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/v1/events/e-fk-1',
      payload: {
        startAt: '2026-02-20T23:30:00.000Z',
        endAt: null,
      },
    });

    expect(patchRes.statusCode).toBe(200);
    const body = JSON.parse(patchRes.body);
    expect(body.event.endAt).toBeUndefined();
    expect(body.event.dayId).toBeTruthy();
  });
});

describe('graceful shutdown', () => {
  it('closes HTTP, checkpoints the WAL, closes SQLite and exits zero', async () => {
    const calls: string[] = [];
    const app = { close: vi.fn(async () => void calls.push('app')) };
    const db = {
      exec: vi.fn((sql: string) => void calls.push(sql)),
      close: vi.fn(() => void calls.push('db')),
    };
    const exits: number[] = [];

    const shutdown = createShutdownHandler({
      app,
      db,
      logger: () => {},
      exit: (code) => void exits.push(code),
      timeoutMs: 1000,
    });

    await shutdown('SIGTERM');

    expect(calls).toEqual(['app', 'PRAGMA wal_checkpoint(TRUNCATE)', 'db']);
    expect(exits).toEqual([0]);

    await shutdown('SIGINT');
    expect(app.close).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
  });

  it('exits non-zero when a shutdown step fails', async () => {
    const exits: number[] = [];
    const shutdown = createShutdownHandler({
      app: { close: async () => Promise.reject(new Error('close failed')) },
      db: { exec: () => {}, close: () => {} },
      logger: () => {},
      exit: (code) => void exits.push(code),
      timeoutMs: 1000,
    });

    await shutdown('SIGTERM');
    expect(exits).toEqual([1]);
  });
});
