import React, { useState } from 'react';
import { Suggestion } from '@life-logger/domain';
import type { SuggestionOverrides } from '@life-logger/domain';
import type { CalendarImportResult } from '../api.js';

interface SuggestionInboxProps {
  suggestions: Suggestion[];
  isLoading: boolean;
  onAccept: (suggestionId: string) => Promise<void>;
  onReject: (suggestionId: string) => Promise<void>;
  onEdit: (suggestionId: string, overrides: SuggestionOverrides) => Promise<void>;
  onImportCalendar: (ics: string) => Promise<CalendarImportResult>;
}

function formatClock(iso?: string): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatRange(startAt: string, endAt?: string): string {
  return endAt ? `${formatClock(startAt)} - ${formatClock(endAt)}` : formatClock(startAt);
}

function toLocalInputValue(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function fromLocalInputValue(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toISOString();
}

function sourceLabel(source: Suggestion['source']): string {
  switch (source) {
    case 'screen_time':
      return 'screen time';
    default:
      return source;
  }
}

export const SuggestionInbox: React.FC<SuggestionInboxProps> = ({
  suggestions,
  isLoading,
  onAccept,
  onReject,
  onEdit,
  onImportCalendar,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editStart, setEditStart] = useState('');
  const [editEnd, setEditEnd] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importMessage, setImportMessage] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);

  const beginEdit = (suggestion: Suggestion): void => {
    setEditingId(suggestion.id);
    setEditTitle(suggestion.proposed.title);
    setEditStart(toLocalInputValue(suggestion.proposed.startAt));
    setEditEnd(toLocalInputValue(suggestion.proposed.endAt));
    setError(null);
  };

  const cancelEdit = (): void => {
    setEditingId(null);
    setError(null);
  };

  const runAction = async (suggestionId: string, action: () => Promise<void>): Promise<void> => {
    setBusyId(suggestionId);
    setError(null);
    try {
      await action();
      setEditingId(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Suggestion action failed');
    } finally {
      setBusyId(null);
    }
  };

  const saveEdit = async (suggestion: Suggestion): Promise<void> => {
    const startAt = fromLocalInputValue(editStart) ?? suggestion.proposed.startAt;
    const endAt = editEnd ? fromLocalInputValue(editEnd) ?? suggestion.proposed.endAt : null;
    await runAction(suggestion.id, () =>
      onEdit(suggestion.id, {
        title: editTitle,
        startAt,
        endAt,
      })
    );
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setImporting(true);
    setError(null);
    setImportMessage(null);
    try {
      const text = await file.text();
      const result = await onImportCalendar(text);
      const importedLabel = result.importedCount === 1 ? 'suggestion' : 'suggestions';
      const skippedCount = result.skipped.length;
      const parts = [
        `Imported ${result.importedCount} ${importedLabel}.`,
        result.duplicateCount > 0
          ? `${result.duplicateCount} already known and not re-proposed.`
          : '',
        skippedCount > 0 ? `${skippedCount} calendar entries were skipped.` : '',
      ];
      setImportMessage(parts.filter(Boolean).join(' '));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Calendar import failed');
    } finally {
      setImporting(false);
    }
  };

  return (
    <section style={styles.card}>
      <div style={styles.headerRow}>
        <h2 style={styles.cardTitle}>SUGGESTIONS ({suggestions.length})</h2>
        <label style={styles.importLabel}>
          {importing ? 'Importing…' : 'Import calendar (.ics)'}
          <input
            type="file"
            accept=".ics,text/calendar"
            onChange={handleFile}
            disabled={importing}
            style={styles.fileInput}
          />
        </label>
      </div>

      {suggestions.length === 0 ? (
        <p style={styles.empty}>
          Nothing waiting. Automated sources propose here, and only you put events on the
          timeline.
        </p>
      ) : (
        suggestions.map((suggestion) => {
          const busy = busyId === suggestion.id;
          const editing = editingId === suggestion.id;
          return (
            <div key={suggestion.id} style={styles.row}>
              <div style={styles.timeColumn}>
                <div style={styles.timeMain}>{formatClock(suggestion.proposed.startAt)}</div>
                <div style={styles.timeEnd}>
                  {suggestion.proposed.endAt
                    ? formatClock(suggestion.proposed.endAt)
                    : 'point'}
                </div>
              </div>

              <div style={styles.body}>
                {editing ? (
                  <div style={styles.editForm}>
                    <label style={styles.field}>
                      <span style={styles.fieldLabel}>Title</span>
                      <input
                        style={styles.input}
                        value={editTitle}
                        onChange={(event) => setEditTitle(event.target.value)}
                      />
                    </label>
                    <div style={styles.editTimes}>
                      <label style={styles.field}>
                        <span style={styles.fieldLabel}>Start</span>
                        <input
                          type="datetime-local"
                          style={styles.input}
                          value={editStart}
                          onChange={(event) => setEditStart(event.target.value)}
                        />
                      </label>
                      <label style={styles.field}>
                        <span style={styles.fieldLabel}>End</span>
                        <input
                          type="datetime-local"
                          style={styles.input}
                          value={editEnd}
                          onChange={(event) => setEditEnd(event.target.value)}
                        />
                      </label>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={styles.rowTitle}>{suggestion.proposed.title}</div>
                    <div style={styles.metaRow}>
                      <span style={styles.sourceBadge}>{sourceLabel(suggestion.source)}</span>
                      <span style={styles.timeRange}>
                        {formatRange(suggestion.proposed.startAt, suggestion.proposed.endAt)}
                      </span>
                      <span style={styles.confidence}>
                        {Math.round(suggestion.confidence * 100)}% confidence
                      </span>
                      {suggestion.proposed.startPrecision === 'approx' && (
                        <span style={styles.approxBadge}>time approximate</span>
                      )}
                    </div>
                    {suggestion.proposed.notes && (
                      <div style={styles.notes}>{suggestion.proposed.notes}</div>
                    )}
                  </>
                )}

                <div style={styles.actionRow}>
                  {editing ? (
                    <>
                      <button
                        style={styles.primaryButton}
                        disabled={busy || isLoading}
                        onClick={() => saveEdit(suggestion)}
                      >
                        {busy ? 'Saving…' : 'Save'}
                      </button>
                      <button style={styles.secondaryButton} onClick={cancelEdit} disabled={busy}>
                        Cancel
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        style={styles.primaryButton}
                        disabled={busy || isLoading}
                        onClick={() =>
                          runAction(suggestion.id, () => onAccept(suggestion.id))
                        }
                      >
                        {busy ? 'Working…' : 'Accept'}
                      </button>
                      <button
                        style={styles.secondaryButton}
                        disabled={busy}
                        onClick={() => beginEdit(suggestion)}
                      >
                        Edit
                      </button>
                      <button
                        style={styles.secondaryButton}
                        disabled={busy}
                        onClick={() =>
                          runAction(suggestion.id, () => onReject(suggestion.id))
                        }
                      >
                        Reject
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}

      {importMessage && <div style={styles.notice}>{importMessage}</div>}
      {error && <div style={styles.error}>{error}</div>}
    </section>
  );
};

const styles: Record<string, React.CSSProperties> = {
  card: {
    backgroundColor: '#1e293b',
    borderRadius: '14px',
    padding: '20px',
    marginBottom: '20px',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
    marginBottom: '12px',
  },
  cardTitle: {
    margin: 0,
    color: '#94a3b8',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.07em',
  },
  importLabel: {
    backgroundColor: '#334155',
    color: '#e2e8f0',
    borderRadius: '6px',
    padding: '7px 12px',
    fontSize: '0.74rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  fileInput: {
    display: 'none',
  },
  empty: {
    color: '#64748b',
    fontStyle: 'italic',
    fontSize: '0.84rem',
    margin: 0,
  },
  row: {
    display: 'flex',
    gap: '14px',
    padding: '14px 0',
    borderTop: '1px solid #334155',
  },
  timeColumn: {
    minWidth: '62px',
  },
  timeMain: {
    color: '#e2e8f0',
    fontWeight: 700,
    fontSize: '0.84rem',
  },
  timeEnd: {
    color: '#64748b',
    fontSize: '0.7rem',
    marginTop: '2px',
  },
  body: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    color: '#f1f5f9',
    fontSize: '0.92rem',
    fontWeight: 600,
  },
  metaRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '7px',
    flexWrap: 'wrap',
    marginTop: '6px',
  },
  sourceBadge: {
    backgroundColor: '#334155',
    color: '#cbd5e1',
    borderRadius: '999px',
    padding: '2px 8px',
    fontSize: '0.65rem',
    textTransform: 'capitalize',
  },
  timeRange: {
    color: '#cbd5e1',
    fontSize: '0.72rem',
  },
  confidence: {
    color: '#64748b',
    fontSize: '0.68rem',
  },
  approxBadge: {
    backgroundColor: '#0f172a',
    color: '#cbd5e1',
    border: '1px solid #334155',
    borderRadius: '999px',
    padding: '2px 8px',
    fontSize: '0.65rem',
  },
  notes: {
    color: '#94a3b8',
    fontSize: '0.76rem',
    marginTop: '7px',
    whiteSpace: 'pre-wrap',
    lineHeight: 1.45,
  },
  actionRow: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '10px',
  },
  primaryButton: {
    backgroundColor: '#e2e8f0',
    color: '#0f172a',
    border: 'none',
    borderRadius: '6px',
    padding: '7px 14px',
    fontWeight: 700,
    fontSize: '0.76rem',
    cursor: 'pointer',
  },
  secondaryButton: {
    backgroundColor: '#334155',
    color: '#e2e8f0',
    border: 'none',
    borderRadius: '6px',
    padding: '7px 14px',
    fontWeight: 600,
    fontSize: '0.76rem',
    cursor: 'pointer',
  },
  editForm: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  editTimes: {
    display: 'flex',
    gap: '10px',
    flexWrap: 'wrap',
  },
  field: {
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    flex: 1,
    minWidth: '160px',
  },
  fieldLabel: {
    color: '#94a3b8',
    fontSize: '0.68rem',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  input: {
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '6px',
    padding: '8px 10px',
    color: '#f8fafc',
    fontSize: '0.82rem',
    fontFamily: 'inherit',
  },
  notice: {
    marginTop: '12px',
    color: '#cbd5e1',
    fontSize: '0.78rem',
  },
  error: {
    marginTop: '12px',
    color: '#e2e8f0',
    fontSize: '0.78rem',
  },
};
