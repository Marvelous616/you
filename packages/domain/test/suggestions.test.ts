import { describe, it, expect } from 'vitest';
import {
  acceptSuggestion,
  buildEventFromSuggestion,
  buildSuggestion,
  editSuggestion,
  isSuggestionPending,
  rejectSuggestion,
} from '../src/suggestions.js';
import { Suggestion } from '../src/types.js';

const NOW = new Date('2026-10-14T09:00:00.000Z');

function draft(overrides: Partial<Parameters<typeof buildSuggestion>[0]> = {}) {
  return {
    source: 'calendar' as const,
    confidence: 0.9,
    externalId: 'uid-1',
    proposed: {
      title: 'Planning',
      startAt: '2026-10-14T10:00:00.000Z',
      endAt: '2026-10-14T11:00:00.000Z',
      startPrecision: 'approx' as const,
      endPrecision: 'approx' as const,
    },
    ...overrides,
  };
}

function suggestion(): Suggestion {
  return buildSuggestion(draft(), { id: 'suggestion-1', now: NOW });
}

describe('buildSuggestion', () => {
  it('creates a pending suggestion with clamped confidence', () => {
    const result = buildSuggestion(draft({ confidence: 1.5 }), { id: 's-1', now: NOW });
    expect(result.status).toBe('pending');
    expect(result.confidence).toBe(1);
    expect(result.createdAt).toBe(NOW.toISOString());
    expect(isSuggestionPending(result)).toBe(true);
  });

  it('rejects an empty title', () => {
    expect(() =>
      buildSuggestion(draft({ proposed: { ...draft().proposed, title: '   ' } }), {
        id: 's-1',
        now: NOW,
      })
    ).toThrow(/title/i);
  });

  it('rejects an end time before the start', () => {
    expect(() =>
      buildSuggestion(
        draft({
          proposed: {
            ...draft().proposed,
            endAt: '2026-10-14T09:00:00.000Z',
          },
        }),
        { id: 's-1', now: NOW }
      )
    ).toThrow(/after start/i);
  });
});

describe('editSuggestion', () => {
  it('updates proposed fields while staying pending', () => {
    const edited = editSuggestion(
      suggestion(),
      {
        title: 'Planning revised',
        startAt: '2026-10-14T10:30:00.000Z',
        endAt: '2026-10-14T12:00:00.000Z',
        tagPaths: ['work/planning'],
      },
      NOW
    );

    expect(edited.status).toBe('pending');
    expect(edited.proposed.title).toBe('Planning revised');
    expect(edited.proposed.tagPaths).toEqual(['work/planning']);
    expect(edited.updatedAt).toBe(NOW.toISOString());
  });

  it('clears an end time with null', () => {
    const edited = editSuggestion(suggestion(), { endAt: null }, NOW);
    expect(edited.proposed.endAt).toBeUndefined();
  });

  it('refuses to edit a reviewed suggestion', () => {
    const rejected = rejectSuggestion(suggestion(), NOW);
    expect(() => editSuggestion(rejected, { title: 'nope' }, NOW)).toThrow(/rejected/i);
  });
});

describe('acceptSuggestion', () => {
  it('marks the suggestion accepted and returns the final proposal', () => {
    const { suggestion: accepted, proposed } = acceptSuggestion(
      suggestion(),
      { title: 'Planning (confirmed)' },
      { eventId: 'event-1', dayId: 'day-2026-10-14', now: NOW }
    );

    expect(accepted.status).toBe('accepted');
    expect(accepted.acceptedEventId).toBe('event-1');
    expect(accepted.reviewedAt).toBe(NOW.toISOString());
    expect(proposed.title).toBe('Planning (confirmed)');

    const event = buildEventFromSuggestion(proposed, {
      eventId: 'event-1',
      dayId: 'day-2026-10-14',
      now: NOW,
    });
    expect(event.source).toBe('imported');
    expect(event.title).toBe('Planning (confirmed)');
    expect(event.startPrecision).toBe('approx');
  });

  it('cannot accept twice', () => {
    const { suggestion: accepted } = acceptSuggestion(suggestion(), undefined, {
      eventId: 'event-1',
      dayId: 'day-2026-10-14',
      now: NOW,
    });

    expect(() =>
      acceptSuggestion(accepted, undefined, {
        eventId: 'event-2',
        dayId: 'day-2026-10-14',
        now: NOW,
      })
    ).toThrow(/accepted/i);
  });

  it('rejects an invalid override time', () => {
    expect(() =>
      acceptSuggestion(suggestion(), { startAt: 'not-a-date' }, {
        eventId: 'event-1',
        dayId: 'day-2026-10-14',
        now: NOW,
      })
    ).toThrow(/Invalid suggestion start time/i);
  });
});

describe('rejectSuggestion', () => {
  it('records the decision without creating an event', () => {
    const rejected = rejectSuggestion(suggestion(), NOW);
    expect(rejected.status).toBe('rejected');
    expect(rejected.acceptedEventId).toBeUndefined();
    expect(rejected.reviewedAt).toBe(NOW.toISOString());
  });
});
