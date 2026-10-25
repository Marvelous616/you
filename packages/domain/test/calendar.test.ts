import { describe, it, expect } from 'vitest';
import {
  calendarEventsToSuggestions,
  calendarSuggestionId,
  parseIcsCalendar,
} from '../src/calendar.js';
import { createDefaultExtensionRegistry, CALENDAR_EXTENSION, ExtensionRegistry } from '../src/extensions.js';

function ics(body: string): string {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', body, 'END:VCALENDAR'].join('\r\n');
}

describe('parseIcsCalendar', () => {
  it('parses a timezone-aware event with attendees and recurrence', () => {
    const result = parseIcsCalendar(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:event-1@example.com',
          'SUMMARY:Team planning',
          'DTSTART;TZID=America/New_York:20261014T100000',
          'DTEND;TZID=America/New_York:20261014T110000',
          'LOCATION:Room 4',
          'DESCRIPTION:Plan the next cycle',
          'ORGANIZER;CN=Alex:mailto:alex@example.com',
          'ATTENDEE;CN=Rahul:mailto:rahul@example.com',
          'RRULE:FREQ=WEEKLY',
          'END:VEVENT',
        ].join('\r\n')
      )
    );

    expect(result.skipped).toEqual([]);
    expect(result.events).toHaveLength(1);
    const event = result.events[0];
    expect(event.title).toBe('Team planning');
    expect(event.startAt).toBe('2026-10-14T14:00:00.000Z');
    expect(event.endAt).toBe('2026-10-14T15:00:00.000Z');
    expect(event.timezone).toBe('America/New_York');
    expect(event.location).toBe('Room 4');
    expect(event.organizer).toBe('Alex');
    expect(event.attendees).toEqual(['Rahul']);
    expect(event.recurrenceRule).toBe('FREQ=WEEKLY');
  });

  it('parses all-day events into a full-day interval', () => {
    const result = parseIcsCalendar(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:holiday',
          'SUMMARY:Public holiday',
          'DTSTART;VALUE=DATE:20261015',
          'END:VEVENT',
        ].join('\n')
      )
    );

    expect(result.events[0].allDay).toBe(true);
    expect(result.events[0].startAt).toBe('2026-10-15T00:00:00.000Z');
    expect(result.events[0].endAt).toBe('2026-10-15T23:59:59.999Z');
  });

  it('computes the end from DURATION', () => {
    const result = parseIcsCalendar(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:focus',
          'SUMMARY:Focus block',
          'DTSTART:20261014T090000Z',
          'DURATION:PT1H30M',
          'END:VEVENT',
        ].join('\n')
      )
    );

    expect(result.events[0].startAt).toBe('2026-10-14T09:00:00.000Z');
    expect(result.events[0].endAt).toBe('2026-10-14T10:30:00.000Z');
  });

  it('unfolds folded lines and unescapes text', () => {
    const result = parseIcsCalendar(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:folded',
          'SUMMARY:Lunch\\, then walk\\nHome',
          'DTSTART:20261014T120000Z',
          'END:VEVENT',
        ].join('\n')
      )
    );

    expect(result.events[0].title).toBe('Lunch, then walk\nHome');
  });

  it('skips malformed events without throwing', () => {
    const result = parseIcsCalendar(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:broken',
          'SUMMARY:No start',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:good',
          'SUMMARY:Good event',
          'DTSTART:20261014T120000Z',
          'END:VEVENT',
        ].join('\n')
      )
    );

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe('Good event');
    expect(result.skipped).toHaveLength(1);
  });

  it('returns an empty result for blank input', () => {
    expect(parseIcsCalendar('')).toEqual({ events: [], skipped: [] });
    expect(parseIcsCalendar('   ')).toEqual({ events: [], skipped: [] });
  });
});

describe('calendarEventsToSuggestions', () => {
  it('produces deterministic pending suggestions with approx precision', () => {
    const parsed = parseIcsCalendar(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:planning',
          'SUMMARY:Planning',
          'DTSTART:20261014T120000Z',
          'DTEND:20261014T130000Z',
          'END:VEVENT',
        ].join('\n')
      )
    );

    const suggestions = calendarEventsToSuggestions(parsed.events, {
      now: new Date('2026-10-14T09:00:00.000Z'),
    });

    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].id).toBe(calendarSuggestionId('planning'));
    expect(suggestions[0].source).toBe('calendar');
    expect(suggestions[0].status).toBe('pending');
    expect(suggestions[0].proposed.startPrecision).toBe('approx');
    expect(suggestions[0].externalId).toBe('planning');
  });

  it('deduplicates repeated external ids within one import', () => {
    const parsed = parseIcsCalendar(
      ics(
        [
          'BEGIN:VEVENT',
          'UID:same',
          'SUMMARY:First',
          'DTSTART:20261014T120000Z',
          'END:VEVENT',
          'BEGIN:VEVENT',
          'UID:same',
          'SUMMARY:Second',
          'DTSTART:20261015T120000Z',
          'END:VEVENT',
        ].join('\n')
      )
    );

    const suggestions = calendarEventsToSuggestions(parsed.events);
    expect(suggestions).toHaveLength(1);
    expect(suggestions[0].proposed.title).toBe('First');
  });
});

describe('ExtensionRegistry', () => {
  it('registers the calendar extension by default', () => {
    const registry = createDefaultExtensionRegistry();
    expect(registry.get('calendar')).toEqual(CALENDAR_EXTENSION);
    expect(registry.list().map((entry) => entry.id)).toEqual(['calendar']);
  });

  it('rejects duplicate registrations and invalid ids', () => {
    const registry = new ExtensionRegistry();
    registry.register(CALENDAR_EXTENSION);
    expect(() => registry.register(CALENDAR_EXTENSION)).toThrow(/already registered/i);
    expect(() =>
      registry.register({ ...CALENDAR_EXTENSION, id: 'Not Valid' })
    ).toThrow(/Invalid extension id/i);
  });
});
