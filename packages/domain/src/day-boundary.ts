import { ISODateTimeString, LocalDateString } from './types.js';

export interface DayWindow {
  localDate: LocalDateString;
  wakeAt?: ISODateTimeString;
  sleepAt?: ISODateTimeString;
}

/**
 * Returns a YYYY-MM-DD string for a given date in a specific IANA timezone.
 */
export function getLocalDateString(date: Date, timezone: string = 'UTC'): LocalDateString {
  // Use Intl.DateTimeFormat with en-CA which outputs YYYY-MM-DD format
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Resolves which logical Day a given timestamp belongs to.
 * Follows the wake-to-sleep boundary paradigm:
 * If an active day is currently ongoing (wakeAt <= timestamp and sleepAt is either not set or timestamp <= sleepAt),
 * then even if the timestamp is past local midnight (e.g., 01:30 AM), it belongs to that ongoing logical Day.
 */
export function resolveLogicalDay(
  timestamp: Date | ISODateTimeString,
  timezone: string = 'UTC',
  activeDay?: DayWindow
): LocalDateString {
  const dateObj = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;

  if (activeDay?.wakeAt) {
    const wakeTime = new Date(activeDay.wakeAt).getTime();
    const eventTime = dateObj.getTime();

    if (eventTime >= wakeTime) {
      if (!activeDay.sleepAt) {
        // Still awake, belongs to active day
        return activeDay.localDate;
      }
      const sleepTime = new Date(activeDay.sleepAt).getTime();
      if (eventTime <= sleepTime) {
        return activeDay.localDate;
      }
    }
  }

  // Fallback to local calendar date in the specified timezone
  return getLocalDateString(dateObj, timezone);
}
