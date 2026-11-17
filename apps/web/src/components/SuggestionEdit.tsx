import React, { useState } from 'react';
import { Suggestion, SuggestionOverrides } from '@life-logger/domain';
import {
  acceptSuggestion,
  editSuggestion as apiEditSuggestion,
  rejectSuggestion,
} from '../api.js';

interface SuggestionEditProps {
  suggestion?: Suggestion;
  isOpen: boolean;
  onClose: () => void;
  onSuggestionUpdated: () => void;
}

export const SuggestionEdit: React.FC<SuggestionEditProps> = ({
  suggestion,
  isOpen,
  onClose,
  onSuggestionUpdated,
}) => {
  const [editing, setEditing] = useState(false);
  const [overrides, setOverrides] = useState<SuggestionOverrides>({
    title: suggestion?.proposed.title ?? '',
    startAt: suggestion?.proposed.startAt ?? '',
    endAt: suggestion?.proposed.endAt ?? undefined,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed the form whenever the target suggestion changes.
  React.useEffect(() => {
    if (suggestion) {
      setOverrides({
        title: suggestion.proposed.title,
        startAt: suggestion.proposed.startAt,
        endAt: suggestion.proposed.endAt ?? undefined,
      });
    }
  }, [suggestion?.id]);

  const handleEdit = async () => {
    if (!suggestion) return;
    setLoading(true);
    setError(null);
    try {
      await apiEditSuggestion(suggestion.id, overrides);
      onSuggestionUpdated();
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to edit suggestion');
    } finally {
      setLoading(false);
    }
  };

  const handleAccept = async () => {
    if (!suggestion) return;
    setLoading(true);
    setError(null);
    try {
      await acceptSuggestion(suggestion.id, overrides);
      onSuggestionUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to accept suggestion');
    } finally {
      setLoading(false);
    }
  };

  const handleReject = async () => {
    if (!suggestion) return;
    setLoading(true);
    setError(null);
    try {
      await rejectSuggestion(suggestion.id);
      onSuggestionUpdated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reject suggestion');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen || !suggestion) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(2, 6, 23, 0.82)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
        zIndex: 100,
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '560px',
          maxHeight: '90vh',
          overflowY: 'auto',
          backgroundColor: '#0f172a',
          border: '1px solid #334155',
          borderRadius: '16px',
          padding: '28px',
          boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
          <h2 style={{ margin: 0, fontSize: '1.4rem', color: '#f8fafc' }}>
            Edit Suggestion
          </h2>
          <button
            type="button"
            style={{
              background: 'transparent',
              border: 'none',
              color: '#94a3b8',
              fontSize: '1.6rem',
              lineHeight: 1,
              cursor: 'pointer',
              padding: 0,
            }}
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: '#450a0a',
              border: '1px solid #7f1d1d',
              color: '#f87171',
              padding: '10px 14px',
              borderRadius: '8px',
              marginBottom: '16px',
              fontSize: '0.85rem',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ marginBottom: '20px' }}>
          <label
            style={{
              display: 'block',
              marginBottom: '6px',
              fontSize: '0.7rem',
              fontWeight: 600,
              letterSpacing: '0.05em',
              textTransform: 'uppercase',
              color: '#94a3b8',
            }}
          >
            Title
          </label>
          <input
            type="text"
            value={overrides.title}
            onChange={(e) => setOverrides({ ...overrides, title: e.target.value })}
            disabled={loading}
            style={{
              width: '100%',
              backgroundColor: '#1e293b',
              border: '1px solid #334155',
              borderRadius: '8px',
              color: '#f8fafc',
              padding: '11px 14px',
              fontSize: '0.95rem',
              fontFamily: 'inherit',
            }}
          />
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '16px',
            marginBottom: '20px',
          }}
        >
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: '#94a3b8',
              }}
            >
              Start time
            </label>
            <input
              type="datetime-local"
              value={overrides.startAt ? new Date(overrides.startAt).toISOString().slice(0, 16) : ''}
              onChange={(e) =>
                setOverrides({ ...overrides, startAt: `${e.target.value}:00.000Z` })}
              disabled={loading}
              style={{
                width: '100%',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#f8fafc',
                padding: '11px 14px',
                fontSize: '0.95rem',
                fontFamily: 'inherit',
              }}
            />
          </div>
          <div>
            <label
              style={{
                display: 'block',
                marginBottom: '6px',
                fontSize: '0.7rem',
                fontWeight: 600,
                letterSpacing: '0.05em',
                textTransform: 'uppercase',
                color: '#94a3b8',
              }}
            >
              End time
            </label>
            <input
              type="datetime-local"
              value={overrides.endAt ? new Date(overrides.endAt).toISOString().slice(0, 16) : ''}
              onChange={(e) =>
                setOverrides({
                  ...overrides,
                  endAt: e.target.value ? `${e.target.value}:00.000Z` : null,
                })}
              disabled={loading}
              style={{
                width: '100%',
                backgroundColor: '#1e293b',
                border: '1px solid #334155',
                borderRadius: '8px',
                color: '#f8fafc',
                padding: '11px 14px',
                fontSize: '0.95rem',
                fontFamily: 'inherit',
              }}
            />
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            gap: '10px',
            marginTop: '24px',
            justifyContent: 'flex-end',
          }}
        >
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              disabled={loading}
              style={{
                backgroundColor: '#818cf8',
                color: '#1e1b4b',
                border: 'none',
                borderRadius: '8px',
                padding: '10px 20px',
                fontWeight: 700,
                fontSize: '0.82rem',
                cursor: 'pointer',
              }}
            >
              Edit
            </button>
          )}
          {editing && (
            <>
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={loading}
                style={{
                  backgroundColor: '#334155',
                  color: '#cbd5e1',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleEdit}
                disabled={loading}
                style={{
                  backgroundColor: '#818cf8',
                  color: '#1e1b4b',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '10px 20px',
                  fontWeight: 700,
                  fontSize: '0.82rem',
                  cursor: 'pointer',
                }}
              >
                {loading ? 'Saving…' : 'Save Edit'}
              </button>
            </>
          )}
          <button
            type="button"
            onClick={handleAccept}
            disabled={loading || editing}
            style={{
              backgroundColor: '#34d399',
              color: '#064e3b',
              border: 'none',
              borderRadius: '8px',
              padding: '10px 20px',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
              marginRight: '10px',
            }}
          >
            {loading ? 'Accepting…' : 'Accept'}
          </button>
          <button
            type="button"
            onClick={handleReject}
            disabled={loading || editing}
            style={{
              backgroundColor: 'transparent',
              color: '#f87171',
              border: '1px solid #7f1d1d',
              borderRadius: '8px',
              padding: '10px 20px',
              fontWeight: 700,
              fontSize: '0.82rem',
              cursor: 'pointer',
            }}
          >
            Reject
          </button>
        </div>

        <div style={{ marginTop: '16px', fontSize: '0.8rem', color: '#94a3b8' }}>
          <p style={{ margin: 0 }}>
            Source: {suggestion.source} &nbsp;|&nbsp; Confidence: {Math.round(suggestion.confidence * 100)}%
          </p>
          {suggestion.proposed.notes && (
            <p style={{ margin: '8px 0 0', color: '#cbd5e1' }}>
              {suggestion.proposed.notes}
            </p>
          )}
        </div>
      </div>
    </div>
  );
};
