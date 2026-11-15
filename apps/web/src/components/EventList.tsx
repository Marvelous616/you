import React from 'react';
import { Event, EventTag, Tag } from '@life-logger/domain';

interface EventListProps {
  events: Event[];
  eventTags: EventTag[];
  tags: Tag[];
  onEventClick: (event: Event) => void;
}

function formatClock(iso?: string): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export const EventList: React.FC<EventListProps> = ({ events, eventTags, tags, onEventClick }) => {
  const tagById = new Map<string, Tag>();
  for (const tag of tags) tagById.set(tag.id, tag);

  const tagsForEvent = (eventId: string): string[] =>
    eventTags
      .filter((link) => link.eventId === eventId)
      .map((link) => tagById.get(link.tagId)?.path ?? link.tagId);

  if (events.length === 0) {
    return (
      <p className="empty-state">
        No events logged yet. Try a quick entry like “read #reading for 45m”.
      </p>
    );
  }

  return (
    <div>
      {events.map((event) => {
        const paths = tagsForEvent(event.id);
        return (
          <div key={event.id} className="event-row" onClick={() => onEventClick(event)}>
            <div className="event-row-time">
              <div>{formatClock(event.startAt)}</div>
              {event.endAt ? (
                <div className="event-row-time-end">{formatClock(event.endAt)}</div>
              ) : (
                <div className="event-row-time-end">point</div>
              )}
            </div>
            <div className="event-row-body">
              <div className="event-row-title">{event.title}</div>
              <div className="event-row-meta">
                <span className="source-badge">{event.source}</span>
                {paths.map((path) => (
                  <span key={path} className="tag-chip">#{path}</span>
                ))}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};
