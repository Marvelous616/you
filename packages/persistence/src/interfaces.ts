import {
  CalendarItem,
  Capture,
  Day,
  Event,
  EventParticipant,
  EventTag,
  JournalEntry,
  Marker,
  Person,
  PersonAlias,
  Suggestion,
  SuggestionStatus,
  Tag,
  Template,
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
  get(id: UUID): Promise<Event | null>;
  findById(id: UUID): Promise<Event | null>;
  patch(id: UUID, patch: Partial<Event>): Promise<Event>;
  softDelete(id: UUID): Promise<void>;
  restore(id: UUID): Promise<void>;
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
  create(tag: Tag): Promise<Tag>;
  patch(id: UUID, patch: { name?: string; color?: string; parentId?: UUID | null }): Promise<Tag>;
  archive(id: UUID): Promise<void>;
  unarchive(id: UUID): Promise<void>;
  delete(id: UUID): Promise<void>;
  countUsage(id: UUID): Promise<number>;
}

export interface TimestampedEventParticipant {
  participant: EventParticipant;
  updatedAt: string;
}

export interface IPersonRepository {
  save(person: Person): Promise<void>;
  saveBatch(people: Person[]): Promise<void>;
  create(person: Person): Promise<void>;
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
  patch(id: UUID, patch: { displayName?: string; notes?: string | null }): Promise<Person>;
  archive(id: UUID): Promise<void>;
  unarchive(id: UUID): Promise<void>;
  delete(id: UUID): Promise<void>;
  countUsage(id: UUID): Promise<number>;
  addAlias(personId: UUID, alias: string): Promise<void>;
  removeAlias(personId: UUID, alias: string): Promise<void>;
  listAliases(personId: UUID): Promise<string[]>;
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

export interface ITemplateRepository {
  save(template: Template): Promise<void>;
  saveBatch(templates: Template[]): Promise<void>;
  findById(id: UUID): Promise<Template | null>;
  findByName(name: string): Promise<Template | null>;
  listAll(includeDeleted?: boolean): Promise<Template[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<Template>>;
  create(template: Template): Promise<Template>;
  patch(id: UUID, patch: Partial<Template>): Promise<Template>;
  softDelete(id: UUID): Promise<void>;
  restore(id: UUID): Promise<void>;
}

export interface TemplateTagLink {
  templateId: UUID;
  tagId: UUID;
  isPrimary: boolean;
}

export interface ITemplateTagRepository {
  save(link: TemplateTagLink): Promise<void>;
  saveBatch(links: TemplateTagLink[]): Promise<void>;
  deleteForTemplate(templateId: UUID): Promise<void>;
  listByTemplate(templateId: UUID): Promise<TemplateTagLink[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<TimestampedEventTag>>;
}

export interface IPersonAliasRepository {
  save(alias: PersonAlias): Promise<void>;
  saveBatch(aliases: PersonAlias[]): Promise<void>;
  findById(id: UUID): Promise<PersonAlias | null>;
  findByAlias(alias: string): Promise<PersonAlias | null>;
  listByPerson(personId: UUID): Promise<PersonAlias[]>;
  deleteForPerson(personId: UUID): Promise<void>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<PersonAlias>>;
}

export interface ISuggestionRepository {
  save(suggestion: Suggestion): Promise<void>;
  saveBatch(suggestions: Suggestion[]): Promise<void>;
  findById(id: UUID): Promise<Suggestion | null>;
  findByExternalId(source: string, externalId: string): Promise<Suggestion | null>;
  listByStatus(status: SuggestionStatus, includeDeleted?: boolean): Promise<Suggestion[]>;
  listAll(includeDeleted?: boolean): Promise<Suggestion[]>;
  listModifiedSince(cursor: string, limit?: number): Promise<CursorResult<Suggestion>>;
}

export interface ICalendarItemRepository {
  save(item: CalendarItem): Promise<void>;
  findByEventId(eventId: UUID): Promise<CalendarItem | null>;
  findByExternalId(externalId: string): Promise<CalendarItem | null>;
  listAll(): Promise<CalendarItem[]>;
}
