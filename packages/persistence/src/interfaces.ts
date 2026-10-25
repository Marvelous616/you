import {
  Capture,
  Day,
  Event,
  EventParticipant,
  EventTag,
  JournalEntry,
  Marker,
  Person,
  Tag,
  UUID,
} from '@life-logger/domain';

export interface CursorResult<T> {
  records: T[];
  nextCursor: string;
  hasMore: boolean;
}

export interface IMarkerRepository {
  save(marker: Marker): Promise<void>;
  saveBatch(markers: Marker[]): Promise<void>;
  findById(id: UUID): Promise<Marker | null>;
  listByDay(dayId: UUID, includeDeleted?: boolean): Promise<Marker[]>;
  listAll(includeDeleted?: boolean): Promise<Marker[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<Marker>>;
}

export interface IDayRepository {
  save(day: Day): Promise<void>;
  findById(id: UUID): Promise<Day | null>;
  findByLocalDate(date: string): Promise<Day | null>;
  listAll(includeDeleted?: boolean): Promise<Day[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<Day>>;
}

export interface IEventRepository {
  save(event: Event): Promise<void>;
  saveBatch(events: Event[]): Promise<void>;
  findById(id: UUID): Promise<Event | null>;
  listByDay(dayId: UUID, includeDeleted?: boolean): Promise<Event[]>;
  listAll(includeDeleted?: boolean): Promise<Event[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<Event>>;
}

export interface TimestampedEventTag {
  link: EventTag;
  updatedAt: string;
}

export interface ITagRepository {
  save(tag: Tag): Promise<void>;
  saveBatch(tags: Tag[]): Promise<void>;
  findById(id: UUID): Promise<Tag | null>;
  findByPath(path: string): Promise<Tag | null>;
  /** Flat list ordered by path; callers can build the hierarchy. */
  listTree(includeDeleted?: boolean): Promise<Tag[]>;
  assignTagsToEvent(eventId: UUID, tags: EventTag[]): Promise<void>;
  linkEventTag(link: EventTag): Promise<void>;
  removeEventTag(eventId: UUID, tagId: UUID): Promise<void>;
  listEventTags(eventId: UUID): Promise<EventTag[]>;
  listEventTagsForDay(dayId: UUID): Promise<EventTag[]>;
  listAllEventTags(): Promise<EventTag[]>;
  listEventTagsModifiedSince(cursor: string, limit?: number): Promise<CursorResult<TimestampedEventTag>>;
}

export interface TimestampedEventParticipant {
  participant: EventParticipant;
  updatedAt: string;
}

export interface IPersonRepository {
  save(person: Person): Promise<void>;
  saveBatch(people: Person[]): Promise<void>;
  findById(id: UUID): Promise<Person | null>;
  findByNameOrAlias(name: string): Promise<Person | null>;
  listAll(includeDeleted?: boolean): Promise<Person[]>;
  linkParticipant(participant: EventParticipant): Promise<void>;
  unlinkParticipant(eventId: UUID, personId: UUID): Promise<void>;
  listParticipants(eventId: UUID): Promise<EventParticipant[]>;
  listParticipantsForDay(dayId: UUID): Promise<EventParticipant[]>;
  listAllParticipants(): Promise<EventParticipant[]>;
  listParticipantsModifiedSince(
    cursor: string,
    limit?: number
  ): Promise<CursorResult<TimestampedEventParticipant>>;
}

export interface IJournalRepository {
  save(entry: JournalEntry): Promise<void>;
  saveBatch(entries: JournalEntry[]): Promise<void>;
  findById(id: UUID): Promise<JournalEntry | null>;
  listByDay(dayId: UUID, includeDeleted?: boolean): Promise<JournalEntry[]>;
  listAll(includeDeleted?: boolean): Promise<JournalEntry[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<JournalEntry>>;
}

export interface ICaptureRepository {
  save(capture: Capture): Promise<void>;
  findById(id: UUID): Promise<Capture | null>;
  listAll(includeDeleted?: boolean): Promise<Capture[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<Capture>>;
}
