import React from 'react';
import { Marker } from '@life-logger/domain';

interface MarkerItemProps {
  marker: Marker;
}

export const MarkerItem: React.FC<MarkerItemProps> = ({ marker }) => {
  const time = new Date(marker.markedAt).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  return (
    <div style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: '16px',
      padding: '12px 16px',
      backgroundColor: '#1e293b',
      borderRadius: '8px',
      marginBottom: '10px',
      borderLeft: '4px solid #64748b'
    }}>
      <div style={{ minWidth: '85px', fontWeight: 600, color: '#cbd5e1', fontSize: '0.95rem' }}>
        {time}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: '1rem', color: '#f1f5f9' }}>
          {marker.note || <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Quick Marker</span>}
        </div>
        <div style={{ display: 'flex', gap: '8px', marginTop: '6px' }}>
          <span style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '9999px',
            backgroundColor: '#334155',
            color: '#cbd5e1'
          }}>
            {marker.precision}
          </span>
          <span style={{
            fontSize: '0.75rem',
            padding: '2px 8px',
            borderRadius: '9999px',
            backgroundColor: '#334155',
            color: '#cbd5e1'
          }}>
            {marker.source}
          </span>
        </div>
      </div>
    </div>
  );
};
