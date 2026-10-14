import React from 'react';
import { Marker, Day } from '@life-logger/domain';
import { MarkerItem } from './MarkerItem.js';

interface TimelineProps {
  day: Day | null;
  markers: Marker[];
  isLoading: boolean;
  onRefresh: () => void;
}

export const Timeline: React.FC<TimelineProps> = ({ day, markers, isLoading, onRefresh }) => {
  return (
    <div style={{ maxWidth: '700px', margin: '40px auto', padding: '0 20px' }}>
      <header style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '24px',
        borderBottom: '1px solid #334155',
        paddingBottom: '16px'
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: '1.75rem', fontWeight: 700, color: '#f8fafc' }}>
            Life Logger
          </h1>
          <div style={{ color: '#94a3b8', fontSize: '0.9rem', marginTop: '4px' }}>
            {day ? `Logical Day: ${day.localDate} (${day.timezone})` : 'Loading day...'}
          </div>
        </div>
        <button
          onClick={onRefresh}
          disabled={isLoading}
          style={{
            padding: '8px 16px',
            borderRadius: '6px',
            backgroundColor: '#0284c7',
            color: '#fff',
            border: 'none',
            fontWeight: 600,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            opacity: isLoading ? 0.7 : 1
          }}
        >
          {isLoading ? 'Refreshing...' : 'Refresh'}
        </button>
      </header>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', color: '#94a3b8', fontSize: '0.85rem' }}>
          <span>CHRONOLOGICAL MARKER STREAM</span>
          <span>{markers.length} {markers.length === 1 ? 'entry' : 'entries'}</span>
        </div>

        {markers.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '48px 24px',
            backgroundColor: '#1e293b',
            borderRadius: '8px',
            color: '#94a3b8'
          }}>
            No markers recorded for this day yet. Drop a marker from your phone to sync!
          </div>
        ) : (
          markers.map((marker) => <MarkerItem key={marker.id} marker={marker} />)
        )}
      </section>
    </div>
  );
};
