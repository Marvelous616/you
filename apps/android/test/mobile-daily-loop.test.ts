import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Day,
  buildEventFromQuickEntry,
  getLocalDateString,
  parseQuickEntry,
  resolvePeopleForEvent,
  resolveTagsForEvent,
} from '@life-logger/domain';
import { outboxItemsToPushRequest } from '@life-logger/sync';
import { InMemoryMobileStorage } from '../src/local-store.js';
import { MobileSyncClient } from '../src/sync-client.js';

function dayFor(now: Date): Day {
  const localDate = getLocalDateString(now);
  return {
    id: `day-${localDate}`,
    localDate,
    wakeAt: now.toISOString(),
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    reviewStatus: 'in_progress',
    fidelity: 'skipped',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    isDeleted: false,
  };
}

describe('Android Daily Loop capture', () => {
  let storage: InMemoryMobileStorage;

  beforeEach(() => {
    storage = new InMemoryMobileStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves a parsed quick entry and queues every dependency within 50ms', async () => {
    const now = new Date();
    const day = dayFor(now);
    const parsed = parseQuickEntry('lunch with @rahul at 1pm #food/lunch', now);
    const event = buildEventFromQuickEntry(parsed, {
      id: `event-${now.getTime()}`,
      dayId: day.id,
      source: 'live',
      now,
    });

    const tags = resolveTagsForEvent(event.id, parsed.tagPaths, [], { now });
    const people = resolvePeopleForEvent(event.id, parsed.peopleNames, [], { now });
    const capture = {
      id: `capture-${now.getTime()}`,
      rawText: parsed.rawText,
      capturedAt: parsed.startAt,
      parsedBy: parsed.parsedBy,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      isDeleted: false,
    };

    const { saveDurationMs } = await storage.saveQuickEntryAndEnqueueOutbox({
      event,
      capture,
      tags: tags.tags,
      eventTags: tags.eventTags,
      people: people.people,
      participants: people.participants,
    });

    expect(saveDurationMs).toBeLessThan(50);
    expect(await storage.getEventsForDay(day.id)).toHaveLength(1);
    expect((await storage.getTags()).map((tag) => tag.path)).toEqual(['food', 'food/lunch']);
    expect((await storage.getPeople()).map((person) => person.displayName)).toEqual(['rahul']);

    const pending = await storage.getPendingOutboxItems();
    expect(pending.map((item) => item.entityType)).toEqual([
      'tag',
      'tag',
      'person',
      'event',
      'event_tag',
      'event_participant',
      'capture',
    ]);

    const request = outboxItemsToPushRequest('phone', 'batch-1', pending);
    expect(request.records).toHaveLength(7);
  });

  it('stores day lifecycle changes and journal entries offline', async () => {
    const now = new Date();
    const day = dayFor(now);
    await storage.saveDayAndEnqueueOutbox(day);

    const entry = {
      id: `journal-${now.getTime()}`,
      dayId: day.id,
      body: 'Reflection from the phone',
      writtenAt: now.toISOString(),
      source: 'live' as const,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      isDeleted: false,
    };
    await storage.saveJournalAndEnqueueOutbox(entry);

    expect((await storage.getDay(day.id))?.wakeAt).toBe(day.wakeAt);
    expect(await storage.getJournalEntries(day.id)).toHaveLength(1);
    expect((await storage.getPendingOutboxItems()).map((item) => item.entityType)).toEqual([
      'day',
      'journal_entry',
    ]);
  });

  it('pushes the daily loop batch without dropping rejected records', async () => {
    const now = new Date();
    const day = dayFor(now);
    await storage.saveDayAndEnqueueOutbox(day);

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          acceptedCount: 0,
          rejected: [{ entityId: day.id, reason: 'boom' }],
          serverTimestamp: now.toISOString(),
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = new MobileSyncClient(storage, {
      serverUrl: 'http://localhost:4000',
      clientId: 'phone',
    });

    const result = await client.syncNow();
    expect(result.error).toContain('rejected');
    expect(await storage.getPendingCount()).toBe(1);
  });
});
