import React, { useMemo } from 'react';
import {
  Day,
  Event,
  EventTag,
  Tag,
  TimelineGap,
  computeTimelineLanes,
} from '@life-logger/domain';

interface TimelineProps {
  day: Day | null;
  events: Event[];
  eventTags: EventTag[];
  tags: Tag[];
  gaps: TimelineGap[];
  onEventClick: (event: Event) => void;
}

function formatClock(iso?: string): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function positionStart(windowStartMs: number, spanMs: number, startMs: number): number {
  return Math.max(0, Math.min(100, ((startMs - windowStartMs) / spanMs) * 100));
}

function positionWidth(windowStartMs: number, spanMs: number, startMs: number, endMs: number): number {
  const left = positionStart(windowStartMs, spanMs, startMs);
  return Math.max(0.7, Math.min(100 - left, ((endMs - startMs) / spanMs) * 100));
}

export const Timeline: React.FC<TimelineProps> = ({
  day,
  events,
  eventTags,
  tags,
  gaps,
  onEventClick,
}) => {
  const tagById = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const tag of tags) map.set(tag.id, tag);
    return map;
  }, [tags]);

  const tagsForEvent = (eventId: string): string[] =>
    eventTags
      .filter((link) => link.eventId === eventId)
      .map((link) => tagById.get(link.tagId)?.path ?? link.tagId);

  const lanes = computeTimelineLanes(events);

  const nowMs = Date.now();
  const eventStarts = events.map((event) => new Date(event.startAt).getTime());
  const fallbackStart = eventStarts.length > 0 ? Math.min(...eventStarts) : nowMs;
  const windowStartMs = day?.wakeAt
    ? new Date(day.wakeAt).getTime()
    : Math.min(fallbackStart, nowMs - 60 * 60 * 1000);
  const windowEndMs = day?.sleepAt ? new Date(day.sleepAt).getTime() : nowMs;
  const spanMs = Math.max(windowEndMs - windowStartMs, 60 * 60 * 1000);

  return (
    <div className="timeline-container">
      <div className="timeline-header">
        <span>Timeline</span>
        <span className="timeline-time">{formatClock(new Date(windowStartMs).toISOString())}</span>
        <span className="timeline-time">{formatClock(new Date(windowEndMs).toISOString())}</span>
      </div>
      <div className="timeline-body">
        <div className="timeline-track" />
        {day?.wakeAt && gaps.map((gap) => {
          const startMs = new Date(gap.startAt).getTime();
          const endMs = new Date(gap.endAt).getTime();
          return (
            <div
              key={`gap-${gap.startAt}`}
              className="timeline-gap"
              style={{
                left: `${positionStart(windowStartMs, spanMs, startMs)}%`,
                width: `${positionWidth(windowStartMs, spanMs, startMs, endMs)}%`,
              }}
            />
          );
        })}
        {lanes.map(({ event, laneIndex }) => {
          const startMs = new Date(event.startAt).getTime();
          const endMs = event.endAt ? new Date(event.endAt).getTime() : startMs;
          const paths = tagsForEvent(event.id);
          return (
            <div
              key={event.id}
              className="timeline-event"
              style={{
                left: `${positionStart(windowStartMs, spanMs, startMs)}%`,
                width: `${positionWidth(windowStartMs, spanMs, startMs, endMs)}%`,
                top: 10 + laneIndex * 38,
              }}
              onClick={() => onEventClick(event)}
              title={`${event.title} — ${formatClock(event.startAt)} ${event.endAt ? `– ${formatClock(event.endAt)}` : ''}`}
            >
              <div className="timeline-event-title">{event.title}</div>
              <div className="timeline-event-time">
                {formatClock(event.startAt)}
                {event.endAt ? `– ${formatClock(event.endAt)}` : ''}
              </div>
              {paths.length > 0 && (
                <div className="timeline-event-tags">#{paths.join(' #')}</div>
              )}
            </div>
          );
        })}
        {!day?.wakeAt && events.length === 0 && (
          <div className="timeline-empty">
            Set your wake time or log a quick entry to start today's timeline.
          </div>
        )}
      </div>
      <div className="timeline-axis">
        <span>{formatClock(new Date(windowStartMs).toISOString())}</span>
        <span>{formatClock(new Date((windowStartMs + windowEndMs) / 2).toISOString())}</span>
        <span>{formatClock(new Date(windowEndMs).toISOString())}</span>
      </div>
    </div>
  );
};
