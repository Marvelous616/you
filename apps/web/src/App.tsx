import React, { useEffect, useState, useCallback } from 'react';
import { Marker, Day } from '@life-logger/domain';
import { fetchActiveDay, fetchMarkers } from './api.js';
import { Timeline } from './components/Timeline.js';

export const App: React.FC = () => {
  const [day, setDay] = useState<Day | null>(null);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const activeDay = await fetchActiveDay();
      setDay(activeDay);
      const dayMarkers = await fetchMarkers(activeDay.id);
      setMarkers(dayMarkers);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    // Auto poll every 10 seconds for walking skeleton demo
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  return (
    <div>
      {error && (
        <div style={{
          backgroundColor: '#ef4444',
          color: '#fff',
          padding: '10px 16px',
          textAlign: 'center',
          fontSize: '0.9rem'
        }}>
          Server connection notice: {error} (Check if Fastify server is running on port 4000)
        </div>
      )}
      <Timeline day={day} markers={markers} isLoading={isLoading} onRefresh={loadData} />
    </div>
  );
};
