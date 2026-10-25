import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Suggestion, buildSuggestion, rejectSuggestion } from '@life-logger/domain';
import { InMemoryMobileStorage } from '../src/local-store.js';
import { MobileSyncClient } from '../src/sync-client.js';

const NOW = new Date('2026-10-14T09:00:00.000Z');

function suggestion(id = 'suggestion-phone-1'): Suggestion {
  return buildSuggestion(
    {
      source: 'calendar',
      confidence: 0.9,
      externalId: `uid-${id}`,
      proposed: {
        title: 'Team planning',
        startAt: '2026-10-14T10:00:00.000Z',
        endAt: '2026-10-14T11:00:00.000Z',
        startPrecision: 'approx',
        endPrecision: 'approx',
      },
    },
    { id, now: NOW }
  );
}

describe('Android suggestion inbox offline storage', () => {
  let storage: InMemoryMobileStorage;

  beforeEach(() => {
    storage = new InMemoryMobileStorage();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('saves a suggestion offline within the latency budget and queues it for sync', async () => {
    const { saveDurationMs } = await storage.saveSuggestionAndEnqueueOutbox(suggestion());

    expect(saveDurationMs).toBeLessThan(50);
    expect(await storage.getPendingSuggestions()).toHaveLength(1);

    const pending = await storage.getPendingOutboxItems();
    expect(pending).toHaveLength(1);
    expect(pending[0].entityType).toBe('suggestion');
    expect(pending[0].entityId).toBe('suggestion-phone-1');
  });

  it('removes reviewed suggestions from the pending inbox but keeps them deduplicated', async () => {
    const first = suggestion();
    await storage.saveSuggestionAndEnqueueOutbox(first);

    const rejected = rejectSuggestion(first, NOW);
    await storage.saveSuggestionAndEnqueueOutbox(rejected);

    expect(await storage.getPendingSuggestions()).toHaveLength(0);
    expect(await storage.getSuggestions()).toHaveLength(1);
    expect((await storage.getSuggestions())[0].status).toBe('rejected');
  });

  it('applies newer remote suggestions and ignores stale ones', async () => {
    const local = suggestion();
    await storage.saveSuggestionAndEnqueueOutbox(local);

    const stale = {
      ...local,
      proposed: { ...local.proposed, title: 'Stale' },
      updatedAt: '2026-10-14T08:00:00.000Z',
    };
    const appliedStale = await storage.applyRemoteRecords([
      {
        entityType: 'suggestion',
        entityId: stale.id,
        data: stale,
        updatedAt: '2026-10-14T08:00:00.000Z',
        isDeleted: false,
      },
    ]);
    expect(appliedStale).toBe(0);
    expect((await storage.getSuggestions())[0].proposed.title).toBe('Team planning');

    const newer = rejectSuggestion(local, new Date('2026-10-14T12:00:00.000Z'));
    const appliedNewer = await storage.applyRemoteRecords([
      {
        entityType: 'suggestion',
        entityId: newer.id,
        data: newer,
        updatedAt: newer.updatedAt,
        isDeleted: false,
      },
    ]);
    expect(appliedNewer).toBe(1);
    expect((await storage.getPendingSuggestions())).toHaveLength(0);
  });

  it('pulls suggestions during sync and surfaces them in the inbox', async () => {
    const remote = suggestion('suggestion-remote-1');
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toContain('/api/v1/sync/pull');
      return new Response(
        JSON.stringify({
          records: [
            {
              entityType: 'suggestion',
              entityId: remote.id,
              data: remote,
              updatedAt: remote.updatedAt,
              isDeleted: false,
            },
          ],
          nextCursor: remote.updatedAt,
          hasMore: false,
          serverTimestamp: remote.updatedAt,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    });
    vi.stubGlobal('fetch', fetchMock);

    const client = new MobileSyncClient(storage, {
      serverUrl: 'http://localhost:4000',
      clientId: 'phone',
    });

    const result = await client.syncNow();
    expect(result.error).toBeUndefined();
    expect(result.appliedCount).toBe(1);
    expect((await storage.getPendingSuggestions())[0].id).toBe(remote.id);
  });
});
