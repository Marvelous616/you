import { describe, it, expect } from 'vitest';
import { resolveLWW } from '../src/conflict.js';
import { Marker } from '../src/types.js';

describe('Last-Write-Wins (LWW) conflict resolution', () => {
  const baseMarker: Marker = {
    id: 'marker-1',
    markedAt: '2026-10-14T10:00:00.000Z',
    timezoneOffsetMinutes: 0,
    note: 'Initial note',
    precision: 'exact',
    source: 'live',
    createdAt: '2026-10-14T10:00:00.000Z',
    updatedAt: '2026-10-14T10:00:00.000Z',
    isDeleted: false,
  };

  it('selects the incoming record if its updatedAt is strictly newer', () => {
    const incoming: Marker = {
      ...baseMarker,
      note: 'Updated from phone',
      updatedAt: '2026-10-14T10:05:00.000Z',
    };

    const { winner, isUpdated } = resolveLWW(baseMarker, incoming);
    expect(isUpdated).toBe(true);
    expect(winner.note).toBe('Updated from phone');
  });

  it('preserves the local record if incoming updatedAt is older', () => {
    const incomingStale: Marker = {
      ...baseMarker,
      note: 'Stale offline edit',
      updatedAt: '2026-10-14T09:55:00.000Z',
    };

    const { winner, isUpdated } = resolveLWW(baseMarker, incomingStale);
    expect(isUpdated).toBe(false);
    expect(winner.note).toBe('Initial note');
  });

  it('applies soft deletion when incoming is newer', () => {
    const incomingDeleted: Marker = {
      ...baseMarker,
      isDeleted: true,
      updatedAt: '2026-10-14T10:10:00.000Z',
    };

    const { winner, isUpdated } = resolveLWW(baseMarker, incomingDeleted);
    expect(isUpdated).toBe(true);
    expect(winner.isDeleted).toBe(true);
  });

  it('breaks timestamp ties in favor of deletion for safety', () => {
    const incomingDeletedSameTimestamp: Marker = {
      ...baseMarker,
      isDeleted: true,
      updatedAt: '2026-10-14T10:00:00.000Z',
    };

    const { winner, isUpdated } = resolveLWW(baseMarker, incomingDeletedSameTimestamp);
    expect(isUpdated).toBe(true);
    expect(winner.isDeleted).toBe(true);
  });
});
