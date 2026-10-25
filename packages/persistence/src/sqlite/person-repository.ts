import { DatabaseSync } from './db.js';
import {
  EventParticipant,
  ParticipantInitiation,
  ParticipantMedium,
  Person,
  UUID,
} from '@life-logger/domain';
import {
  CursorResult,
  IPersonRepository,
  TimestampedEventParticipant,
} from '../interfaces.js';

interface PersonRow {
  id: string;
  display_name: string;
  aliases_json: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: number;
}

interface ParticipantRow {
  event_id: string;
  person_id: string;
  role: string;
  medium: string;
  initiated_by: string;
  updated_at?: string;
}

function rowToPerson(row: PersonRow): Person {
  let aliases: string[] = [];
  try {
    const parsed = JSON.parse(row.aliases_json);
    if (Array.isArray(parsed)) aliases = parsed.filter((alias) => typeof alias === 'string');
  } catch {
    aliases = [];
  }

  return {
    id: row.id,
    displayName: row.display_name,
    aliases,
    notes: row.notes ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    isDeleted: row.is_deleted === 1,
  };
}

function rowToParticipant(row: ParticipantRow): EventParticipant {
  return {
    eventId: row.event_id,
    personId: row.person_id,
    role: row.role,
    medium: row.medium as ParticipantMedium,
    initiatedBy: row.initiated_by as ParticipantInitiation,
  };
}

function normalizeName(value: string): string {
  return value.trim().replace(/^@+/, '').replace(/\s+/g, ' ').toLowerCase();
}

export class SqlitePersonRepository implements IPersonRepository {
  constructor(private readonly db: DatabaseSync) {}

  async save(person: Person): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO people (
          id, display_name, aliases_json, notes, created_at, updated_at, is_deleted
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          display_name = excluded.display_name,
          aliases_json = excluded.aliases_json,
          notes = excluded.notes,
          updated_at = excluded.updated_at,
          is_deleted = excluded.is_deleted
        WHERE excluded.updated_at >= people.updated_at
      `)
      .run(
        person.id,
        person.displayName,
        JSON.stringify(person.aliases),
        person.notes ?? null,
        person.createdAt,
        person.updatedAt,
        person.isDeleted ? 1 : 0
      );
  }

  async saveBatch(people: Person[]): Promise<void> {
    if (people.length === 0) return;

    this.db.exec('BEGIN TRANSACTION');
    try {
      for (const person of people) {
        await this.save(person);
      }
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  async findById(id: UUID): Promise<Person | null> {
    const row = this.db.prepare('SELECT * FROM people WHERE id = ?').get(id) as unknown as
      | PersonRow
      | undefined;
    return row ? rowToPerson(row) : null;
  }

  async findByNameOrAlias(name: string): Promise<Person | null> {
    const needle = normalizeName(name);
    if (!needle) return null;

    for (const person of await this.listAll()) {
      if (normalizeName(person.displayName) === needle) return person;
      if (person.aliases.some((alias) => normalizeName(alias) === needle)) return person;
    }

    return null;
  }

  async listAll(includeDeleted = false): Promise<Person[]> {
    const query = includeDeleted
      ? 'SELECT * FROM people ORDER BY display_name ASC'
      : 'SELECT * FROM people WHERE is_deleted = 0 ORDER BY display_name ASC';
    const rows = this.db.prepare(query).all() as unknown as PersonRow[];
    return rows.map(rowToPerson);
  }

  async linkParticipant(participant: EventParticipant): Promise<void> {
    this.db
      .prepare(`
        INSERT INTO event_participants (event_id, person_id, role, medium, initiated_by)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(event_id, person_id) DO UPDATE SET
          role = excluded.role,
          medium = excluded.medium,
          initiated_by = excluded.initiated_by
      `)
      .run(
        participant.eventId,
        participant.personId,
        participant.role,
        participant.medium,
        participant.initiatedBy
      );
  }

  async unlinkParticipant(eventId: UUID, personId: UUID): Promise<void> {
    this.db
      .prepare('DELETE FROM event_participants WHERE event_id = ? AND person_id = ?')
      .run(eventId, personId);
  }

  async listParticipants(eventId: UUID): Promise<EventParticipant[]> {
    const rows = this.db
      .prepare('SELECT * FROM event_participants WHERE event_id = ? ORDER BY person_id ASC')
      .all(eventId) as unknown as ParticipantRow[];
    return rows.map(rowToParticipant);
  }

  async listParticipantsForDay(dayId: UUID): Promise<EventParticipant[]> {
    const rows = this.db
      .prepare(`
        SELECT ep.* FROM event_participants ep
        JOIN events e ON e.id = ep.event_id
        WHERE e.day_id = ? AND e.is_deleted = 0
        ORDER BY ep.event_id ASC, ep.person_id ASC
      `)
      .all(dayId) as unknown as ParticipantRow[];
    return rows.map(rowToParticipant);
  }

  async listAllParticipants(): Promise<EventParticipant[]> {
    const rows = this.db
      .prepare('SELECT * FROM event_participants ORDER BY event_id ASC, person_id ASC')
      .all() as unknown as ParticipantRow[];
    return rows.map(rowToParticipant);
  }

  async listParticipantsModifiedSince(
    cursor: string = '',
    limit: number = 100
  ): Promise<CursorResult<TimestampedEventParticipant>> {
    const query = cursor
      ? `SELECT ep.event_id, ep.person_id, ep.role, ep.medium, ep.initiated_by, e.updated_at
         FROM event_participants ep JOIN events e ON e.id = ep.event_id
         WHERE e.updated_at > ?
         ORDER BY e.updated_at ASC, ep.event_id ASC, ep.person_id ASC LIMIT ?`
      : `SELECT ep.event_id, ep.person_id, ep.role, ep.medium, ep.initiated_by, e.updated_at
         FROM event_participants ep JOIN events e ON e.id = ep.event_id
         ORDER BY e.updated_at ASC, ep.event_id ASC, ep.person_id ASC LIMIT ?`;

    const params = cursor ? [cursor, limit + 1] : [limit + 1];
    const rows = this.db.prepare(query).all(...params) as unknown as ParticipantRow[];

    const hasMore = rows.length > limit;
    const recordsToReturn = hasMore ? rows.slice(0, limit) : rows;
    const records = recordsToReturn.map((row) => ({
      participant: rowToParticipant(row),
      updatedAt: row.updated_at ?? '',
    }));
    const nextCursor = records.length > 0 ? records[records.length - 1].updatedAt : cursor;

    return { records, nextCursor, hasMore };
  }
}
