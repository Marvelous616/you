import React, { useCallback, useEffect, useState } from 'react';
import { SearchHit } from '@life-logger/domain';
import { search } from '../api.js';

interface SearchBoxProps {
  onEventClick: (eventId: string) => void;
}

export const SearchBox: React.FC<SearchBoxProps> = ({ onEventClick }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);

  const runSearch = useCallback(async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed) {
      setResults([]);
      setOpen(false);
      return;
    }
    setIsSearching(true);
    try {
      const hits = await search(trimmed);
      setResults(hits);
      setOpen(true);
    } catch {
      setResults([]);
      setOpen(false);
    } finally {
      setIsSearching(false);
    }
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setOpen(false);
      return;
    }
    const timer = setTimeout(() => {
      void runSearch(query);
    }, 300);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    await runSearch(query);
  };

  const handlePick = (hit: SearchHit) => {
    if (hit.entityType === 'event') {
      onEventClick(hit.entityId);
    }
  };

  return (
    <div className="card compact" style={{ marginBottom: '16px' }}>
      <form onSubmit={handleSubmit}>
        <input
          className="input"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search events and journal"
          aria-label="Search events and journal"
          style={{ width: '100%' }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '8px' }}>
          <button className="btn btn-primary btn-sm" type="submit" disabled={isSearching}>
            {isSearching ? 'Searching…' : 'Search'}
          </button>
        </div>
      </form>

      {open && isSearching && (
        <p className="empty-state" style={{ padding: '16px 24px' }}>
          Searching…
        </p>
      )}

      {open && !isSearching && results.length > 0 && (
        <div style={{ marginTop: '12px' }}>
          {results.map((hit) => (
            <div
              key={`${hit.entityType}:${hit.entityId}`}
              onClick={() => handlePick(hit)}
              style={{
                padding: '8px 10px',
                borderRadius: '8px',
                cursor: hit.entityType === 'event' ? 'pointer' : 'default',
                backgroundColor: hit.entityType === 'event' ? '#1e293b' : 'transparent',
                marginBottom: '4px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#e2e8f0' }}>
                  {hit.title}
                </span>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 700,
                    letterSpacing: '0.05em',
                    textTransform: 'uppercase',
                    color: hit.entityType === 'event' ? '#818cf8' : '#94a3b8',
                  }}
                >
                  {hit.entityType === 'event' ? 'Event' : 'Journal'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && !isSearching && results.length === 0 && (
        <p className="empty-state" style={{ padding: '16px 24px', margin: 0 }}>
          No matches.
        </p>
      )}
    </div>
  );
};
