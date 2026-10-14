import { Marker, Day } from '@life-logger/domain';

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
