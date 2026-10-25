import { Day, Event, ISODateTimeString } from './types.js';

export interface VisualTimelineEvent {
  event: Event;
  laneIndex: number;
  totalLanes: number;
}

export interface TimelineGap {
  startAt: ISODateTimeString;
  endAt: ISODateTimeString;
  durationMinutes: number;
}

export interface TimeInterval {
  startMs: number;
  endMs: number;
}

/**
 * Returns the absolute [start, end] interval for an event. A point-in-time
 * event (no endAt) has an end equal to its start.
 */
export function getEventInterval(event: Event): TimeInterval {
  const startMs = new Date(event.startAt).getTime();
  const endMs = event.endAt ? new Date(event.endAt).getTime() : startMs;
  return { startMs, endMs: Math.max(startMs, endMs) };
}

/**
 * Merges overlapping or touching intervals into a flat, sorted busy list.
 * Optionally clips intervals to a window.
 */
export function mergeIntervals(
  intervals: TimeInterval[],
  windowStartMs?: number,
  windowEndMs?: number
): TimeInterval[] {
  const clipped: TimeInterval[] = [];

  for (const interval of intervals) {
    let start = interval.startMs;
    let end = interval.endMs;

    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (end < start) [start, end] = [end, start];

    if (windowStartMs !== undefined) start = Math.max(start, windowStartMs);
    if (windowEndMs !== undefined) end = Math.min(end, windowEndMs);
    if (end < start) continue;

    clipped.push({ startMs: start, endMs: end });
  }

  clipped.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged: TimeInterval[] = [];
  for (const interval of clipped) {
    const last = merged[merged.length - 1];
    if (!last || interval.startMs > last.endMs) {
      merged.push({ ...interval });
    } else if (interval.endMs > last.endMs) {
      last.endMs = interval.endMs;
    }
  }

  return merged;
}

/**
 * Total non-overlapping duration covered by the supplied events.
 * Overlapping events are only counted once.
 */
export function calculateUnionDuration(
  events: Event[],
  windowStartMs?: number,
  windowEndMs?: number
): number {
  const merged = mergeIntervals(events.map(getEventInterval), windowStartMs, windowEndMs);
  return merged.reduce((total, interval) => total + (interval.endMs - interval.startMs), 0);
}

/**
 * Assigns visual lanes to interval events using greedy interval graph colouring.
 * Lanes are derived, never stored. Events that overlap are rendered side by side.
 */
export function computeTimelineLanes(events: Event[]): VisualTimelineEvent[] {
  const sorted = [...events].sort((a, b) => {
    const aStart = new Date(a.startAt).getTime();
    const bStart = new Date(b.startAt).getTime();
    if (aStart !== bStart) return aStart - bStart;

    const aEnd = a.endAt ? new Date(a.endAt).getTime() : aStart;
    const bEnd = b.endAt ? new Date(b.endAt).getTime() : bStart;
    return bEnd - aEnd;
  });

  const laneEnds: number[] = [];
  const assigned: Array<{ event: Event; laneIndex: number; startMs: number; endMs: number }> = [];

  for (const event of sorted) {
    const { startMs, endMs } = getEventInterval(event);
    let laneIndex = laneEnds.findIndex((laneEnd) => laneEnd <= startMs);
    if (laneIndex === -1) {
      laneIndex = laneEnds.length;
      laneEnds.push(endMs);
    } else {
      laneEnds[laneIndex] = endMs;
    }

    assigned.push({ event, laneIndex, startMs, endMs });
  }

  // Compute totalLanes per connected overlap cluster so isolated events stay
  // full-width even if another part of the day uses multiple lanes.
  const result: VisualTimelineEvent[] = [];
  let clusterStart = 0;

  while (clusterStart < assigned.length) {
    let clusterEnd = clusterStart;
    let maxEnd = assigned[clusterStart].endMs;
    let maxLane = assigned[clusterStart].laneIndex;

    while (clusterEnd + 1 < assigned.length && assigned[clusterEnd + 1].startMs <= maxEnd) {
      clusterEnd++;
      maxEnd = Math.max(maxEnd, assigned[clusterEnd].endMs);
      maxLane = Math.max(maxLane, assigned[clusterEnd].laneIndex);
    }

    const totalLanes = maxLane + 1;
    for (let i = clusterStart; i <= clusterEnd; i++) {
      result.push({
        event: assigned[i].event,
        laneIndex: assigned[i].laneIndex,
        totalLanes,
      });
    }

    clusterStart = clusterEnd + 1;
  }

  return result;
}

/**
 * Finds unlogged gaps between wake and sleep (or now, when still awake).
 * Only gaps at least minGapMinutes long are surfaced.
 */
export function findTimelineGaps(
  day: Day,
  events: Event[],
  minGapMinutes: number = 15,
  currentTime: Date = new Date()
): TimelineGap[] {
  if (!day.wakeAt) return [];

  const wakeMs = new Date(day.wakeAt).getTime();
  if (!Number.isFinite(wakeMs)) return [];

  const endMs = day.sleepAt ? new Date(day.sleepAt).getTime() : currentTime.getTime();
  if (!Number.isFinite(endMs) || endMs <= wakeMs) return [];

  const busy = mergeIntervals(events.map(getEventInterval), wakeMs, endMs);
  const minGapMs = Math.max(0, minGapMinutes) * 60_000;
  const gaps: TimelineGap[] = [];

  let cursor = wakeMs;
  for (const interval of busy) {
    if (interval.startMs - cursor >= minGapMs) {
      gaps.push(toGap(cursor, interval.startMs));
    }
    cursor = Math.max(cursor, interval.endMs);
  }

  if (endMs - cursor >= minGapMs) {
    gaps.push(toGap(cursor, endMs));
  }

  return gaps;
}

function toGap(startMs: number, endMs: number): TimelineGap {
  return {
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(endMs).toISOString(),
    durationMinutes: Math.round(((endMs - startMs) / 60_000) * 100) / 100,
  };
}
