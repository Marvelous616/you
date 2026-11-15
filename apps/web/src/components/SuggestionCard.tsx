import React, { useState } from 'react';
import { Suggestion, SuggestionOverrides } from '@life-logger/domain';

interface SuggestionCardProps {
  suggestion: Suggestion;
  busy: boolean;
  isLoading: boolean;
  onAccept: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
  onEdit: (id: string, overrides: SuggestionOverrides) => Promise<void>;
}

function formatClock(iso?: string): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRange(startAt: string, endAt?: string): string {
  return endAt ? `${formatClock(startAt)} – ${formatClock(endAt)}` : formatClock(startAt);
}

function sourceLabel(source: Suggestion['source']): string {
  const labels: Record<string, string> = {
    screen_time: 'screen time',
    calendar: 'calendar',
    gps: 'gps',
  };
  return labels[source] ?? source;
}

export const SuggestionCard: React.FC<SuggestionCardProps> = ({
  suggestion,
  busy,
  isLoading,
  onAccept,
  onReject,
  onEdit,
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(suggestion.proposed.title);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  const handleAccept = async () => {
    await onAccept(suggestion.id);
  };

  const handleReject = async () => {
    await onReject(suggestion.id);
  };

  const handleSaveEdit = async () => {
    await onEdit(suggestion.id, { title, startAt: start || suggestion.proposed.startAt, endAt: end || undefined });
    setEditing(false);
  };

  return (
    <div className="suggestion-row">
      <div className="suggestion-time">
        <div>{formatClock(suggestion.proposed.startAt)}</div>
        {suggestion.proposed.endAt ? (
          <div className="suggestion-time-end">{formatClock(suggestion.proposed.endAt)}</div>
        ) : (
          <div className="suggestion-time-end">point</div>
        )}
      </div>
      <div className="suggestion-body">
        {editing ? (
          <div>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
            />
            <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
              <input
                className="input"
                type="datetime-local"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                placeholder="Start"
              />
              <input
                className="input"
                type="datetime-local"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                placeholder="End"
              />
            </div>
            <div style={{ marginTop: '10px', display: 'flex', gap: '8px' }}>
              <button type="button" className="btn btn-primary btn-sm" onClick={handleSaveEdit} disabled={busy || isLoading}>
                Save
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="suggestion-title">{suggestion.proposed.title}</div>
            <div className="suggestion-meta">
              <span className="badge badge-neutral">{sourceLabel(suggestion.source)}</span>
              <span>{formatRange(suggestion.proposed.startAt, suggestion.proposed.endAt)}</span>
              <span>{Math.round(suggestion.confidence * 100)}% confidence</span>
              {suggestion.proposed.startPrecision === 'approx' && (
                <span className="badge badge-approx">time approximate</span>
              )}
            </div>
            {suggestion.proposed.notes && (
              <div className="suggestion-notes">{suggestion.proposed.notes}</div>
            )}
            <div className="suggestion-actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={handleAccept} disabled={busy || isLoading}>
                {busy ? 'Working…' : 'Accept'}
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(true)} disabled={busy}>
                Edit
              </button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={handleReject} disabled={busy}>
                Reject
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
};
