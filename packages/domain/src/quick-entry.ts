import {
  CaptureSource,
  Event,
  ISODateTimeString,
  Precision,
  UUID,
} from './types.js';
import { normalizeTagPath } from './tags.js';
import { normalizePersonName } from './people.js';

export const QUICK_ENTRY_PARSER_VERSION = 'rule-parser-v0';

export interface ParsedQuickEntry {
  rawText: string;
  title: string;
  startAt: ISODateTimeString;
  endAt?: ISODateTimeString;
  startPrecision: Precision;
  endPrecision: Precision;
  tagPaths: string[];
  primaryTagPath?: string;
  peopleNames: string[];
  durationMinutes?: number;
  parsedBy: typeof QUICK_ENTRY_PARSER_VERSION;
  /** Whether a time token was explicitly present in the input. */
  hasExplicitTime: boolean;
}

interface ParsedTime {
  hours: number;
  minutes: number;
}

const TIME_ATOM = String.raw`(?:\d{1,2}(?::\d{2})?\s*(?:am|pm)?|noon|midnight)`;
const TIME_ATOM_MARKED = String.raw`(?:\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|noon|midnight)`;

function tagRegex(): RegExp {
  return /#([\p{L}\p{N}][\p{L}\p{N}_/-]*)/gu;
}

function mentionRegex(): RegExp {
  return /@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu;
}

function rangeRegex(): RegExp {
  const withConnector = String.raw`(?:\bfrom\s+|\bat\s+)?(${TIME_ATOM})\s*(?:to|until|till)\s*(${TIME_ATOM})\b`;
  const withDash = String.raw`(${TIME_ATOM_MARKED})\s*[-–—]\s*(${TIME_ATOM_MARKED})\b`;
  return new RegExp(`${withConnector}|${withDash}`, 'i');
}

function durationRegex(): RegExp {
  return /\bfor\s+(\d+(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)(?:\s*\d+\s*(?:minutes?|mins?|m))?)/i;
}

function pointTimeRegex(): RegExp {
  return /\b(?:at\s+)?(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|noon|midnight)\b|\bat\s+(\d{1,2})(?![:.\d])\b/i;
}

function parseTime(raw: string): ParsedTime | null {
  const value = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!value) return null;
  if (value === 'noon') return { hours: 12, minutes: 0 };
  if (value === 'midnight') return { hours: 0, minutes: 0 };

  const match = /^(\d{1,2})(?::(\d{2}))?(am|pm)?$/.exec(value);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3];

  if (!Number.isInteger(hours) || minutes < 0 || minutes > 59) return null;

  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    if (meridiem === 'pm' && hours < 12) hours += 12;
    if (meridiem === 'am' && hours === 12) hours = 0;
  } else if (hours > 23) {
    return null;
  }

  return { hours, minutes };
}

function parseDurationMinutes(raw: string): number | null {
  const value = raw.toLowerCase().replace(/\s+/g, '');
  const hourMatch = /(\d+(?:\.\d+)?)h(?:ours?|rs?)?/.exec(value);
  const minuteMatch = /(\d+)m(?:in(?:ute)?s?)?/.exec(value);

  let minutes = 0;
  let matched = false;
  if (hourMatch) {
    minutes += Number(hourMatch[1]) * 60;
    matched = true;
  }
  if (minuteMatch) {
    minutes += Number(minuteMatch[1]);
    matched = true;
  }

  if (!matched) {
    // A lone unit such as "90 min" is captured without the h prefix.
    const loneMinutes = /^(\d+)m(?:in(?:ute)?s?)?$/.exec(value);
    if (loneMinutes) return Number(loneMinutes[1]);
    return null;
  }

  return Math.round(minutes);
}

function atLocalTime(now: Date, time: ParsedTime, dayOffset: number = 0): Date {
  const result = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + dayOffset,
    time.hours,
    time.minutes,
    0,
    0
  );
  return result;
}

function cleanTitle(input: string, fallback: string): string {
  const cleaned = input
    .replace(/\s+/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/^[\s,;:–—-]+/, '')
    .replace(/[\s,;:–—-]+$/, '')
    .trim();

  return cleaned.length > 0 ? cleaned : fallback;
}

/**
 * Deterministic rule-based quick-entry parser. Never throws, never invents a
 * time or title, and leaves unrecognised text in the title untouched.
 */
export function parseQuickEntry(rawText: string, now: Date = new Date()): ParsedQuickEntry {
  const raw = typeof rawText === 'string' ? rawText : '';
  let working = raw;
  const tagPaths: string[] = [];
  const peopleNames: string[] = [];

  working = working.replace(tagRegex(), (_match, path: string) => {
    const normalized = normalizeTagPath(path);
    if (normalized && !tagPaths.includes(normalized)) tagPaths.push(normalized);
    return ' ';
  });

  working = working.replace(mentionRegex(), (_match, name: string) => {
    const cleaned = name.replace(/[.,;:!?]+$/, '');
    const normalized = normalizePersonName(cleaned);
    if (normalized && !peopleNames.some((existing) => normalizePersonName(existing) === normalized)) {
      peopleNames.push(cleaned);
    }
    return ' ';
  });

  let durationMinutes: number | undefined;
  const durationMatch = durationRegex().exec(working);
  if (durationMatch) {
    const parsedDuration = parseDurationMinutes(durationMatch[1]);
    if (parsedDuration !== null && parsedDuration > 0) {
      durationMinutes = parsedDuration;
    }
    working = working.replace(durationMatch[0], ' ');
  }

  let startAt: Date | null = null;
  let endAt: Date | null = null;
  let hasExplicitTime = false;

  const rangeMatch = rangeRegex().exec(working);
  if (rangeMatch) {
    const startRaw = rangeMatch[1] ?? rangeMatch[3];
    const endRaw = rangeMatch[2] ?? rangeMatch[4];
    const startTime = startRaw ? parseTime(startRaw) : null;
    const endTime = endRaw ? parseTime(endRaw) : null;

    if (startTime && endTime) {
      startAt = atLocalTime(now, startTime);
      endAt = atLocalTime(now, endTime);
      if (endAt.getTime() <= startAt.getTime()) {
        endAt = atLocalTime(now, endTime, 1);
      }
      hasExplicitTime = true;
      working = working.replace(rangeMatch[0], ' ');
    }
  }

  if (!startAt) {
    const pointMatch = pointTimeRegex().exec(working);
    if (pointMatch) {
      const timeRaw = pointMatch[1] ?? pointMatch[2];
      const parsedTime = timeRaw ? parseTime(timeRaw) : null;
      if (parsedTime) {
        startAt = atLocalTime(now, parsedTime);
        hasExplicitTime = true;
        working = working.replace(pointMatch[0], ' ');
      }
    }
  }

  const finalStart = startAt ?? new Date(now.getTime());
  let finalEnd = endAt;
  if (!finalEnd && durationMinutes !== undefined) {
    finalEnd = new Date(finalStart.getTime() + durationMinutes * 60_000);
  }

  return {
    rawText: raw,
    title: cleanTitle(working, raw.trim()),
    startAt: finalStart.toISOString(),
    endAt: finalEnd?.toISOString(),
    startPrecision: 'exact',
    endPrecision: 'exact',
    tagPaths,
    primaryTagPath: tagPaths[0],
    peopleNames,
    durationMinutes,
    parsedBy: QUICK_ENTRY_PARSER_VERSION,
    hasExplicitTime,
  };
}

export interface BuildEventFromQuickEntryOptions {
  id: UUID;
  dayId: UUID;
  source?: CaptureSource;
  notes?: string;
  now?: Date;
}

export function buildEventFromQuickEntry(
  parsed: ParsedQuickEntry,
  options: BuildEventFromQuickEntryOptions
): Event {
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();

  return {
    id: options.id,
    dayId: options.dayId,
    title: parsed.title,
    startAt: parsed.startAt,
    endAt: parsed.endAt,
    startPrecision: parsed.startPrecision,
    endPrecision: parsed.endPrecision,
    source: options.source ?? 'live',
    notes: options.notes,
    createdAt: timestamp,
    updatedAt: timestamp,
    isDeleted: false,
  };
}
