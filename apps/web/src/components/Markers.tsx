import React from 'react';
import { Marker } from '@life-logger/domain';

interface MarkersProps {
  markers: Marker[];
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export const Markers: React.FC<MarkersProps> = ({ markers }) => {
  if (markers.length === 0) {
    return (
      <p className="empty-state">
        No markers recorded for this day yet.
      </p>
    );
  }

  return (
    <div>
      {markers.map((marker) => (
        <div key={marker.id} className={`marker-item ${marker.note ? 'note' : ''}`}>
          <div className="marker-time">{formatClock(marker.markedAt)}</div>
          <div className="marker-text">
            {marker.note ? (
              marker.note
            ) : (
              <span className="marker-note-empty">Quick Marker</span>
            )}
          </div>
          <div className="marker-meta">
            <span>{marker.precision}</span>
            <span>{marker.source}</span>
          </div>
        </div>
      ))}
    </div>
  );
};
