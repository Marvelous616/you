import { Suggestion } from './types.js';
import { buildSuggestion } from './suggestions.js';

export interface CalendarEvent {
  externalId: string;
  title: string;
  startAt: string;
  endAt?: string;
  allDay: boolean;
  timezone?: string;
  description?: string;
  location?: string;
  organizer?: string;
  attendees: string[];
  recurrenceRule?: string;
}

export interface CalendarParseSkip {
  title?: string;
  reason: string;
}

export interface CalendarParseResult {
  events: CalendarEvent[];
  skipped: CalendarParseSkip[];
}

export interface CalendarSuggestionOptions {
  now?: Date;
  confidence?: number;
}

interface IcsProperty {
  name: string;
  params: Record<string, string>;
  value: string;
}

interface IcsDate {
  date: Date;
  allDay: boolean;
}

function unescapeIcsText(value: string): string {
  return value.replace(/\\([nN,;\\])/g, (_match, token: string) => {
    if (token === 'n' || token === 'N') return '\n';
    return token;
  });
}

function findValueSeparator(line: string): number {
  let quoted = false;
  for (let index = 0; index < line.length; index++) {
    const char = line[index];
    if (char === '"') quoted = !quoted;
    if (char === ':' && !quoted) return index;
  }
  return -1;
}

function parseProperty(line: string): IcsProperty | null {
  const separator = findValueSeparator(line);
  if (separator <= 0) return null;

  const left = line.slice(0, separator);
  const value = line.slice(separator + 1);
  const [namePart, ...rawParams] = left.split(';');
  const params: Record<string, string> = {};

  for (const rawParam of rawParams) {
    const equals = rawParam.indexOf('=');
    if (equals <= 0) continue;
    const key = rawParam.slice(0, equals).toUpperCase();
    params[key] = rawParam.slice(equals + 1).replace(/^"|"$/g, '');
  }

  return { name: namePart.toUpperCase(), params, value };
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const values: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') values[part.type] = part.value;
  }

  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second)
  );
  return asUtc - date.getTime();
}

function zonedTimeToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
  seconds: number,
  timeZone: string
): Date {
  const guess = Date.UTC(year, month - 1, day, hours, minutes, seconds);
  let offset = getTimeZoneOffsetMs(new Date(guess), timeZone);
  let result = guess - offset;
  offset = getTimeZoneOffsetMs(new Date(result), timeZone);
  result = guess - offset;
  return new Date(result);
}

function parseIcsDate(raw: string, params: Record<string, string>): IcsDate | null {
  const value = raw.trim();
  const dateOnly = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (dateOnly) {
    const year = Number(dateOnly[1]);
    const month = Number(dateOnly[2]);
    const day = Number(dateOnly[3]);
    return { date: new Date(Date.UTC(year, month - 1, day)), allDay: true };
  }

  const dateTime = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(value);
  if (!dateTime) return null;

  const year = Number(dateTime[1]);
  const month = Number(dateTime[2]);
  const day = Number(dateTime[3]);
  const hours = Number(dateTime[4]);
  const minutes = Number(dateTime[5]);
  const seconds = Number(dateTime[6]);
  const isUtc = Boolean(dateTime[7]);

  if (isUtc || !params.TZID) {
    return {
      date: new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)),
      allDay: false,
    };
  }

  try {
    return {
      date: zonedTimeToUtc(year, month, day, hours, minutes, seconds, params.TZID),
      allDay: false,
    };
  } catch {
    // Unknown timezone: keep the wall-clock time deterministically as UTC.
    return {
      date: new Date(Date.UTC(year, month - 1, day, hours, minutes, seconds)),
      allDay: false,
    };
  }
}

function parseDurationMs(raw: string): number | null {
  const match = /^P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    raw.trim().toUpperCase()
  );
  if (!match) return null;

  const weeks = Number(match[1] ?? 0);
  const days = Number(match[2] ?? 0);
  const hours = Number(match[3] ?? 0);
  const minutes = Number(match[4] ?? 0);
  const seconds = Number(match[5] ?? 0);
  const total =
    ((weeks * 7 + days) * 24 * 60 * 60 + hours * 60 * 60 + minutes * 60 + seconds) * 1000;

  return total > 0 ? total : null;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function calendarSuggestionId(externalId: string): string {
  return `suggestion-calendar-${stableHash(externalId)}`;
}

function attendeeLabel(property: IcsProperty): string {
  if (property.params.CN) return property.params.CN;
  return property.value.replace(/^mailto:/i, '').trim();
}

function parseEvent(lines: string[]): CalendarEvent | null {
  const properties: IcsProperty[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const upper = trimmed.toUpperCase();
    if (upper.startsWith('BEGIN:VALARM') || upper.startsWith('BEGIN:VTIMEZONE')) continue;
    if (upper.startsWith('END:VALARM') || upper.startsWith('END:VTIMEZONE')) continue;

    const property = parseProperty(line);
    if (property) properties.push(property);
  }

  const find = (name: string): IcsProperty | undefined =>
    properties.find((property) => property.name === name);

  const startProperty = find('DTSTART');
  if (!startProperty) return null;
  const start = parseIcsDate(startProperty.value, startProperty.params);
  if (!start) return null;

  const title = unescapeIcsText(find('SUMMARY')?.value ?? '').trim() || '(untitled event)';
  const description = find('DESCRIPTION')?.value;
  const location = find('LOCATION')?.value;
  const organizerProperty = find('ORGANIZER');
  const organizer = organizerProperty
    ? attendeeLabel(organizerProperty)
    : undefined;
  const attendees = properties
    .filter((property) => property.name === 'ATTENDEE')
    .map(attendeeLabel)
    .filter((value) => value.length > 0);

  let endAt: Date | undefined;
  const endProperty = find('DTEND');
  if (endProperty) {
    const end = parseIcsDate(endProperty.value, endProperty.params);
    endAt = end?.date;
  } else {
    const durationProperty = find('DURATION');
    if (durationProperty) {
      const durationMs = parseDurationMs(durationProperty.value);
      if (durationMs !== null) endAt = new Date(start.date.getTime() + durationMs);
    }
  }

  if (!endAt && start.allDay) {
    endAt = new Date(start.date.getTime() + 24 * 60 * 60 * 1000 - 1);
  }
  if (endAt && endAt.getTime() <= start.date.getTime()) {
    endAt = undefined;
  }

  const uid = find('UID')?.value.trim();
  const externalId =
    uid && uid.length > 0
      ? uid
      : `${start.date.toISOString()}|${title}|${attendees.join(',')}`;

  return {
    externalId,
    title,
    startAt: start.date.toISOString(),
    endAt: endAt?.toISOString(),
    allDay: start.allDay,
    timezone: startProperty.params.TZID,
    description: description ? unescapeIcsText(description) : undefined,
    location: location ? unescapeIcsText(location) : undefined,
    organizer,
    attendees,
    recurrenceRule: find('RRULE')?.value,
  };
}

/**
 * Parses an ICS calendar into events. Never throws: malformed VEVENT blocks are
 * reported in `skipped` and valid blocks continue to be imported. Recurring
 * events import their first occurrence and retain the RRULE for later expansion.
 */
export function parseIcsCalendar(text: string): CalendarParseResult {
  const result: CalendarParseResult = { events: [], skipped: [] };
  if (typeof text !== 'string' || text.trim().length === 0) return result;

  const unfolded = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n[ \t]/g, '');

  const lines = unfolded.split('\n');
  let current: string[] | null = null;
  let inAlarm = false;

  for (const line of lines) {
    const trimmed = line.trim();
    const upper = trimmed.toUpperCase();

    if (current === null) {
      if (upper === 'BEGIN:VEVENT') current = [];
      continue;
    }

    if (upper === 'END:VEVENT') {
      try {
        const event = parseEvent(current);
        if (event) result.events.push(event);
        else result.skipped.push({ reason: 'VEVENT has no valid DTSTART' });
      } catch (error) {
        result.skipped.push({
          reason: error instanceof Error ? error.message : String(error),
        });
      }
      current = null;
      inAlarm = false;
      continue;
    }

    if (upper === 'BEGIN:VALARM') {
      inAlarm = true;
      continue;
    }
    if (upper === 'END:VALARM') {
      inAlarm = false;
      continue;
    }
    if (!inAlarm) current.push(line);
  }

  return result;
}

function composeNotes(event: CalendarEvent): string | undefined {
  const parts: string[] = [];
  if (event.location) parts.push(`Location: ${event.location}`);
  if (event.organizer) parts.push(`Organizer: ${event.organizer}`);
  if (event.attendees.length > 0) parts.push(`Attendees: ${event.attendees.join(', ')}`);
  if (event.description) parts.push(event.description);
  if (event.recurrenceRule) parts.push(`Recurrence: ${event.recurrenceRule}`);
  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * Converts parsed calendar events into deterministic pending Suggestions.
 * Calendar times are planned, so precision is `approx` until the user accepts.
 */
export function calendarEventsToSuggestions(
  events: CalendarEvent[],
  options: CalendarSuggestionOptions = {}
): Suggestion[] {
  const now = options.now ?? new Date();
  const confidence = options.confidence ?? 0.9;
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];

  for (const event of events) {
    if (seen.has(event.externalId)) continue;
    seen.add(event.externalId);

    try {
      suggestions.push(
        buildSuggestion(
          {
            source: 'calendar',
            confidence,
            externalId: event.externalId,
            proposed: {
              title: event.title,
              startAt: event.startAt,
              endAt: event.endAt,
              startPrecision: 'approx',
              endPrecision: event.endAt ? 'approx' : 'unknown',
              notes: composeNotes(event),
            },
          },
          { id: calendarSuggestionId(event.externalId), now }
        )
      );
    } catch {
      // A malformed calendar row must never abort the rest of the import.
    }
  }

  return suggestions;
}
