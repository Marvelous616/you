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
