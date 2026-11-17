import Fastify, { FastifyInstance, FastifyServerOptions } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import {
  DatabaseSync,
  SqliteCalendarItemRepository,
  SqliteCaptureRepository,
  SqliteDayRepository,
  SqliteEventRepository,
  SqliteEventThingRepository,
  SqliteJournalRepository,
  SqliteMarkerRepository,
  SqlitePersonAliasRepository,
  SqlitePersonRepository,
  SqliteSuggestionRepository,
  SqliteTagRepository,
  SqliteTemplateRepository,
  SqliteTemplateTagRepository,
  SqliteTypeDefinitionRepository,
  ICalendarItemRepository,
  ICaptureRepository,
  IDayRepository,
  IEventRepository,
  IEventThingRepository,
  IJournalRepository,
  IMarkerRepository,
  IPersonAliasRepository,
  IPersonRepository,
  ISuggestionRepository,
  ITagRepository,
  ITemplateRepository,
  ITemplateTagRepository,
  ITypeDefinitionRepository,
  runMigrations,
} from '@life-logger/persistence';
import {
  PushSyncRequest,
  PushSyncResponse,
  PullSyncResponse,
  SYNC_PROTOCOL_VERSION,
  SyncRecordPayload,
} from '@life-logger/sync';
import {
  CALENDAR_EXTENSION,
  Capture,
  CalendarItem,
  Day,
  Event,
  EventParticipant,
  EventTag,
  EventThing,
  JournalEntry,
  Marker,
  Person,
  Suggestion,
  SuggestionOverrides,
  SuggestionStatus,
  Tag,
  Template,
  TypeDefinition,
  acceptSuggestion,
  applyEventPatch,
  buildEventFromSuggestion,
  calculateDayCoverage,
  calculateDayFidelity,
  calendarEventsToSuggestions,
  createDefaultExtensionRegistry,
  buildTemplate,
  editSuggestion,
  findTimelineGaps,
  getLocalDateString,
  parseIcsCalendar,
  rejectSuggestion,
  resolveLogicalDay,
  reassignDay,
  resolvePeopleForEvent,
  resolveTagsForEvent,
  templateToEventDraft,
} from '@life-logger/domain';

export interface AppOptions {
  db: DatabaseSync;
  apiKey?: string;
  /** Release version reported by /health and the web footer. */
  version?: string;
  /** Built web app directory. Static serving is skipped when it is absent. */
  webDir?: string;
  logger?: FastifyServerOptions['logger'];
}

/** Reads the applied migration number once so /health never scans tables. */
export function readSchemaVersion(db: DatabaseSync): number {
  try {
    const row = db
      .prepare('SELECT MAX(version) AS version FROM schema_migrations')
      .get() as { version: number | null } | undefined;
    return row?.version ?? 0;
  } catch {
    return 0;
  }
}

interface CreateEventBody {
  event: Partial<Event> & Pick<Event, 'title' | 'startAt'>;
  tagPaths?: string[];
  peopleNames?: string[];
  capture?: Capture;
}

interface JournalBody {
  id?: string;
  body: string;
  writtenAt?: string;
  source?: JournalEntry['source'];
}

interface ReviewBody {
  sleepAt?: string;
  journalId?: string;
  journalBody?: string;
  now?: string;
}

interface DayPatchBody {
  wakeAt?: string;
  sleepAt?: string;
  reviewStatus?: Day['reviewStatus'];
  timezone?: string;
}

interface AcceptSuggestionBody {
  overrides?: SuggestionOverrides;
  eventId?: string;
  dayId?: string;
  now?: string;
}

interface EditSuggestionBody extends SuggestionOverrides {}

interface CalendarImportBody {
  ics: string;
}

interface PatchEventInput {
  title?: string;
  startAt?: string;
  endAt?: string | null;
  startPrecision?: 'exact' | 'approx' | 'unknown';
  endPrecision?: 'exact' | 'approx' | 'unknown' | null;
  notes?: string | null;
  tagPaths?: string[];
  peopleNames?: string[];
}

interface CreateTagBody {
  name: string;
  color?: string;
  parentId?: string;
}

interface PatchTagBody {
  name?: string;
  color?: string;
  parentId?: string | null;
}

interface CreatePersonBody {
  displayName: string;
  aliases?: string[];
  notes?: string;
}

interface PatchPersonBody {
  displayName?: string;
  notes?: string | null;
}

interface PutPersonAliasesBody {
  aliases: string[];
}

interface CreateTemplateBody {
  name: string;
  title: string;
  defaultDurationMinutes?: number;
  tagIds?: string[];
  special?: 'wake' | 'sleep';
  isPinned?: boolean;
  sortOrder?: number;
}

interface PatchTemplateBody {
  name?: string;
  title?: string;
  defaultDurationMinutes?: number | null;
  tagIds?: string[];
  special?: 'wake' | 'sleep' | null;
  isPinned?: boolean;
  sortOrder?: number;
}

interface LogTemplateBody {
  startAt?: string;
}

interface CreateTypeDefinitionBody {
  name: string;
  fieldType: string;
  schema?: Record<string, unknown>;
}

interface PatchTypeDefinitionBody {
  name?: string;
  fieldType?: string;
  schema?: Record<string, unknown> | null;
}

interface AttachEventThingBody {
  typeDefinitionId: string;
  value?: Record<string, unknown>;
}

function normalizeRecord<T extends object>(record: SyncRecordPayload, forceId?: string): T {
  const data = record.data;
  if (!data || typeof data !== 'object') {
    throw new Error(`Invalid data for ${record.entityType}`);
  }

  const entity = { ...(data as T) } as T & { id?: string };
  if (!entity.id) entity.id = forceId ?? record.entityId;
  return entity as T;
}

function isLocalDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * Keeps mutation timestamps monotonic so a client clock that lags the record's
 * last write cannot make an accept/reject/edit lose last-write-wins.
 */
function resolveUpdateTime(requested: Date, recordUpdatedAt: string): Date {
  const recordTime = new Date(recordUpdatedAt).getTime();
  if (Number.isNaN(recordTime)) return requested;
  return requested.getTime() > recordTime ? requested : new Date(recordTime + 1);
}

export function buildApp(options: AppOptions): FastifyInstance {
  const { db, apiKey } = options;
  runMigrations(db);

  const appVersion = options.version ?? '0.0.0-dev';
  const schemaVersion = readSchemaVersion(db);

  const markerRepo: IMarkerRepository = new SqliteMarkerRepository(db);
  const dayRepo: IDayRepository = new SqliteDayRepository(db);
  const eventRepo: IEventRepository = new SqliteEventRepository(db);
  const tagRepo: ITagRepository = new SqliteTagRepository(db);
  const personRepo: IPersonRepository = new SqlitePersonRepository(db);
  const personAliasRepo: IPersonAliasRepository = new SqlitePersonAliasRepository(db);
  const journalRepo: IJournalRepository = new SqliteJournalRepository(db);
  const captureRepo: ICaptureRepository = new SqliteCaptureRepository(db);
  const suggestionRepo: ISuggestionRepository = new SqliteSuggestionRepository(db);
  const calendarItemRepo: ICalendarItemRepository = new SqliteCalendarItemRepository(db);
  const templateRepo: ITemplateRepository = new SqliteTemplateRepository(db);
  const templateTagRepo: ITemplateTagRepository = new SqliteTemplateTagRepository(db);
  const typeDefinitionRepo: ITypeDefinitionRepository = new SqliteTypeDefinitionRepository(db);
  const eventThingRepo: IEventThingRepository = new SqliteEventThingRepository(db);
  const extensionRegistry = createDefaultExtensionRegistry();

  const server = Fastify({ logger: options.logger ?? false });

  server.register(cors, { origin: '*' });

  if (apiKey) {
    server.addHook('preHandler', async (request, reply) => {
      const urlPath = request.url.split('?')[0];
      if (!urlPath.startsWith('/api/')) return;

      const authHeader = request.headers['authorization'];
      const apiKeyHeader = request.headers['x-api-key'];

      const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : apiKeyHeader;

      if (!token || token !== apiKey) {
        reply.code(401).send({ error: 'Unauthorized: Invalid or missing API key' });
      }
    });
  }

  /**
   * Ensures the parent Day exists for a foreign-keyed record. Returns the
   * effective day id, which may differ from the requested id when the same
   * local date already has a server-side Day.
   */
  async function ensureDay(dayId: string, at: string): Promise<string> {
    const existing = await dayRepo.findById(dayId);
    if (existing) return existing.id;

    const localDate = dayId.startsWith('day-') && isLocalDate(dayId.slice(4))
      ? dayId.slice(4)
      : getLocalDateString(new Date(at), 'UTC');

    const byDate = await dayRepo.findByLocalDate(localDate);
    if (byDate) return byDate.id;

    const timestamp = new Date().toISOString();
    await dayRepo.save({
      id: dayId,
      localDate,
      timezone: 'UTC',
      reviewStatus: 'unreviewed',
      fidelity: 'skipped',
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    });

    return dayId;
  }

  async function persistCapture(capture: Capture): Promise<void> {
    await captureRepo.save(capture);
  }

  server.get('/health', async (_request, reply) => {
    const base = {
      timestamp: new Date().toISOString(),
      version: appVersion,
      schemaVersion,
      syncProtocolVersion: SYNC_PROTOCOL_VERSION,
    };

    try {
      // A direct connection probe only; never scans application tables.
      db.prepare('SELECT 1').get();
      return { status: 'ok', database: 'connected', ...base };
    } catch {
      reply.code(503);
      return { status: 'error', database: 'unavailable', ...base };
    }
  });

  // ---------------------------------------------------------------------------
  // Sync push / pull
  // ---------------------------------------------------------------------------

  server.post<{ Body: PushSyncRequest }>('/api/v1/sync/push', async (request, reply) => {
    const { records } = request.body ?? {};

    if (!Array.isArray(records)) {
      reply.code(400).send({ error: 'Invalid payload: records array required' });
      return;
    }

    let acceptedCount = 0;
    const rejected: Array<{ entityId: string; reason: string }> = [];

    db.exec('BEGIN IMMEDIATE');
    try {
      for (const record of records) {
        try {
          switch (record.entityType) {
            case 'marker': {
              const marker = normalizeRecord<Marker>(record);
              if (marker.dayId) {
                marker.dayId = await ensureDay(marker.dayId, marker.markedAt);
              }
              await markerRepo.save(marker);
              break;
            }
            case 'day': {
              const day = normalizeRecord<Day>(record);
              await dayRepo.save(day);
              break;
            }
            case 'event': {
              const event = normalizeRecord<Event>(record);
              event.dayId = await ensureDay(event.dayId, event.startAt);
              await eventRepo.save(event);
              break;
            }
            case 'tag': {
              const tag = normalizeRecord<Tag>(record);
              await tagRepo.save(tag);
              break;
            }
            case 'person': {
              const person = normalizeRecord<Person>(record);
              await personRepo.save(person);
              break;
            }
            case 'journal_entry': {
              const entry = normalizeRecord<JournalEntry>(record);
              entry.dayId = await ensureDay(entry.dayId, entry.writtenAt);
              await journalRepo.save(entry);
              break;
            }
            case 'capture': {
              const capture = normalizeRecord<Capture>(record);
              await persistCapture(capture);
              break;
            }
            case 'event_tag': {
              const link = normalizeRecord<EventTag>(record);
              if (record.isDeleted) {
                await tagRepo.removeEventTag(link.eventId, link.tagId);
              } else {
                await tagRepo.linkEventTag(link);
              }
              break;
            }
            case 'event_participant': {
              const participant = normalizeRecord<EventParticipant>(record);
              if (record.isDeleted) {
                await personRepo.unlinkParticipant(participant.eventId, participant.personId);
              } else {
                await personRepo.linkParticipant(participant);
              }
              break;
            }
            case 'type_definition': {
              const typeDefinition = normalizeRecord<TypeDefinition>(record);
              await typeDefinitionRepo.save(typeDefinition);
              break;
            }
            case 'event_thing': {
              const thing = normalizeRecord<EventThing>(record);
              await eventThingRepo.save(thing);
              break;
            }
            case 'suggestion': {
              const suggestion = normalizeRecord<Suggestion>(record);
              if (
                suggestion.acceptedEventId &&
                !(await eventRepo.findById(suggestion.acceptedEventId))
              ) {
                suggestion.acceptedEventId = undefined;
              }
              await suggestionRepo.save(suggestion);

              // An accept performed offline on a client still owns the calendar
              // metadata for the imported event, so record it when it arrives.
              if (
                suggestion.status === 'accepted' &&
                suggestion.source === 'calendar' &&
                suggestion.externalId &&
                suggestion.acceptedEventId
              ) {
                const existingItem = await calendarItemRepo.findByEventId(
                  suggestion.acceptedEventId
                );
                if (!existingItem) {
                  await calendarItemRepo.save({
                    eventId: suggestion.acceptedEventId,
                    externalId: suggestion.externalId,
                    attendees: [],
                    importedAt: suggestion.reviewedAt ?? suggestion.updatedAt,
                  });
                }
              }
              break;
            }
            default: {
              rejected.push({
                entityId: record.entityId,
                reason: `Unsupported entityType: ${String(record.entityType)}`,
              });
              continue;
            }
          }

          acceptedCount++;
        } catch (err) {
          rejected.push({ entityId: record.entityId, reason: String(err) });
        }
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      reply.code(500).send({ error: `Sync batch failed: ${String(err)}` });
      return;
    }

    const response: PushSyncResponse = {
      acceptedCount,
      rejected,
      serverTimestamp: new Date().toISOString(),
    };

    return response;
  });

  server.get<{ Querystring: { cursor?: string; limit?: string } }>(
    '/api/v1/sync/pull',
    async (request) => {
      const cursor = request.query.cursor ?? '';
      const limit = request.query.limit ? Math.max(1, parseInt(request.query.limit, 10)) : 100;

      const [
        markerDelta,
        dayDelta,
        eventDelta,
        tagDelta,
        personDelta,
        journalDelta,
        captureDelta,
        eventTagDelta,
        participantDelta,
        suggestionDelta,
        typeDefinitionDelta,
        eventThingDelta,
      ] = await Promise.all([
        markerRepo.listModifiedSince(cursor, limit),
        dayRepo.listModifiedSince(cursor, limit),
        eventRepo.listModifiedSince(cursor, limit),
        tagRepo.listTree(true).then((tags) => ({
          records: tags.filter((tag) => tag.updatedAt > cursor).slice(0, limit),
          nextCursor: '',
          hasMore: false,
        })),
        personRepo.listAll(true).then((people) => ({
          records: people.filter((person) => person.updatedAt > cursor).slice(0, limit),
          nextCursor: '',
          hasMore: false,
        })),
        journalRepo.listModifiedSince(cursor, limit),
        captureRepo.listModifiedSince(cursor, limit),
        tagRepo.listEventTagsModifiedSince(cursor, limit),
        personRepo.listParticipantsModifiedSince(cursor, limit),
        suggestionRepo.listModifiedSince(cursor, limit),
        typeDefinitionRepo.listModifiedSince(cursor, limit),
        eventThingRepo.listModifiedSince(cursor, limit),
      ]);

      const records: SyncRecordPayload[] = [
        ...markerDelta.records.map((marker) => toRecord('marker', marker.id, marker)),
        ...dayDelta.records.map((day) => toRecord('day', day.id, day)),
        ...eventDelta.records.map((event) => toRecord('event', event.id, event)),
        ...tagDelta.records.map((tag) => toRecord('tag', tag.id, tag)),
        ...personDelta.records.map((person) => toRecord('person', person.id, person)),
        ...journalDelta.records.map((entry) =>
          toRecord('journal_entry', entry.id, entry)
        ),
        ...captureDelta.records.map((capture) => toRecord('capture', capture.id, capture)),
        ...eventTagDelta.records.map(({ link, updatedAt }) =>
          toRecord('event_tag', `${link.eventId}:${link.tagId}`, link, updatedAt)
        ),
        ...participantDelta.records.map(({ participant, updatedAt }) =>
          toRecord(
            'event_participant',
            `${participant.eventId}:${participant.personId}`,
            participant,
            updatedAt
          )
        ),
        ...suggestionDelta.records.map((suggestion) =>
          toRecord('suggestion', suggestion.id, suggestion)
        ),
        ...typeDefinitionDelta.records.map((typeDefinition) =>
          toRecord('type_definition', typeDefinition.id, typeDefinition)
        ),
        ...eventThingDelta.records.map((thing) => toRecord('event_thing', thing.id, thing)),
      ];

      records.sort(
        (a, b) =>
          a.updatedAt.localeCompare(b.updatedAt) ||
          a.entityType.localeCompare(b.entityType) ||
          a.entityId.localeCompare(b.entityId)
      );

      const page = records.slice(0, limit);
      let consumed = page.length;
      if (records.length > limit) {
        const lastTimestamp = page[page.length - 1].updatedAt;
        while (consumed < records.length && records[consumed].updatedAt === lastTimestamp) {
          page.push(records[consumed]);
          consumed++;
        }
      }

      const response: PullSyncResponse = {
        records: page,
        nextCursor: page.length > 0 ? page[page.length - 1].updatedAt : cursor,
        hasMore: records.length > page.length,
        serverTimestamp: new Date().toISOString(),
      };

      return response;
    }
  );

  // ---------------------------------------------------------------------------
  // Day queries and lifecycle
  // ---------------------------------------------------------------------------

  server.get('/api/v1/days', async () => {
    return dayRepo.listAll();
  });

  server.get<{ Querystring: { timezone?: string } }>('/api/v1/days/active', async (request) => {
    const timezone = request.query.timezone || 'UTC';
    const now = new Date();
    const localDate = resolveLogicalDay(now, timezone);

    let day = await dayRepo.findByLocalDate(localDate);
    if (!day) {
      day = await dayRepo.findById(`day-${localDate}`);
    }
    if (!day) {
      day = {
        id: `day-${localDate}`,
        localDate,
        timezone,
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

  server.get<{ Params: { dayId: string } }>('/api/v1/days/:dayId', async (request, reply) => {
    const day = await dayRepo.findById(request.params.dayId);
    if (!day) {
      reply.code(404).send({ error: 'Day not found' });
      return;
    }
    return day;
  });

  server.patch<{ Params: { dayId: string }; Body: DayPatchBody }>(
    '/api/v1/days/:dayId',
    async (request, reply) => {
      const day = await dayRepo.findById(request.params.dayId);
      if (!day) {
        reply.code(404).send({ error: 'Day not found' });
        return;
      }

      const body = request.body ?? {};
      const updated: Day = {
        ...day,
        wakeAt: body.wakeAt ?? day.wakeAt,
        sleepAt: body.sleepAt ?? day.sleepAt,
        timezone: body.timezone ?? day.timezone,
        reviewStatus: body.reviewStatus ?? day.reviewStatus,
        updatedAt: new Date().toISOString(),
      };
      await dayRepo.save(updated);
      return updated;
    }
  );

  server.get<{ Params: { dayId: string } }>(
    '/api/v1/days/:dayId/timeline',
    async (request, reply) => {
      const day = await dayRepo.findById(request.params.dayId);
      if (!day) {
        reply.code(404).send({ error: 'Day not found' });
        return;
      }

      const [markers, events, tags, eventTags, people, participants, journalEntries] =
        await Promise.all([
          markerRepo.listByDay(day.id),
          eventRepo.listByDay(day.id),
          tagRepo.listTree(),
          tagRepo.listEventTagsForDay(day.id),
          personRepo.listAll(),
          personRepo.listParticipantsForDay(day.id),
          journalRepo.listByDay(day.id),
        ]);

      const now = new Date();
      return {
        day,
        markers,
        events,
        tags,
        eventTags,
        people,
        participants,
        journalEntries,
        gaps: findTimelineGaps(day, events, 15, now),
        coverage: calculateDayCoverage(day, events, now),
      };
    }
  );

  server.get<{ Params: { dayId: string } }>(
    '/api/v1/days/:dayId/journal',
    async (request) => {
      return journalRepo.listByDay(request.params.dayId);
    }
  );

  server.post<{ Params: { dayId: string }; Body: JournalBody }>(
    '/api/v1/days/:dayId/journal',
    async (request, reply) => {
      const day = await dayRepo.findById(request.params.dayId);
      if (!day) {
        reply.code(404).send({ error: 'Day not found' });
        return;
      }

      const body = request.body;
      if (!body || typeof body.body !== 'string') {
        reply.code(400).send({ error: 'journal body is required' });
        return;
      }

      const now = new Date().toISOString();
      const writtenAt = body.writtenAt ?? now;
      const entry: JournalEntry = {
        id: body.id ?? `journal-${randomUUID()}`,
        dayId: day.id,
        body: body.body,
        writtenAt,
        source: body.source ?? 'live',
        createdAt: writtenAt,
        updatedAt: now,
        isDeleted: false,
      };
      await journalRepo.save(entry);
      return entry;
    }
  );

  server.post<{ Params: { dayId: string }; Body: ReviewBody }>(
    '/api/v1/days/:dayId/review',
    async (request, reply) => {
      const day = await dayRepo.findById(request.params.dayId);
      if (!day) {
        reply.code(404).send({ error: 'Day not found' });
        return;
      }

      const body = request.body ?? {};
      const evaluationNow = body.now ? new Date(body.now) : new Date();
      const timestamp = new Date().toISOString();

      if (typeof body.journalBody === 'string') {
        const writtenAt = timestamp;
        const entry: JournalEntry = {
          id: body.journalId ?? `journal-${day.id}`,
          dayId: day.id,
          body: body.journalBody,
          writtenAt,
          source: 'live',
          createdAt: writtenAt,
          updatedAt: timestamp,
          isDeleted: false,
        };
        await journalRepo.save(entry);
      }

      const [events, journalEntries] = await Promise.all([
        eventRepo.listByDay(day.id),
        journalRepo.listByDay(day.id),
      ]);

      const closing: Day = {
        ...day,
        sleepAt: body.sleepAt ?? day.sleepAt,
        reviewStatus: 'completed',
        fidelity: 'skipped',
        updatedAt: timestamp,
      };
      closing.fidelity = calculateDayFidelity(closing, events, journalEntries, evaluationNow);
      await dayRepo.save(closing);

      return {
        day: closing,
        fidelity: closing.fidelity,
        coverage: calculateDayCoverage(closing, events, evaluationNow),
        gaps: findTimelineGaps(closing, events, 15, evaluationNow),
        journalEntries,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Markers, events, tags, people, captures
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: { dayId?: string; includeDeleted?: string } }>(
    '/api/v1/markers',
    async (request) => {
      const withDeleted = request.query.includeDeleted === 'true';
      if (request.query.dayId) {
        return markerRepo.listByDay(request.query.dayId, withDeleted);
      }
      return markerRepo.listAll(withDeleted);
    }
  );

  server.get<{ Querystring: { dayId?: string; includeDeleted?: string } }>(
    '/api/v1/events',
    async (request) => {
      const withDeleted = request.query.includeDeleted === 'true';
      if (request.query.dayId) {
        return eventRepo.listByDay(request.query.dayId, withDeleted);
      }
      return eventRepo.listAll(withDeleted);
    }
  );

  server.get<{ Params: { eventId: string } }>(
    '/api/v1/events/:eventId',
    async (request, reply) => {
      const event = await eventRepo.findById(request.params.eventId);
      if (!event) {
        reply.code(404).send({ error: 'Event not found' });
        return;
      }

      const [eventTags, participants, things] = await Promise.all([
        tagRepo.listEventTags(event.id),
        personRepo.listParticipants(event.id),
        eventThingRepo
          .listAll()
          .then((all) => all.filter((thing) => thing.eventId === event.id && !thing.isDeleted)),
      ]);

      return { event, eventTags, participants, things };
    }
  );

  server.post<{ Body: CreateEventBody }>('/api/v1/events', async (request, reply) => {
    const body = request.body;
    if (!body?.event || typeof body.event.title !== 'string' || typeof body.event.startAt !== 'string') {
      reply.code(400).send({ error: 'event.title and event.startAt are required' });
      return;
    }

    const dayId = body.event.dayId ?? `day-${getLocalDateString(new Date(body.event.startAt), 'UTC')}`;
    const now = new Date();
    const timestamp = now.toISOString();
    const event: Event = {
      id: body.event.id ?? `event-${randomUUID()}`,
      dayId,
      title: body.event.title,
      startAt: body.event.startAt,
      endAt: body.event.endAt,
      startPrecision: body.event.startPrecision ?? 'exact',
      endPrecision: body.event.endPrecision ?? 'exact',
      source: body.event.source ?? 'backfill',
      notes: body.event.notes,
      createdAt: body.event.createdAt ?? timestamp,
      updatedAt: body.event.updatedAt ?? timestamp,
      isDeleted: body.event.isDeleted ?? false,
    };

    const existingTags = await tagRepo.listTree();
    const existingPeople = await personRepo.listAll();
    const resolvedTags = resolveTagsForEvent(event.id, body.tagPaths ?? [], existingTags, { now });
    const resolvedPeople = resolvePeopleForEvent(event.id, body.peopleNames ?? [], existingPeople, {
      now,
    });

    db.exec('BEGIN IMMEDIATE');
    try {
      event.dayId = await ensureDay(event.dayId, event.startAt);
      await eventRepo.save(event);

      for (const tag of resolvedTags.tags) {
        await tagRepo.save(tag);
      }
      await tagRepo.assignTagsToEvent(event.id, resolvedTags.eventTags);

      for (const person of resolvedPeople.people) {
        await personRepo.save(person);
      }
      for (const participant of resolvedPeople.participants) {
        await personRepo.linkParticipant(participant);
      }

      if (body.capture) {
        await persistCapture(body.capture);
      }

      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      reply.code(500).send({ error: `Failed to save event: ${String(err)}` });
      return;
    }

    return {
      event,
      tags: resolvedTags.tags,
      eventTags: resolvedTags.eventTags,
      people: resolvedPeople.people,
      participants: resolvedPeople.participants,
      capture: body.capture ?? null,
    };
  });

  // ---------------------------------------------------------------------------
  // Event read, edit, delete, restore
  // ---------------------------------------------------------------------------

  server.patch<{ Params: { eventId: string }; Body: PatchEventInput }>(
    '/api/v1/events/:eventId',
    async (request, reply) => {
      const event = await eventRepo.findById(request.params.eventId);
      if (!event) {
        reply.code(404).send({ error: 'Event not found' });
        return;
      }

      const now = new Date();
      const result = applyEventPatch(event, request.body ?? {}, now);
      if (result.errors.length > 0) {
        reply.code(400).send({ error: result.errors[0].message });
        return;
      }

      // Resolve tags and people if provided
      const existingTags = await tagRepo.listTree();
      const existingPeople = await personRepo.listAll();

      db.exec('BEGIN IMMEDIATE');
      try {
        const updated = await eventRepo.patch(request.params.eventId, result.event);

        if (request.body?.tagPaths !== undefined) {
          const resolvedTags = resolveTagsForEvent(
            updated.id,
            request.body.tagPaths,
            existingTags,
            { now }
          );
          for (const tag of resolvedTags.tags) {
            await tagRepo.save(tag);
          }
          await tagRepo.assignTagsToEvent(updated.id, resolvedTags.eventTags);
        }

        if (request.body?.peopleNames !== undefined) {
          const resolvedPeople = resolvePeopleForEvent(
            updated.id,
            request.body.peopleNames,
            existingPeople,
            { now }
          );
          for (const person of resolvedPeople.people) {
            await personRepo.save(person);
          }
          // Remove existing participants and re-add
          const existingParticipants = await personRepo.listParticipants(
            updated.id
          );
          for (const p of existingParticipants) {
            await personRepo.unlinkParticipant(updated.id, p.personId);
          }
          for (const participant of resolvedPeople.participants) {
            await personRepo.linkParticipant(participant);
          }
        }

        // Reassign day if startAt changed
        if (request.body?.startAt !== undefined) {
          const days = await dayRepo.listAll();
          const day = days.find((d) => d.id === updated.dayId);
          const { dayId } = reassignDay(updated, days, day?.timezone ?? 'UTC');
          if (dayId !== updated.dayId) {
            await eventRepo.patch(updated.id, { dayId });
          }
        }

        db.exec('COMMIT');

        const [eventTags, participants] = await Promise.all([
          tagRepo.listEventTags(updated.id),
          personRepo.listParticipants(updated.id),
        ]);

        return {
          event: updated,
          eventTags,
          participants,
        };
      } catch (err) {
        db.exec('ROLLBACK');
        reply.code(500).send({ error: `Failed to update event: ${String(err)}` });
        return;
      }
    }
  );

  server.delete<{ Params: { eventId: string } }>(
    '/api/v1/events/:eventId',
    async (request, reply) => {
      const event = await eventRepo.findById(request.params.eventId);
      if (!event) {
        reply.code(404).send({ error: 'Event not found' });
        return;
      }

      await eventRepo.softDelete(request.params.eventId);

      // Undo semantics for one-tap templates: a point event (no endAt) owns a
      // Day time that the log set from the event's startAt. Soft deleting such
      // an event undoes that and restores the Day time to its previous value.
      if (!event.endAt) {
        const day = await dayRepo.findById(event.dayId);
        if (day) {
          const updates: { wakeAt?: string; sleepAt?: string } = {};
          if (day.wakeAt === event.startAt) updates.wakeAt = undefined;
          if (day.sleepAt === event.startAt) updates.sleepAt = undefined;
          if (Object.keys(updates).length > 0) {
            await dayRepo.save({
              ...day,
              ...updates,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      return { id: request.params.eventId, isDeleted: true };
    }
  );

  server.post<{ Params: { eventId: string } }>(
    '/api/v1/events/:eventId/restore',
    async (request, reply) => {
      const event = await eventRepo.findById(request.params.eventId);
      if (!event) {
        reply.code(404).send({ error: 'Event not found' });
        return;
      }

      await eventRepo.restore(request.params.eventId);

      // Restoring a point event (no endAt) brings the Day time it owned back.
      if (!event.endAt) {
        const day = await dayRepo.findById(event.dayId);
        if (day) {
          const updates: { wakeAt?: string; sleepAt?: string } = {};
          if (day.wakeAt === undefined) updates.wakeAt = event.startAt;
          if (day.sleepAt === undefined) updates.sleepAt = event.startAt;
          if (Object.keys(updates).length > 0) {
            await dayRepo.save({
              ...day,
              ...updates,
              updatedAt: new Date().toISOString(),
            });
          }
        }
      }

      return { id: request.params.eventId, isDeleted: false };
    }
  );

  // ---------------------------------------------------------------------------
  // Tag management
  // ---------------------------------------------------------------------------

  server.post<{ Body: CreateTagBody }>('/api/v1/tags', async (request, reply) => {
    const body = request.body;
    if (!body?.name || typeof body.name !== 'string') {
      reply.code(400).send({ error: 'tag name is required' });
      return;
    }

    const normalizedName = body.name.trim();
    if (!normalizedName) {
      reply.code(400).send({ error: 'tag name cannot be empty' });
      return;
    }

    const now = new Date();
    const timestamp = now.toISOString();

    const parentId = body.parentId ?? undefined;
    const tag: Tag = {
      id: `tag-${normalizedName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')}`,
      name: normalizedName,
      path: normalizedName,
      color: body.color ?? undefined,
      parentId,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    };

    try {
      await tagRepo.create(tag);
    } catch (err) {
      reply.code(409).send({ error: `Tag already exists: ${String(err)}` });
      return;
    }

    return tag;
  });

  server.patch<{ Params: { tagId: string }; Body: PatchTagBody }>(
    '/api/v1/tags/:tagId',
    async (request, reply) => {
      const tag = await tagRepo.findById(request.params.tagId);
      if (!tag) {
        reply.code(404).send({ error: 'Tag not found' });
        return;
      }

      try {
        const updated = await tagRepo.patch(request.params.tagId, request.body ?? {});
        return updated;
      } catch (err) {
        reply.code(400).send({ error: String(err) });
        return;
      }
    }
  );

  server.post<{ Params: { tagId: string } }>(
    '/api/v1/tags/:tagId/archive',
    async (request, reply) => {
      const tag = await tagRepo.findById(request.params.tagId);
      if (!tag) {
        reply.code(404).send({ error: 'Tag not found' });
        return;
      }

      await tagRepo.archive(request.params.tagId);
      return { id: request.params.tagId, archived: true };
    }
  );

  server.post<{ Params: { tagId: string } }>(
    '/api/v1/tags/:tagId/unarchive',
    async (request, reply) => {
      const tag = await tagRepo.findById(request.params.tagId);
      if (!tag) {
        reply.code(404).send({ error: 'Tag not found' });
        return;
      }

      await tagRepo.unarchive(request.params.tagId);
      return { id: request.params.tagId, archived: false };
    }
  );

  server.delete<{ Params: { tagId: string } }>(
    '/api/v1/tags/:tagId',
    async (request, reply) => {
      const tag = await tagRepo.findById(request.params.tagId);
      if (!tag) {
        reply.code(404).send({ error: 'Tag not found' });
        return;
      }

      try {
        await tagRepo.delete(request.params.tagId);
      } catch (err) {
        reply.code(409).send({ error: String(err) });
        return;
      }

      return { id: request.params.tagId, deleted: true };
    }
  );

  // ---------------------------------------------------------------------------
  // People management
  // ---------------------------------------------------------------------------

  server.post<{ Body: CreatePersonBody }>('/api/v1/people', async (request, reply) => {
    const body = request.body;
    if (!body?.displayName || typeof body.displayName !== 'string') {
      reply.code(400).send({ error: 'displayName is required' });
      return;
    }

    const now = new Date();
    const timestamp = now.toISOString();

    const person: Person = {
      id: `person-${body.displayName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')}`,
      displayName: body.displayName.trim(),
      aliases: body.aliases ?? [],
      notes: body.notes ?? undefined,
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    };

    try {
      await personRepo.create(person);
    } catch (err) {
      reply.code(409).send({ error: `Person already exists: ${String(err)}` });
      return;
    }

    if (body.aliases && body.aliases.length > 0) {
      for (const alias of body.aliases) {
        await personAliasRepo.save({
          id: `alias-${person.id}-${alias.replace(/[^a-z0-9]+/g, '-')}`,
          personId: person.id,
          alias,
          createdAt: timestamp,
          updatedAt: timestamp,
          isDeleted: false,
        });
      }
    }

    return person;
  });

  server.patch<{ Params: { personId: string }; Body: PatchPersonBody }>(
    '/api/v1/people/:personId',
    async (request, reply) => {
      const person = await personRepo.findById(request.params.personId);
      if (!person) {
        reply.code(404).send({ error: 'Person not found' });
        return;
      }

      try {
        const updated = await personRepo.patch(request.params.personId, {
          displayName: request.body?.displayName,
          notes: request.body?.notes,
        });
        return updated;
      } catch (err) {
        reply.code(400).send({ error: String(err) });
        return;
      }
    }
  );

  server.put<{ Params: { personId: string }; Body: PutPersonAliasesBody }>(
    '/api/v1/people/:personId/aliases',
    async (request, reply) => {
      const person = await personRepo.findById(request.params.personId);
      if (!person) {
        reply.code(404).send({ error: 'Person not found' });
        return;
      }

      const aliases = request.body?.aliases ?? [];
      await personAliasRepo.deleteForPerson(request.params.personId);
      for (const alias of aliases) {
        try {
          await personAliasRepo.save({
            id: `alias-${request.params.personId}-${alias.replace(/[^a-z0-9]+/g, '-')}`,
            personId: request.params.personId,
            alias,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            isDeleted: false,
          });
        } catch (err) {
          reply.code(409).send({ error: String(err) });
          return;
        }
      }

      return { aliases };
    }
  );

  server.post<{ Params: { personId: string } }>(
    '/api/v1/people/:personId/archive',
    async (request, reply) => {
      const person = await personRepo.findById(request.params.personId);
      if (!person) {
        reply.code(404).send({ error: 'Person not found' });
        return;
      }

      await personRepo.archive(request.params.personId);
      return { id: request.params.personId, archived: true };
    }
  );

  server.post<{ Params: { personId: string } }>(
    '/api/v1/people/:personId/unarchive',
    async (request, reply) => {
      const person = await personRepo.findById(request.params.personId);
      if (!person) {
        reply.code(404).send({ error: 'Person not found' });
        return;
      }

      await personRepo.unarchive(request.params.personId);
      return { id: request.params.personId, archived: false };
    }
  );

  server.delete<{ Params: { personId: string } }>(
    '/api/v1/people/:personId',
    async (request, reply) => {
      const person = await personRepo.findById(request.params.personId);
      if (!person) {
        reply.code(404).send({ error: 'Person not found' });
        return;
      }

      try {
        await personRepo.delete(request.params.personId);
      } catch (err) {
        reply.code(409).send({ error: String(err) });
        return;
      }

      return { id: request.params.personId, deleted: true };
    }
  );

  // ---------------------------------------------------------------------------
  // Template management
  // ---------------------------------------------------------------------------

  server.get('/api/v1/templates', async () => {
    return templateRepo.listAll();
  });

  server.post<{ Body: CreateTemplateBody }>('/api/v1/templates', async (request, reply) => {
    const body = request.body;
    if (!body?.name || !body?.title) {
      reply.code(400).send({ error: 'name and title are required' });
      return;
    }

    const now = new Date();

    const template: Template = buildTemplate(
      {
        name: body.name,
        title: body.title,
        defaultDurationMinutes: body.defaultDurationMinutes,
        tagIds: body.tagIds ?? [],
        special: body.special,
        isPinned: body.isPinned ?? false,
        sortOrder: body.sortOrder ?? 0,
      },
      { now }
    );

    try {
      await templateRepo.create(template);
    } catch (err) {
      reply.code(409).send({ error: `Template already exists: ${String(err)}` });
      return;
    }

    if (body.tagIds && body.tagIds.length > 0) {
      const primaryTagId = body.tagIds[0];
      for (let i = 0; i < body.tagIds.length; i++) {
        await templateTagRepo.save({
          templateId: template.id,
          tagId: body.tagIds[i],
          isPrimary: i === 0 && primaryTagId === body.tagIds[i],
        });
      }
    }

    return template;
  });

  server.patch<{ Params: { templateId: string }; Body: PatchTemplateBody }>(
    '/api/v1/templates/:templateId',
    async (request, reply) => {
      const template = await templateRepo.findById(request.params.templateId);
      if (!template) {
        reply.code(404).send({ error: 'Template not found' });
        return;
      }

      try {
        const updated = await templateRepo.patch(request.params.templateId, {
          name: request.body?.name,
          title: request.body?.title,
          defaultDurationMinutes: request.body?.defaultDurationMinutes ?? undefined,
          special: request.body?.special ?? undefined,
          isPinned: request.body?.isPinned,
          sortOrder: request.body?.sortOrder,
        });

        if (request.body?.tagIds !== undefined) {
          await templateTagRepo.deleteForTemplate(request.params.templateId);
          for (let i = 0; i < request.body.tagIds.length; i++) {
            await templateTagRepo.save({
              templateId: request.params.templateId,
              tagId: request.body.tagIds[i],
              isPrimary: i === 0,
            });
          }
        }

        return updated;
      } catch (err) {
        reply.code(400).send({ error: String(err) });
        return;
      }
    }
  );

  server.delete<{ Params: { templateId: string } }>(
    '/api/v1/templates/:templateId',
    async (request, reply) => {
      const template = await templateRepo.findById(request.params.templateId);
      if (!template) {
        reply.code(404).send({ error: 'Template not found' });
        return;
      }

      await templateRepo.softDelete(request.params.templateId);
      return { id: request.params.templateId, isDeleted: true };
    }
  );

  server.post<{ Params: { templateId: string }; Body: LogTemplateBody }>(
    '/api/v1/templates/:templateId/log',
    async (request, reply) => {
      const template = await templateRepo.findById(request.params.templateId);
      if (!template) {
        reply.code(404).send({ error: 'Template not found' });
        return;
      }

      const now = new Date();
      const startAt = request.body?.startAt ?? now.toISOString();

      try {
        const draft = templateToEventDraft(template, startAt);

        const existingTags = await tagRepo.listTree();
        const resolvedTags = resolveTagsForEvent(
          `event-${Date.now()}`,
          (template.tagIds ?? []).map((t) => {
            const tag = existingTags.find((tag) => tag.id === t);
            return tag ? tag.path : '';
          }).filter(Boolean),
          existingTags,
          { now }
        );

        const eventId = `event-${Date.now()}`;
        const dayId = `day-${getLocalDateString(new Date(startAt), 'UTC')}`;

        const event: Event = {
          id: eventId,
          dayId,
          title: draft.event.title,
          startAt: draft.event.startAt,
          endAt: draft.event.endAt,
          startPrecision: 'exact',
          endPrecision: draft.event.endAt ? 'exact' : 'unknown',
          source: 'live',
          notes: undefined,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
        };

        db.exec('BEGIN IMMEDIATE');
        try {
          const resolvedDayId = await ensureDay(dayId, event.startAt);
          event.dayId = resolvedDayId;
          await eventRepo.save(event);

          for (const tag of resolvedTags.tags) {
            await tagRepo.save(tag);
          }
          await tagRepo.assignTagsToEvent(event.id, resolvedTags.eventTags);

          const dayRecord = await dayRepo.findById(resolvedDayId);

          // If special template, set day wake/sleep (replaces existing)
          let previousWakeAt: string | undefined;
          let previousSleepAt: string | undefined;
          if (draft.setWakeOrSleep === 'wake' || draft.setWakeOrSleep === 'sleep') {
            if (dayRecord) {
              previousWakeAt = dayRecord.wakeAt;
              previousSleepAt = dayRecord.sleepAt;
              await dayRepo.save({
                ...dayRecord,
                ...(draft.setWakeOrSleep === 'wake' ? { wakeAt: startAt } : {}),
                ...(draft.setWakeOrSleep === 'sleep' ? { sleepAt: startAt } : {}),
                updatedAt: new Date().toISOString(),
              });
            }
          }

          db.exec('COMMIT');
          return {
            event,
            day: dayRecord ?? null,
            tags: resolvedTags.tags,
            eventTags: resolvedTags.eventTags,
            dayId: resolvedDayId,
            previousWakeAt,
            previousSleepAt,
          };
        } catch (err) {
          db.exec('ROLLBACK');
          reply.code(500).send({ error: `Failed to log template: ${String(err)}` });
          return;
        }
      } catch (err) {
        reply.code(400).send({ error: String(err) });
        return;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Things: typed dynamic fields (type definitions and event things)
  // ---------------------------------------------------------------------------

  server.get('/api/v1/type-definitions', async () => {
    return typeDefinitionRepo.listAll();
  });

  server.post<{ Body: CreateTypeDefinitionBody }>('/api/v1/type-definitions', async (request, reply) => {
    const body = request.body;
    if (!body?.name || !body?.fieldType) {
      reply.code(400).send({ error: 'name and fieldType are required' });
      return;
    }

    const existing = await typeDefinitionRepo.findByName(body.name);
    if (existing) {
      reply.code(409).send({ error: `Type definition already exists: ${body.name}` });
      return;
    }

    const now = new Date().toISOString();
    const typeDefinition: TypeDefinition = {
      id: `type-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      name: body.name,
      fieldType: body.fieldType,
      schema: body.schema,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    };

    try {
      await typeDefinitionRepo.save(typeDefinition);
    } catch (err) {
      reply.code(500).send({ error: String(err) });
      return;
    }

    return typeDefinition;
  });

  server.patch<{ Params: { id: string }; Body: PatchTypeDefinitionBody }>(
    '/api/v1/type-definitions/:id',
    async (request, reply) => {
      const existing = await typeDefinitionRepo.findById(request.params.id);
      if (!existing) {
        reply.code(404).send({ error: 'TypeDefinition not found' });
        return;
      }

      try {
        const patch: Partial<TypeDefinition> = {
          ...(request.body?.name !== undefined ? { name: request.body.name } : {}),
          ...(request.body?.fieldType !== undefined ? { fieldType: request.body.fieldType } : {}),
        };
        if (request.body?.schema !== undefined) {
          patch.schema = request.body.schema ?? undefined;
        }
        const updated = await typeDefinitionRepo.patch(request.params.id, patch);
        return updated;
      } catch (err) {
        reply.code(400).send({ error: String(err) });
        return;
      }
    }
  );

  server.delete<{ Params: { id: string } }>(
    '/api/v1/type-definitions/:id',
    async (request, reply) => {
      const existing = await typeDefinitionRepo.findById(request.params.id);
      if (!existing) {
        reply.code(404).send({ error: 'TypeDefinition not found' });
        return;
      }

      await typeDefinitionRepo.softDelete(request.params.id);
      return { id: request.params.id, isDeleted: true };
    }
  );

  server.post<{ Params: { eventId: string }; Body: AttachEventThingBody }>(
    '/api/v1/events/:eventId/things',
    async (request, reply) => {
      const event = await eventRepo.findById(request.params.eventId);
      if (!event) {
        reply.code(404).send({ error: 'Event not found' });
        return;
      }

      const typeDefinition = await typeDefinitionRepo.findById(request.body?.typeDefinitionId);
      if (!typeDefinition) {
        reply.code(400).send({ error: `TypeDefinition not found: ${request.body?.typeDefinitionId}` });
        return;
      }

      const now = new Date().toISOString();
      const existing = await eventThingRepo.findByEventAndType(
        request.params.eventId,
        typeDefinition.id
      );
      const thing: EventThing = {
        id: existing?.id ?? `thing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        eventId: request.params.eventId,
        typeDefinitionId: typeDefinition.id,
        value: request.body?.value ?? {},
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
        isDeleted: false,
      };

      await eventThingRepo.save(thing);
      return thing;
    }
  );

  server.delete<{ Params: { eventId: string; typeDefinitionId: string } }>(
    '/api/v1/events/:eventId/things/:typeDefinitionId',
    async (request, reply) => {
      const existing = await eventThingRepo.findByEventAndType(
        request.params.eventId,
        request.params.typeDefinitionId
      );
      if (!existing) {
        reply.code(404).send({ error: 'Event thing not found' });
        return;
      }

      await eventThingRepo.softDelete(existing.id);
      return { id: existing.id, eventId: request.params.eventId, isDeleted: true };
    }
  );

  server.get('/api/v1/tags', async () => {
    return tagRepo.listTree();
  });

  server.get('/api/v1/people', async () => {
    return personRepo.listAll();
  });

  server.get<{ Querystring: { includeDeleted?: string } }>(
    '/api/v1/captures',
    async (request) => {
      return captureRepo.listAll(request.query.includeDeleted === 'true');
    }
  );

  server.post<{ Body: Capture }>('/api/v1/captures', async (request, reply) => {
    const body = request.body;
    if (!body || typeof body.rawText !== 'string' || typeof body.capturedAt !== 'string') {
      reply.code(400).send({ error: 'rawText and capturedAt are required' });
      return;
    }

    const now = new Date().toISOString();
    const capture: Capture = {
      id: body.id ?? `capture-${randomUUID()}`,
      rawText: body.rawText,
      capturedAt: body.capturedAt,
      parsedBy: body.parsedBy ?? 'rule-parser-v0',
      createdAt: body.createdAt ?? now,
      updatedAt: body.updatedAt ?? now,
      isDeleted: body.isDeleted ?? false,
    };
    await persistCapture(capture);
    return capture;
  });

  // ---------------------------------------------------------------------------
  // Suggestion inbox
  // ---------------------------------------------------------------------------

  server.get<{ Querystring: { status?: string; includeDeleted?: string } }>(
    '/api/v1/suggestions',
    async (request, reply) => {
      const includeDeleted = request.query.includeDeleted === 'true';
      const status = request.query.status;

      if (status) {
        if (status !== 'pending' && status !== 'accepted' && status !== 'rejected') {
          reply.code(400).send({ error: `Invalid suggestion status: ${status}` });
          return;
        }
        return suggestionRepo.listByStatus(status as SuggestionStatus, includeDeleted);
      }

      return suggestionRepo.listAll(includeDeleted);
    }
  );

  server.get<{ Params: { suggestionId: string } }>(
    '/api/v1/suggestions/:suggestionId',
    async (request, reply) => {
      const suggestion = await suggestionRepo.findById(request.params.suggestionId);
      if (!suggestion || suggestion.isDeleted) {
        reply.code(404).send({ error: 'Suggestion not found' });
        return;
      }
      return suggestion;
    }
  );

  server.patch<{ Params: { suggestionId: string }; Body: EditSuggestionBody }>(
    '/api/v1/suggestions/:suggestionId',
    async (request, reply) => {
      const suggestion = await suggestionRepo.findById(request.params.suggestionId);
      if (!suggestion || suggestion.isDeleted) {
        reply.code(404).send({ error: 'Suggestion not found' });
        return;
      }

      try {
        const now = resolveUpdateTime(new Date(), suggestion.updatedAt);
        const edited = editSuggestion(suggestion, request.body ?? {}, now);
        await suggestionRepo.save(edited);
        return edited;
      } catch (err) {
        reply.code(400).send({ error: String(err) });
        return;
      }
    }
  );

  server.post<{ Params: { suggestionId: string }; Body: AcceptSuggestionBody }>(
    '/api/v1/suggestions/:suggestionId/accept',
    async (request, reply) => {
      const suggestion = await suggestionRepo.findById(request.params.suggestionId);
      if (!suggestion || suggestion.isDeleted) {
        reply.code(404).send({ error: 'Suggestion not found' });
        return;
      }
      if (suggestion.status !== 'pending') {
        reply.code(409).send({ error: `Suggestion is already ${suggestion.status}` });
        return;
      }

      const body = request.body ?? {};
      const requestedNow = body.now ? new Date(body.now) : new Date();
      if (Number.isNaN(requestedNow.getTime())) {
        reply.code(400).send({ error: `Invalid now: ${body.now}` });
        return;
      }
      const now = resolveUpdateTime(requestedNow, suggestion.updatedAt);

      const eventId = body.eventId ?? `event-${randomUUID()}`;
      const finalStartAt = body.overrides?.startAt ?? suggestion.proposed.startAt;
      let dayId =
        body.dayId ??
        suggestion.proposed.dayId ??
        `day-${getLocalDateString(new Date(finalStartAt), 'UTC')}`;

      let accepted: Suggestion;
      try {
        const result = acceptSuggestion(suggestion, body.overrides, {
          eventId,
          dayId,
          now,
          source: 'imported',
        });
        accepted = result.suggestion;
      } catch (err) {
        reply.code(400).send({ error: String(err) });
        return;
      }

      const event = buildEventFromSuggestion(accepted.proposed, {
        eventId,
        dayId,
        now,
        source: 'imported',
      });

      const existingTags = await tagRepo.listTree();
      const existingPeople = await personRepo.listAll();
      const resolvedTags = resolveTagsForEvent(
        event.id,
        accepted.proposed.tagPaths ?? [],
        existingTags,
        { now }
      );
      const resolvedPeople = resolvePeopleForEvent(
        event.id,
        accepted.proposed.peopleNames ?? [],
        existingPeople,
        { now }
      );

      db.exec('BEGIN IMMEDIATE');
      try {
        dayId = await ensureDay(dayId, event.startAt);
        event.dayId = dayId;

        await eventRepo.save(event);
        for (const tag of resolvedTags.tags) {
          await tagRepo.save(tag);
        }
        await tagRepo.assignTagsToEvent(event.id, resolvedTags.eventTags);
        for (const person of resolvedPeople.people) {
          await personRepo.save(person);
        }
        for (const participant of resolvedPeople.participants) {
          await personRepo.linkParticipant(participant);
        }

        await suggestionRepo.save(accepted);

        if (accepted.source === 'calendar' && accepted.externalId) {
          const item: CalendarItem = {
            eventId: event.id,
            externalId: accepted.externalId,
            attendees: [],
            importedAt: now.toISOString(),
          };
          await calendarItemRepo.save(item);
        }

        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        reply.code(500).send({ error: `Failed to accept suggestion: ${String(err)}` });
        return;
      }

      return {
        suggestion: accepted,
        event,
        tags: resolvedTags.tags,
        eventTags: resolvedTags.eventTags,
        people: resolvedPeople.people,
        participants: resolvedPeople.participants,
      };
    }
  );

  server.post<{ Params: { suggestionId: string }; Body: { now?: string } }>(
    '/api/v1/suggestions/:suggestionId/reject',
    async (request, reply) => {
      const suggestion = await suggestionRepo.findById(request.params.suggestionId);
      if (!suggestion || suggestion.isDeleted) {
        reply.code(404).send({ error: 'Suggestion not found' });
        return;
      }

      const body = request.body ?? {};
      const requestedNow = body.now ? new Date(body.now) : new Date();
      if (Number.isNaN(requestedNow.getTime())) {
        reply.code(400).send({ error: `Invalid now: ${body.now}` });
        return;
      }
      const now = resolveUpdateTime(requestedNow, suggestion.updatedAt);

      try {
        const rejected = rejectSuggestion(suggestion, now);
        await suggestionRepo.save(rejected);
        return rejected;
      } catch (err) {
        reply.code(409).send({ error: String(err) });
        return;
      }
    }
  );

  // ---------------------------------------------------------------------------
  // Extensions
  // ---------------------------------------------------------------------------

  server.get('/api/v1/extensions', async () => {
    return extensionRegistry.list();
  });

  server.post<{ Body: CalendarImportBody }>(
    '/api/v1/extensions/calendar/import',
    async (request, reply) => {
      const body = request.body;
      if (!body || typeof body.ics !== 'string') {
        reply.code(400).send({ error: 'ics is required' });
        return;
      }

      const parsed = parseIcsCalendar(body.ics);
      const candidates = calendarEventsToSuggestions(parsed.events);
      const created: Suggestion[] = [];
      const duplicates: Array<{ externalId: string; suggestionId: string; status: string }> = [];

      for (const candidate of candidates) {
        if (!candidate.externalId) {
          created.push(candidate);
          await suggestionRepo.save(candidate);
          continue;
        }

        const existing = await suggestionRepo.findByExternalId('calendar', candidate.externalId);
        if (existing) {
          duplicates.push({
            externalId: candidate.externalId,
            suggestionId: existing.id,
            status: existing.status,
          });
          continue;
        }

        await suggestionRepo.save(candidate);
        created.push(candidate);
      }

      return {
        extension: CALENDAR_EXTENSION,
        importedCount: created.length,
        duplicateCount: duplicates.length,
        suggestions: created,
        duplicates,
        skipped: parsed.skipped,
      };
    }
  );

  // ---------------------------------------------------------------------------
  // Static web app
  // ---------------------------------------------------------------------------

  const webDir = options.webDir;
  if (webDir && existsSync(webDir)) {
    server.register(fastifyStatic, {
      root: webDir,
      prefix: '/',
      setHeaders: (res, filePath) => {
        const relative = path.relative(webDir, filePath);
        if (relative === 'index.html') {
          res.setHeader('Cache-Control', 'no-cache');
        } else if (relative.startsWith(`assets${path.sep}`)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    });

    server.setNotFoundHandler(async (request, reply) => {
      const urlPath = request.url.split('?')[0];
      const isSpaRoute =
        request.method === 'GET' &&
        !urlPath.startsWith('/api/') &&
        urlPath !== '/health' &&
        path.extname(urlPath) === '';

      if (isSpaRoute) {
        return reply.type('text/html').sendFile('index.html');
      }

      return reply.code(404).send({ error: 'Not Found' });
    });
  }

  return server;
}

function toRecord<T>(
  entityType: SyncRecordPayload['entityType'],
  entityId: string,
  data: T,
  updatedAtOverride?: string
): SyncRecordPayload<T> {
  const entity = data as T & { updatedAt?: string; isDeleted?: boolean };
  return {
    entityType,
    entityId,
    data,
    updatedAt: updatedAtOverride ?? entity.updatedAt ?? '',
    isDeleted: entity.isDeleted ?? false,
  };
}
