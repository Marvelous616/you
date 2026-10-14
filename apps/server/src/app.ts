import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import {
  DatabaseSync,
  SqliteMarkerRepository,
  SqliteDayRepository,
  IMarkerRepository,
  IDayRepository,
  runMigrations,
} from '@life-logger/persistence';
import {
  PushSyncRequest,
  PushSyncResponse,
  PullSyncResponse,
  SyncRecordPayload,
} from '@life-logger/sync';
import { Marker, Day, resolveLogicalDay } from '@life-logger/domain';

export interface AppOptions {
  db: DatabaseSync;
  apiKey?: string;
}

export function buildApp(options: AppOptions): FastifyInstance {
  const { db, apiKey } = options;
  runMigrations(db);

  const markerRepo: IMarkerRepository = new SqliteMarkerRepository(db);
  const dayRepo: IDayRepository = new SqliteDayRepository(db);

  const server = Fastify({
    logger: false,
  });

  server.register(cors, {
    origin: '*',
  });

  // Single-user Auth Hook (if apiKey is configured)
  if (apiKey) {
    server.addHook('preHandler', async (request, reply) => {
      if (request.url === '/health') return;

      const authHeader = request.headers['authorization'];
      const apiKeyHeader = request.headers['x-api-key'];

      const token = authHeader?.startsWith('Bearer ')
        ? authHeader.slice(7)
        : apiKeyHeader;

      if (!token || token !== apiKey) {
        reply.code(401).send({ error: 'Unauthorized: Invalid or missing API key' });
      }
    });
  }

  // Health check
  server.get('/health', async () => {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: 'connected',
    };
  });

  // Sync: Push outbox records
  server.post<{ Body: PushSyncRequest }>('/api/v1/sync/push', async (request, reply) => {
    const { records } = request.body;

    if (!Array.isArray(records)) {
      reply.code(400).send({ error: 'Invalid payload: records array required' });
      return;
    }

    let acceptedCount = 0;
    const rejected: Array<{ entityId: string; reason: string }> = [];

    for (const record of records) {
      try {
        if (record.entityType === 'marker') {
          const markerData = record.data as Marker;
          if (markerData.dayId) {
            const existingDay = await dayRepo.findById(markerData.dayId);
            if (!existingDay) {
              const localDate = markerData.dayId.startsWith('day-')
                ? markerData.dayId.slice(4)
                : resolveLogicalDay(markerData.markedAt);
              await dayRepo.save({
                id: markerData.dayId,
                localDate,
                timezone: 'UTC',
                reviewStatus: 'unreviewed',
                fidelity: 'skipped',
                createdAt: markerData.createdAt,
                updatedAt: markerData.updatedAt,
                isDeleted: false,
              });
            }
          }
          await markerRepo.save(markerData);
          acceptedCount++;
        } else if (record.entityType === 'day') {
          const dayData = record.data as Day;
          await dayRepo.save(dayData);
          acceptedCount++;
        } else {
          rejected.push({ entityId: record.entityId, reason: `Unsupported entityType: ${record.entityType}` });
        }
      } catch (err) {
        rejected.push({ entityId: record.entityId, reason: String(err) });
      }
    }

    const response: PushSyncResponse = {
      acceptedCount,
      rejected,
      serverTimestamp: new Date().toISOString(),
    };

    return response;
  });

  // Sync: Pull modified records since cursor
  server.get<{ Querystring: { cursor?: string; limit?: string } }>('/api/v1/sync/pull', async (request) => {
    const cursor = request.query.cursor ?? '';
    const limit = request.query.limit ? parseInt(request.query.limit, 10) : 100;

    const delta = await markerRepo.listModifiedSince(cursor, limit);

    const records: SyncRecordPayload<Marker>[] = delta.records.map((m) => ({
      entityType: 'marker',
      entityId: m.id,
      data: m,
      updatedAt: m.updatedAt,
      isDeleted: m.isDeleted,
    }));

    const response: PullSyncResponse = {
      records,
      nextCursor: delta.nextCursor,
      hasMore: delta.hasMore,
      serverTimestamp: new Date().toISOString(),
    };

    return response;
  });

  // Query: Get active logical Day
  server.get<{ Querystring: { timezone?: string } }>('/api/v1/days/active', async (request) => {
    const tz = request.query.timezone || 'UTC';
    const now = new Date();
    const localDate = resolveLogicalDay(now, tz);

    let day = await dayRepo.findByLocalDate(localDate);
    if (!day) {
      day = {
        id: `day-${localDate}`,
        localDate,
        timezone: tz,
        reviewStatus: 'unreviewed',
        fidelity: 'skipped',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        isDeleted: false,
      };
      await dayRepo.save(day);
    }

    return day;
  });

  // Query: List markers
  server.get<{ Querystring: { dayId?: string; includeDeleted?: string } }>('/api/v1/markers', async (request) => {
    const { dayId, includeDeleted } = request.query;
    const withDeleted = includeDeleted === 'true';

    if (dayId) {
      return markerRepo.listByDay(dayId, withDeleted);
    }
    return markerRepo.listAll(withDeleted);
  });

  return server;
}
