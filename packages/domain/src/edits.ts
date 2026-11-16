import {
  Day,
  Event,
  EventParticipant,
  ISODateTimeString,
  Person,
  Precision,
  Tag,
  UUID,
} from './types.js';
import { getLocalDateString } from './day-boundary.js';

export type EditError = { field: string; message: string };

export interface ApplyEventPatchResult {
  event: Event;
  errors: EditError[];
}

export interface PatchEventInput {
  title?: string;
  startAt?: ISODateTimeString;
  endAt?: ISODateTimeString | null;
  startPrecision?: Precision;
  endPrecision?: Precision | null;
  notes?: string | null;
  tagPaths?: string[];
  peopleNames?: string[];
}

export function applyEventPatch(
  event: Event,
  patch: PatchEventInput,
  now: Date = new Date()
): ApplyEventPatchResult {
  const errors: EditError[] = [];
  const next: Event = { ...event };

  if (patch.title !== undefined) {
    const title = patch.title.trim();
    if (!title) {
      errors.push({ field: 'title', message: 'Event title is required' });
    } else if (title.length > 200) {
      errors.push({ field: 'title', message: 'Event title is at most 200 characters' });
    } else {
      next.title = title;
    }
  }

  if (patch.notes !== undefined) {
    const notes = patch.notes === null ? undefined : patch.notes;
    if (notes !== undefined && notes.length > 5000) {
      errors.push({ field: 'notes', message: 'Event notes are at most 5,000 characters' });
    } else {
      next.notes = notes;
    }
  }

  let startMs: number | undefined;
  if (patch.startAt !== undefined) {
    const parsed = new Date(patch.startAt).getTime();
    if (Number.isNaN(parsed)) {
      errors.push({ field: 'startAt', message: 'Invalid start time' });
    } else {
      startMs = parsed;
      next.startAt = patch.startAt;
      // A hand edit sets start precision to exact only if explicitly chosen.
      if (patch.startPrecision === undefined) {
        next.startPrecision = 'exact';
      } else {
        next.startPrecision = patch.startPrecision;
      }
    }
  } else {
    startMs = new Date(event.startAt).getTime();
  }

  let endMs: number | undefined;
  if (patch.endAt !== null && patch.endAt !== undefined) {
    const parsed = new Date(patch.endAt).getTime();
    if (Number.isNaN(parsed)) {
      errors.push({ field: 'endAt', message: 'Invalid end time' });
    } else {
      endMs = parsed;
      next.endAt = patch.endAt;
      if (patch.endPrecision === undefined) {
        next.endPrecision = 'exact';
      } else if (patch.endPrecision !== null) {
        next.endPrecision = patch.endPrecision;
      }
    }
  } else if (patch.endAt === null) {
    next.endAt = undefined;
    next.endPrecision = 'exact';
  } else {
    endMs = new Date(event.endAt || event.startAt).getTime();
  }

  if (startMs !== undefined && endMs !== undefined && endMs <= startMs) {
    errors.push({ field: 'endAt', message: 'End time must be after start time' });
  }

  next.updatedAt = now.toISOString();

  // Tags and people are handled by the caller via resolveTagsForEvent /
  // resolvePeopleForEvent; this function only validates scalar fields.
  return { event: next, errors };
}

export function reassignDay(
  event: Event,
  days: Day[],
  timezone: string
): { event: Event; dayId: UUID } {
  const startMs = new Date(event.startAt).getTime();
  const localDate = getLocalDateString(new Date(startMs), timezone);
  const existing = days.find((d) => d.localDate === localDate && !d.isDeleted);
  const dayId = existing ? existing.id : `day-${localDate}`;
  return { event: { ...event, dayId, updatedAt: event.updatedAt }, dayId };
}

export interface TagPathChange {
  tagId: UUID;
  oldPath: string;
  newPath: string;
}

export function recomputeTagPaths(
  tags: Tag[],
  changedTagId: UUID
): TagPathChange[] {
  const byId = new Map<UUID, Tag>();
  for (const tag of tags) byId.set(tag.id, tag);

  const changed = byId.get(changedTagId);
  if (!changed) return [];

  const changes: TagPathChange[] = [];
  const affected = new Set<UUID>([changedTagId]);

  // Find all descendants of the changed tag
  const visit = (tagId: UUID): void => {
    const tag = byId.get(tagId);
    if (!tag) return;
    for (const other of tags) {
      if (other.parentId === tagId && !affected.has(other.id)) {
        affected.add(other.id);
        visit(other.id);
      }
    }
  };
  visit(changedTagId);

  for (const tagId of affected) {
    const tag = byId.get(tagId)!;
    const newPath = buildPath(tag, byId);
    if (tag.path !== newPath) {
      changes.push({ tagId, oldPath: tag.path, newPath });
    }
  }

  return changes;
}

function buildPath(tag: Tag, byId: Map<UUID, Tag>): string {
  const segments: string[] = [];
  let current: Tag | undefined = tag;
  while (current) {
    segments.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return segments.join('/');
}

export function wouldCreateCycle(
  tags: Tag[],
  tagId: UUID,
  newParentId: UUID | undefined
): boolean {
  if (!newParentId) return false;
  if (newParentId === tagId) return true;

  const byId = new Map<UUID, Tag>();
  for (const tag of tags) byId.set(tag.id, tag);

  let current: Tag | undefined = byId.get(newParentId);
  while (current) {
    if (current.id === tagId) return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

export interface PersonTokenResult {
  person: Person | null;
  ambiguity: string[] | null;
}

export function resolvePersonToken(
  people: Person[],
  token: string,
  aliases?: Map<UUID, string[]>
): PersonTokenResult {
  const needle = token.trim().replace(/^@+/, '').toLowerCase();
  if (!needle) return { person: null, ambiguity: null };

  const matches = people.filter((person) => {
    if (person.isDeleted) return false;
    if (person.displayName.toLowerCase() === needle) return true;
    const personAliases = aliases?.get(person.id) ?? person.aliases;
    return personAliases.some((alias) => alias.toLowerCase() === needle);
  });

  if (matches.length === 0) return { person: null, ambiguity: null };
  if (matches.length === 1) return { person: matches[0], ambiguity: null };
  return { person: null, ambiguity: matches.map((p) => p.displayName) };
}

export interface CreateParticipantInput {
  eventId: UUID;
  personId: UUID;
  role?: string;
  medium?: 'in_person' | 'call' | 'text' | 'video' | 'online';
  initiatedBy?: 'me' | 'them' | 'mutual';
}

export function createParticipant(input: CreateParticipantInput): EventParticipant {
  return {
    eventId: input.eventId,
    personId: input.personId,
    role: input.role ?? 'with',
    medium: input.medium ?? 'in_person',
    initiatedBy: input.initiatedBy ?? 'mutual',
  };
}
