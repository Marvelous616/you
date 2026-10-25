import {
  Capture,
  Day,
  Event,
  EventParticipant,
  EventTag,
  JournalEntry,
  Marker,
  Person,
  Tag,
} from '@life-logger/domain';
import { OutboxItem, createOutboxItem } from '@life-logger/sync';

export interface QuickEntrySaveInput {
  event: Event;
  capture?: Capture;
  tags?: Tag[];
  eventTags?: EventTag[];
  people?: Person[];
  participants?: EventParticipant[];
}

export interface MobileStorage {
  saveMarkerAndEnqueueOutbox(marker: Marker): Promise<{ saveDurationMs: number }>;
  saveQuickEntryAndEnqueueOutbox(input: QuickEntrySaveInput): Promise<{ saveDurationMs: number }>;
  saveDayAndEnqueueOutbox(day: Day): Promise<{ saveDurationMs: number }>;
  saveJournalAndEnqueueOutbox(entry: JournalEntry): Promise<{ saveDurationMs: number }>;
  getMarkerList(): Promise<Marker[]>;
  getEventsForDay(dayId: string): Promise<Event[]>;
  getEventTagsForDay(dayId: string): Promise<EventTag[]>;
  getParticipantsForDay(dayId: string): Promise<EventParticipant[]>;
  getTags(): Promise<Tag[]>;
  getPeople(): Promise<Person[]>;
  getJournalEntries(dayId: string): Promise<JournalEntry[]>;
  getDay(dayId: string): Promise<Day | null>;
  getPendingOutboxItems(): Promise<OutboxItem[]>;
  markOutboxItemsSynced(itemIds: string[]): Promise<void>;
  getPendingCount(): Promise<number>;
}

/**
 * In-memory / portable mobile storage implementation.
 * Wraps local SQLite on native devices and provides guaranteed fast offline
 * writes. Every accepted write is mirrored into the outbox in dependency
 * order so the server can ingest a batch atomically.
 */
export class InMemoryMobileStorage implements MobileStorage {
  private markers: Map<string, Marker> = new Map();
  private days: Map<string, Day> = new Map();
  private events: Map<string, Event> = new Map();
  private eventTags: Map<string, EventTag> = new Map();
  private participants: Map<string, EventParticipant> = new Map();
  private tags: Map<string, Tag> = new Map();
  private people: Map<string, Person> = new Map();
  private journalEntries: Map<string, JournalEntry> = new Map();
  private captures: Map<string, Capture> = new Map();
  private outbox: Map<string, OutboxItem> = new Map();

  private enqueue<T>(
    entityType: OutboxItem['entityType'],
    entityId: string,
    data: T,
    updatedAt: string,
    isDeleted = false
  ): void {
    const outboxId = `outbox-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
    this.outbox.set(
      outboxId,
      createOutboxItem(outboxId, entityType, entityId, 'UPSERT', data, updatedAt, isDeleted)
    );
  }

  async saveMarkerAndEnqueueOutbox(marker: Marker): Promise<{ saveDurationMs: number }> {
    const start = performance.now();
    this.markers.set(marker.id, marker);
    this.enqueue('marker', marker.id, marker, marker.updatedAt, marker.isDeleted);
    return { saveDurationMs: performance.now() - start };
  }

  async saveQuickEntryAndEnqueueOutbox(
    input: QuickEntrySaveInput
  ): Promise<{ saveDurationMs: number }> {
    const start = performance.now();

    for (const tag of input.tags ?? []) {
      this.tags.set(tag.id, tag);
      this.enqueue('tag', tag.id, tag, tag.updatedAt, tag.isDeleted);
    }
    for (const person of input.people ?? []) {
      this.people.set(person.id, person);
      this.enqueue('person', person.id, person, person.updatedAt, person.isDeleted);
    }

    this.events.set(input.event.id, input.event);
    this.enqueue('event', input.event.id, input.event, input.event.updatedAt, input.event.isDeleted);

    for (const link of input.eventTags ?? []) {
      this.eventTags.set(`${link.eventId}:${link.tagId}`, link);
      this.enqueue(
        'event_tag',
        `${link.eventId}:${link.tagId}`,
        link,
        input.event.updatedAt,
        false
      );
    }

    for (const participant of input.participants ?? []) {
      this.participants.set(`${participant.eventId}:${participant.personId}`, participant);
      this.enqueue(
        'event_participant',
        `${participant.eventId}:${participant.personId}`,
        participant,
        input.event.updatedAt,
        false
      );
    }

    if (input.capture) {
      this.captures.set(input.capture.id, input.capture);
      this.enqueue(
        'capture',
        input.capture.id,
        input.capture,
        input.capture.updatedAt,
        input.capture.isDeleted
      );
    }

    return { saveDurationMs: performance.now() - start };
  }

  async saveDayAndEnqueueOutbox(day: Day): Promise<{ saveDurationMs: number }> {
    const start = performance.now();
    this.days.set(day.id, day);
    this.enqueue('day', day.id, day, day.updatedAt, day.isDeleted);
    return { saveDurationMs: performance.now() - start };
  }

  async saveJournalAndEnqueueOutbox(entry: JournalEntry): Promise<{ saveDurationMs: number }> {
    const start = performance.now();
    this.journalEntries.set(entry.id, entry);
    this.enqueue('journal_entry', entry.id, entry, entry.updatedAt, entry.isDeleted);
    return { saveDurationMs: performance.now() - start };
  }

  async getMarkerList(): Promise<Marker[]> {
    return Array.from(this.markers.values()).sort((a, b) => b.markedAt.localeCompare(a.markedAt));
  }

  async getEventsForDay(dayId: string): Promise<Event[]> {
    return Array.from(this.events.values())
      .filter((event) => event.dayId === dayId && !event.isDeleted)
      .sort((a, b) => a.startAt.localeCompare(b.startAt));
  }

  async getEventTagsForDay(dayId: string): Promise<EventTag[]> {
    const eventIds = new Set((await this.getEventsForDay(dayId)).map((event) => event.id));
    return Array.from(this.eventTags.values()).filter((link) => eventIds.has(link.eventId));
  }

  async getParticipantsForDay(dayId: string): Promise<EventParticipant[]> {
    const eventIds = new Set((await this.getEventsForDay(dayId)).map((event) => event.id));
    return Array.from(this.participants.values()).filter((participant) =>
      eventIds.has(participant.eventId)
    );
  }

  async getTags(): Promise<Tag[]> {
    return Array.from(this.tags.values()).filter((tag) => !tag.isDeleted);
  }

  async getPeople(): Promise<Person[]> {
    return Array.from(this.people.values()).filter((person) => !person.isDeleted);
  }

  async getJournalEntries(dayId: string): Promise<JournalEntry[]> {
    return Array.from(this.journalEntries.values()).filter(
      (entry) => entry.dayId === dayId && !entry.isDeleted
    );
  }

  async getDay(dayId: string): Promise<Day | null> {
    return this.days.get(dayId) ?? null;
  }

  async getPendingOutboxItems(): Promise<OutboxItem[]> {
    return Array.from(this.outbox.values()).filter((item) => item.status === 'PENDING');
  }

  async markOutboxItemsSynced(itemIds: string[]): Promise<void> {
    for (const id of itemIds) {
      this.outbox.delete(id);
    }
  }

  async getPendingCount(): Promise<number> {
    return (await this.getPendingOutboxItems()).length;
  }
}
