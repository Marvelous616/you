import { Marker, Day, Event } from '@life-logger/domain';

export function generateSyntheticDataset(markerCount: number = 5000): { days: Day[]; markers: Marker[] } {
  const days: Day[] = [];
  const markers: Marker[] = [];

  const baseDate = new Date('2026-01-01T00:00:00.000Z');
  const dayCount = Math.ceil(markerCount / 15);

  for (let d = 0; d < dayCount; d++) {
    const dayDate = new Date(baseDate.getTime() + d * 86400000);
    const localDate = dayDate.toISOString().slice(0, 10);
    const dayId = `day-${localDate}`;

    days.push({
      id: dayId,
      localDate,
      timezone: 'UTC',
      reviewStatus: 'completed',
      fidelity: 'detailed',
      createdAt: dayDate.toISOString(),
      updatedAt: dayDate.toISOString(),
      isDeleted: false,
    });
  }

  for (let i = 0; i < markerCount; i++) {
    const dayIndex = i % days.length;
    const parentDay = days[dayIndex];
    const markerTime = new Date(new Date(parentDay.createdAt).getTime() + (i % 86400) * 1000).toISOString();

    markers.push({
      id: `synthetic-marker-${i}`,
      dayId: parentDay.id,
      markedAt: markerTime,
      timezoneOffsetMinutes: 0,
      note: `Synthetic activity ${i}`,
      precision: 'exact',
      source: 'live',
      createdAt: markerTime,
      updatedAt: markerTime,
      isDeleted: false,
    });
  }

  return { days, markers };
}

/**
 * Generates a dense day of overlapping interval events for timeline and
 * multi-lane rendering benchmarks.
 */
export function generateEventDataset(dayId: string, eventCount: number = 50): Event[] {
  const base = new Date('2026-01-01T08:00:00.000Z').getTime();
  const events: Event[] = [];

  for (let i = 0; i < eventCount; i++) {
    const startMs = base + i * 15 * 60_000;
    const endMs = startMs + (40 + (i % 5) * 10) * 60_000;
    const timestamp = new Date(startMs).toISOString();

    events.push({
      id: `synthetic-event-${i}`,
      dayId,
      title: `Synthetic activity ${i}`,
      startAt: timestamp,
      endAt: new Date(endMs).toISOString(),
      startPrecision: 'exact',
      endPrecision: 'exact',
      source: 'live',
      createdAt: timestamp,
      updatedAt: timestamp,
      isDeleted: false,
    });
  }

  return events;
}
