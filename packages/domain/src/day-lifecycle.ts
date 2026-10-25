import {
  Day,
  DayFidelity,
  Event,
  ISODateTimeString,
  JournalEntry,
} from './types.js';
import { calculateUnionDuration } from './timeline.js';

export interface DayLifecycleOptions {
  now?: Date;
}

function cloneWith(day: Day, patch: Partial<Day>, now: Date): Day {
  return {
    ...day,
    ...patch,
    updatedAt: now.toISOString(),
  };
}

/**
 * Records the start of a logical day. Re-waking an already-open day is
 * idempotent and keeps the existing wake time.
 */
export function wakeDay(
  day: Day,
  wakeAt: ISODateTimeString,
  options: DayLifecycleOptions = {}
): Day {
  const now = options.now ?? new Date();
  if (day.wakeAt) return day;
  return cloneWith(day, { wakeAt, updatedAt: now.toISOString() }, now);
}

/**
 * Records the end of a logical day (sleep). This does not mark the day's
 * evening review complete; see completeDayReview().
 */
export function sleepDay(
  day: Day,
  sleepAt: ISODateTimeString,
  options: DayLifecycleOptions = {}
): Day {
  const now = options.now ?? new Date();
  return cloneWith(day, { sleepAt }, now);
}

export function beginDayReview(day: Day, options: DayLifecycleOptions = {}): Day {
  const now = options.now ?? new Date();
  return cloneWith(day, { reviewStatus: 'in_progress' }, now);
}

export function skipDayReview(day: Day, options: DayLifecycleOptions = {}): Day {
  const now = options.now ?? new Date();
  return cloneWith(day, { reviewStatus: 'skipped' }, now);
}

export interface CompleteDayReviewOptions extends DayLifecycleOptions {
  sleepAt?: ISODateTimeString;
}

/**
 * Closes the daily loop: stores sleep when supplied, derives fidelity and
 * marks the review complete. Fidelity is always derived, never asked for.
 */
export function completeDayReview(
  day: Day,
  events: Event[],
  journalEntries: JournalEntry[],
  options: CompleteDayReviewOptions = {}
): Day {
  const now = options.now ?? new Date();
  const sleepAt = options.sleepAt ?? day.sleepAt;
  const withSleep = sleepAt ? { ...day, sleepAt } : day;
  const fidelity = calculateDayFidelity(withSleep, events, journalEntries, now);

  return cloneWith(
    withSleep,
    { reviewStatus: 'completed', fidelity },
    now
  );
}

/**
 * Determines Day.fidelity from timeline coverage plus journal presence:
 * - detailed: >= 75% waking coverage AND a non-empty journal entry
 * - summary:  >= 30% waking coverage OR a non-empty journal entry
 * - skipped:  neither
 */
export function calculateDayFidelity(
  day: Day,
  events: Event[],
  journalEntries: JournalEntry[],
  currentTime: Date = new Date()
): DayFidelity {
  if (!day.wakeAt) return 'skipped';

  const wakeMs = new Date(day.wakeAt).getTime();
  if (!Number.isFinite(wakeMs)) return 'skipped';

  const endMs = day.sleepAt ? new Date(day.sleepAt).getTime() : currentTime.getTime();
  if (!Number.isFinite(endMs) || endMs <= wakeMs) return 'skipped';

  const wakingDurationMs = endMs - wakeMs;
  const coveredMs = calculateUnionDuration(events, wakeMs, endMs);
  const coverageRatio = coveredMs / wakingDurationMs;
  const hasJournal =
    journalEntries.length > 0 && journalEntries.some((entry) => entry.body.trim().length > 0);

  if (coverageRatio >= 0.75 && hasJournal) return 'detailed';
  if (coverageRatio >= 0.3 || hasJournal) return 'summary';
  return 'skipped';
}

/**
 * Returns coverage as a 0..1 ratio for display in the review UI.
 */
export function calculateDayCoverage(
  day: Day,
  events: Event[],
  currentTime: Date = new Date()
): number {
  if (!day.wakeAt) return 0;

  const wakeMs = new Date(day.wakeAt).getTime();
  const endMs = day.sleepAt ? new Date(day.sleepAt).getTime() : currentTime.getTime();
  if (!Number.isFinite(wakeMs) || !Number.isFinite(endMs) || endMs <= wakeMs) return 0;

  return Math.min(1, calculateUnionDuration(events, wakeMs, endMs) / (endMs - wakeMs));
}
