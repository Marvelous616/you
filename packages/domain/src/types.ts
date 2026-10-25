export type UUID = string;

/**
 * ISO 8601 string representation with UTC indicator, e.g. "2026-10-14T18:00:00.000Z"
 */
export type ISODateTimeString = string;

/**
 * Calendar date string formatted as "YYYY-MM-DD"
 */
export type LocalDateString = string;

export type Precision = 'exact' | 'approx' | 'unknown';

export type CaptureSource = 'live' | 'backfill' | 'prompted' | 'imported';

export type DayReviewStatus = 'unreviewed' | 'in_progress' | 'completed' | 'skipped';

export type DayFidelity = 'detailed' | 'summary' | 'skipped';

export interface EntityMetadata {
  id: UUID;
  createdAt: ISODateTimeString;
  updatedAt: ISODateTimeString;
  isDeleted: boolean;
}

export interface Day extends EntityMetadata {
  localDate: LocalDateString;
  wakeAt?: ISODateTimeString;
  sleepAt?: ISODateTimeString;
  timezone: string; // e.g. "UTC" or "America/New_York"
  reviewStatus: DayReviewStatus;
  fidelity: DayFidelity;
}

export interface Marker extends EntityMetadata {
  dayId?: UUID;
  markedAt: ISODateTimeString;
  timezoneOffsetMinutes: number;
  note?: string;
  precision: Precision;
  source: CaptureSource;
}

export interface Event extends EntityMetadata {
  dayId: UUID;
  title: string;
  startAt: ISODateTimeString;
  endAt?: ISODateTimeString;
  startPrecision: Precision;
  endPrecision: Precision;
  source: CaptureSource;
  notes?: string;
}

export interface Tag extends EntityMetadata {
  name: string;
  /** Slash-separated hierarchy, e.g. "work/coding" or "food/lunch". */
  path: string;
  color?: string;
  parentId?: UUID;
}

export interface EventTag {
  eventId: UUID;
  tagId: UUID;
  isPrimary: boolean;
}

export type ParticipantMedium = 'in_person' | 'call' | 'text' | 'video' | 'online';
export type ParticipantInitiation = 'me' | 'them' | 'mutual';

export interface Person extends EntityMetadata {
  displayName: string;
  aliases: string[];
  notes?: string;
}

export interface EventParticipant {
  eventId: UUID;
  personId: UUID;
  /** Relationship to the event, e.g. "with". */
  role: string;
  medium: ParticipantMedium;
  initiatedBy: ParticipantInitiation;
}

export interface JournalEntry extends EntityMetadata {
  dayId: UUID;
  body: string;
  writtenAt: ISODateTimeString;
  source: CaptureSource;
}

export interface Capture extends EntityMetadata {
  rawText: string;
  capturedAt: ISODateTimeString;
  /** Identifier of the parser that handled the capture, e.g. "rule-parser-v0". */
  parsedBy: string;
}

/**
 * A machine-proposed event awaiting accept, edit or reject. Automated sources
 * (calendar, call log, GPS, imports) write Suggestions and never Events.
 */
export type SuggestionSource =
  | 'calendar'
  | 'call'
  | 'gps'
  | 'screen_time'
  | 'browser'
  | 'git'
  | 'routine'
  | 'manual';

export type SuggestionStatus = 'pending' | 'accepted' | 'rejected';

export interface ProposedEvent {
  dayId?: UUID;
  title: string;
  startAt: ISODateTimeString;
  endAt?: ISODateTimeString;
  startPrecision: Precision;
  endPrecision: Precision;
  tagPaths?: string[];
  peopleNames?: string[];
  notes?: string;
}

export interface Suggestion extends EntityMetadata {
  source: SuggestionSource;
  /** 0..1 confidence supplied by the proposing extension. */
  confidence: number;
  proposed: ProposedEvent;
  status: SuggestionStatus;
  /** Stable identifier from the source system, used to avoid re-proposing. */
  externalId?: string;
  /** Event created when the suggestion was accepted. */
  acceptedEventId?: UUID;
  reviewedAt?: ISODateTimeString;
}

/**
 * Module-owned calendar metadata, stored by reference to the accepted Event.
 * This table is owned by the Calendar extension and is not part of the core.
 */
export interface CalendarItem {
  eventId: UUID;
  externalId: string;
  calendarName?: string;
  recurrenceRule?: string;
  organizer?: string;
  attendees: string[];
  importedAt: ISODateTimeString;
}

/**
 * Generic state-of-mind / context sample. Dimensions are strings so new
 * dimensions require no schema migration.
 */
export interface ContextObservation extends EntityMetadata {
  dimension: string;
  value: string;
  observedAt: ISODateTimeString;
  subjectType?: 'day' | 'event' | 'person';
  subjectId?: UUID;
}
