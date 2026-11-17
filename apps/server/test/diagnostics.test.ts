import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DatabaseSync } from '@life-logger/persistence';
import { buildApp } from '../src/app.js';
import { FastifyInstance } from 'fastify';

const AUTH = { 'x-api-key': 'test-secret-key' };

function crashReport(overrides: Record<string, unknown> = {}) {
  return {
    id: 'crash-1',
    error: 'TypeError: Cannot read property x of null',
    appVersion: '0.3.6',
    deviceType: 'web',
    screen: '/day/2026-10-14',
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  } as Record<string, unknown>;
}

function perfSample(overrides: Record<string, unknown> = {}) {
  return {
    id: 'perf-1',
    operation: 'open-today',
    durationMs: 42,
    deviceType: 'web',
    createdAt: '2026-10-14T00:00:00.000Z',
    updatedAt: '2026-10-14T00:00:00.000Z',
    isDeleted: false,
    ...overrides,
  } as Record<string, unknown>;
}

describe('Diagnostics API', () => {
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

  describe('crash reports', () => {
    it('saves and lists a crash report', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/diagnostics/crash-reports',
        headers: AUTH,
        payload: crashReport(),
      });
      expect(createRes.statusCode).toBe(201);

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/diagnostics/crash-reports',
        headers: AUTH,
      });
      expect(listRes.statusCode).toBe(200);
      const body = JSON.parse(listRes.body);
      expect(body).toHaveLength(1);
      expect(body[0].error).toBe('TypeError: Cannot read property x of null');
      expect(body[0].deviceType).toBe('web');
    });

    it('rejects a crash report missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/diagnostics/crash-reports',
        headers: AUTH,
        payload: { error: 'oops' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('perf samples', () => {
    it('saves and lists a perf sample', async () => {
      const createRes = await app.inject({
        method: 'POST',
        url: '/api/v1/diagnostics/perf-samples',
        headers: AUTH,
        payload: perfSample(),
      });
      expect(createRes.statusCode).toBe(201);

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/diagnostics/perf-samples',
        headers: AUTH,
      });
      expect(listRes.statusCode).toBe(200);
      const body = JSON.parse(listRes.body);
      expect(body).toHaveLength(1);
      expect(body[0].operation).toBe('open-today');
      expect(body[0].durationMs).toBe(42);
    });

    it('rejects a perf sample missing required fields', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/diagnostics/perf-samples',
        headers: AUTH,
        payload: { operation: 'open-today' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('prune retention job', () => {
    it('prunes records older than the retention window', async () => {
      // Environment date is 2026-11-17; retentionDays=30 → cutoff 2026-10-18.
      const old = crashReport({ id: 'crash-old', createdAt: '2026-09-01T00:00:00.000Z' });
      const recent = crashReport({
        id: 'crash-recent',
        createdAt: '2026-11-01T00:00:00.000Z',
      });

      await app.inject({
        method: 'POST',
        url: '/api/v1/diagnostics/crash-reports',
        headers: AUTH,
        payload: old,
      });
      await app.inject({
        method: 'POST',
        url: '/api/v1/diagnostics/crash-reports',
        headers: AUTH,
        payload: recent,
      });

      const pruneRes = await app.inject({
        method: 'POST',
        url: '/api/v1/diagnostics/prune?retentionDays=30',
        headers: AUTH,
      });
      expect(pruneRes.statusCode).toBe(200);
      expect(JSON.parse(pruneRes.body).pruned).toBe(1);

      const listRes = await app.inject({
        method: 'GET',
        url: '/api/v1/diagnostics/crash-reports',
        headers: AUTH,
      });
      const body = JSON.parse(listRes.body);
      expect(body.map((r: { id: string }) => r.id)).toEqual(['crash-recent']);
    });

    it('rejects an invalid retentionDays', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/diagnostics/prune?retentionDays=0',
        headers: AUTH,
      });
      expect(res.statusCode).toBe(400);
    });
  });
});
