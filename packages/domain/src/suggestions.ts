import {
  CaptureSource,
  Event,
  ISODateTimeString,
  ProposedEvent,
  Suggestion,
  SuggestionSource,
  SuggestionStatus,
  UUID,
} from './types.js';

export interface SuggestionDraft {
  source: SuggestionSource;
  confidence?: number;
  proposed: ProposedEvent;
  externalId?: string;
}

export interface SuggestionOverrides {
  title?: string;
  startAt?: ISODateTimeString;
  endAt?: ISODateTimeString | null;
  tagPaths?: string[];
  peopleNames?: string[];
  notes?: string;
}

export interface SuggestionBuildOptions {
  id: UUID;
  now?: Date;
}

export interface AcceptSuggestionOptions {
  eventId: UUID;
  dayId: UUID;
  now?: Date;
  source?: CaptureSource;
}

function clampConfidence(value: number | undefined): number {
  if (value === undefined || Number.isNaN(value)) return 1;
  return Math.max(0, Math.min(1, value));
}

function assertPending(suggestion: Suggestion): void {
  if (suggestion.status !== 'pending') {
    throw new Error(`Suggestion ${suggestion.id} is already ${suggestion.status}`);
  }
}

function applyOverrides(proposed: ProposedEvent, overrides?: SuggestionOverrides): ProposedEvent {
  if (!overrides) return { ...proposed };

  const next: ProposedEvent = { ...proposed };
  if (overrides.title !== undefined) {
    const title = overrides.title.trim();
    if (!title) throw new Error('Suggestion title cannot be empty');
    next.title = title;
  }
  if (overrides.startAt !== undefined) {
    if (Number.isNaN(new Date(overrides.startAt).getTime())) {
      throw new Error(`Invalid suggestion start time: ${overrides.startAt}`);
    }
    next.startAt = overrides.startAt;
  }
  if (overrides.endAt !== undefined) {
    if (overrides.endAt === null) {
      next.endAt = undefined;
    } else {
      if (Number.isNaN(new Date(overrides.endAt).getTime())) {
        throw new Error(`Invalid suggestion end time: ${overrides.endAt}`);
      }
      next.endAt = overrides.endAt;
    }
  }
  if (overrides.tagPaths !== undefined) {
    next.tagPaths = [...overrides.tagPaths];
  }
  if (overrides.peopleNames !== undefined) {
    next.peopleNames = [...overrides.peopleNames];
  }
  if (overrides.notes !== undefined) {
    next.notes = overrides.notes;
  }

  if (next.endAt && new Date(next.endAt).getTime() <= new Date(next.startAt).getTime()) {
    throw new Error('Suggestion end time must be after start time');
  }

  return next;
}

/** Builds a pending suggestion with deterministic timestamps and validation. */
export function buildSuggestion(
  draft: SuggestionDraft,
  options: SuggestionBuildOptions
): Suggestion {
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();

  if (!draft.proposed.title.trim()) {
    throw new Error('Suggestion title cannot be empty');
  }
  if (Number.isNaN(new Date(draft.proposed.startAt).getTime())) {
    throw new Error(`Invalid suggestion start time: ${draft.proposed.startAt}`);
  }
  if (
    draft.proposed.endAt &&
    new Date(draft.proposed.endAt).getTime() <= new Date(draft.proposed.startAt).getTime()
  ) {
    throw new Error('Suggestion end time must be after start time');
  }

  return {
    id: options.id,
    source: draft.source,
    confidence: clampConfidence(draft.confidence),
    proposed: { ...draft.proposed },
    status: 'pending',
    externalId: draft.externalId,
    createdAt: timestamp,
    updatedAt: timestamp,
    isDeleted: false,
  };
}

/** Applies user edits to a pending suggestion without accepting it. */
export function editSuggestion(
  suggestion: Suggestion,
  overrides: SuggestionOverrides,
  now: Date = new Date()
): Suggestion {
  assertPending(suggestion);
  return {
    ...suggestion,
    proposed: applyOverrides(suggestion.proposed, overrides),
    updatedAt: now.toISOString(),
  };
}

/**
 * Marks a suggestion accepted and returns the final proposed event to persist.
 * Event creation is kept outside the domain so the caller controls ids and
 * parent-day resolution.
 */
export function acceptSuggestion(
  suggestion: Suggestion,
  overrides: SuggestionOverrides | undefined,
  options: AcceptSuggestionOptions
): { suggestion: Suggestion; proposed: ProposedEvent } {
  assertPending(suggestion);
  const now = options.now ?? new Date();
  const proposed = applyOverrides(suggestion.proposed, overrides);

  return {
    suggestion: {
      ...suggestion,
      proposed,
      status: 'accepted',
      acceptedEventId: options.eventId,
      reviewedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    },
    proposed,
  };
}

export function rejectSuggestion(suggestion: Suggestion, now: Date = new Date()): Suggestion {
  assertPending(suggestion);
  return {
    ...suggestion,
    status: 'rejected',
    reviewedAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
}

/** Builds the Event produced by an accepted suggestion. */
export function buildEventFromSuggestion(
  proposed: ProposedEvent,
  options: AcceptSuggestionOptions
): Event {
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();

  return {
    id: options.eventId,
    dayId: options.dayId,
    title: proposed.title,
    startAt: proposed.startAt,
    endAt: proposed.endAt,
    startPrecision: proposed.startPrecision,
    endPrecision: proposed.endPrecision,
    source: options.source ?? 'imported',
    notes: proposed.notes,
    createdAt: timestamp,
    updatedAt: timestamp,
    isDeleted: false,
  };
}

export function isSuggestionPending(suggestion: Suggestion): boolean {
  return suggestion.status === 'pending' && !suggestion.isDeleted;
}

export function suggestionStatusLabel(status: SuggestionStatus): string {
  switch (status) {
    case 'pending':
      return 'Pending';
    case 'accepted':
      return 'Accepted';
    case 'rejected':
      return 'Rejected';
  }
}
