import { CalendarItem, UUID } from '@life-logger/domain';
import { ICalendarItemRepository } from '../interfaces.js';
import { DatabaseSync } from './db.js';

interface CalendarItemRow {
  event_id: string;
  external_id: string;
  calendar_name: string | null;
  recurrence_rule: string | null;
  organizer: string | null;
  attendees_json: string;
  imported_at: string;
}

function rowToItem(row: CalendarItemRow): CalendarItem {
  let attendees: string[] = [];
  try {
    const parsed = JSON.parse(row.attendees_json) as unknown;
    if (Array.isArray(parsed)) attendees = parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    attendees = [];
  }

  return {
    eventId: row.event_id,
    externalId: row.external_id,
    calendarName: row.calendar_name ?? undefined,
    recurrenceRule: row.recurrence_rule ?? undefined,
    organizer: row.organizer ?? undefined,
    attendees,
    importedAt: row.imported_at,
  };
}

export class SqliteCalendarItemRepository implements ICalendarItemRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(item: CalendarItem): Promise<void> {
    const timestamp = new Date().toISOString();
    this.db
      .prepare(`
        INSERT INTO calendar_items (
          event_id, external_id, calendar_name, recurrence_rule, organizer,
          attendees_json, imported_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(event_id) DO UPDATE SET
          external_id = excluded.external_id,
          calendar_name = excluded.calendar_name,
          recurrence_rule = excluded.recurrence_rule,
          organizer = excluded.organizer,
          attendees_json = excluded.attendees_json,
          imported_at = excluded.imported_at,
          updated_at = excluded.updated_at
      `)
      .run(
        item.eventId,
        item.externalId,
        item.calendarName ?? null,
        item.recurrenceRule ?? null,
        item.organizer ?? null,
        JSON.stringify(item.attendees),
        item.importedAt,
        timestamp,
        timestamp
      );
  }

  async findByEventId(eventId: UUID): Promise<CalendarItem | null> {
    const row = this.db
      .prepare('SELECT * FROM calendar_items WHERE event_id = ?')
      .get(eventId) as unknown as CalendarItemRow | undefined;
    return row ? rowToItem(row) : null;
  }

  async findByExternalId(externalId: string): Promise<CalendarItem | null> {
    const row = this.db
      .prepare('SELECT * FROM calendar_items WHERE external_id = ? ORDER BY imported_at DESC LIMIT 1')
      .get(externalId) as unknown as CalendarItemRow | undefined;
    return row ? rowToItem(row) : null;
  }

  async listAll(): Promise<CalendarItem[]> {
    const rows = this.db
      .prepare('SELECT * FROM calendar_items ORDER BY imported_at ASC')
      .all() as unknown as CalendarItemRow[];
    return rows.map(rowToItem);
  }
}
