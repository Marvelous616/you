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
    expect(body.schemaVersion).toBe(3);
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
