import React, { useState } from 'react';
import { Day, TimelineGap } from '@life-logger/domain';
import { ReviewInput, ReviewResult } from '../api.js';

export interface GapTemplate {
  label: string;
  title: string;
  tagPaths: string[];
}

const GAP_TEMPLATES: GapTemplate[] = [
  { label: 'Deep Work', title: 'Deep work', tagPaths: ['work/coding'] },
  { label: 'Meal', title: 'Meal', tagPaths: ['food'] },
  { label: 'Rest', title: 'Rest', tagPaths: ['rest'] },
];

interface ReviewModalProps {
  day: Day;
  gaps: TimelineGap[];
  initialJournal: string;
  onClose: () => void;
  onFillGap: (gap: TimelineGap, template: GapTemplate) => Promise<TimelineGap[]>;
  onComplete: (input: ReviewInput) => Promise<ReviewResult>;
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toTimeInput(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function sleepTimeToIso(day: Day, value: string): string | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;

  const candidate = new Date(`${day.localDate}T${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`);

  if (day.wakeAt && candidate.getTime() < new Date(day.wakeAt).getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.toISOString();
}

export const ReviewModal: React.FC<ReviewModalProps> = ({
  day,
  gaps,
  initialJournal,
  onClose,
  onFillGap,
  onComplete,
}) => {
  const [currentGaps, setCurrentGaps] = useState<TimelineGap[]>(gaps);
  const [journal, setJournal] = useState(initialJournal);
  const [sleepTime, setSleepTime] = useState(toTimeInput(day.sleepAt));
  const [busyGap, setBusyGap] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ReviewResult | null>(null);

  const handleFill = async (gap: TimelineGap, template: GapTemplate) => {
    setBusyGap(gap.startAt);
    setError(null);
    try {
      const nextGaps = await onFillGap(gap, template);
      setCurrentGaps(nextGaps);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fill gap');
    } finally {
      setBusyGap(null);
    }
  };

  const handleComplete = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const review = await onComplete({
        sleepAt: sleepTimeToIso(day, sleepTime),
        journalBody: journal.trim() || undefined,
      });
      setResult(review);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete review');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={styles.backdrop} role="dialog" aria-modal="true">
      <div style={styles.panel}>
        {result ? (
          <div style={styles.completion}>
            <div style={styles.confetti}>🎉</div>
            <h2 style={styles.title}>Day complete</h2>
            <div style={styles.fidelity}>{result.fidelity}</div>
            <p style={styles.completionMeta}>
              {Math.round(result.coverage * 100)}% of waking hours covered ·{' '}
              {result.gaps.length} gaps left
            </p>
            <button type="button" style={styles.primary} onClick={onClose}>
              DONE
            </button>
          </div>
        ) : (
          <>
            <div style={styles.headerRow}>
              <div>
                <h2 style={styles.title}>End-of-Day Review</h2>
                <p style={styles.subtitle}>
                  Fill the gaps, capture a reflection, then record sleep.
                </p>
              </div>
              <button type="button" style={styles.close} onClick={onClose} aria-label="Close review">
                ×
              </button>
            </div>

            {error && <div style={styles.error}>{error}</div>}

            <h3 style={styles.label}>UNLOGGED GAPS &gt; 15 MIN</h3>
            {currentGaps.length === 0 ? (
              <p style={styles.empty}>No gaps. Beautifully logged day!</p>
            ) : (
              currentGaps.map((gap) => (
                <div key={`review-gap-${gap.startAt}`} style={styles.gapRow}>
                  <div style={styles.gapInfo}>
                    <div style={styles.gapTime}>
                      {formatClock(gap.startAt)} – {formatClock(gap.endAt)}
                    </div>
                    <div style={styles.gapMeta}>{Math.round(gap.durationMinutes)} min unlogged</div>
                  </div>
                  <div style={styles.templates}>
                    {GAP_TEMPLATES.map((template) => (
                      <button
                        key={template.label}
                        type="button"
                        style={styles.templateButton}
                        disabled={busyGap === gap.startAt}
                        onClick={() => handleFill(gap, template)}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}

            <label style={styles.inputLabel} htmlFor="review-journal">
              Reflections on today?
            </label>
            <textarea
              id="review-journal"
              style={styles.textarea}
              placeholder="What mattered? What did you learn?"
              value={journal}
              onChange={(event) => setJournal(event.target.value)}
            />

            <label style={styles.inputLabel} htmlFor="review-sleep">
              Sleep time
            </label>
            <input
              id="review-sleep"
              type="time"
              style={styles.input}
              value={sleepTime}
              onChange={(event) => setSleepTime(event.target.value)}
            />

            <button
              type="button"
              style={styles.primary}
              disabled={submitting}
              onClick={handleComplete}
            >
              {submitting ? 'COMPLETING…' : 'COMPLETE DAY REVIEW'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  backdrop: {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '20px',
    zIndex: 50,
  },
  panel: {
    width: '100%',
    maxWidth: '620px',
    maxHeight: '90vh',
    overflowY: 'auto',
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '16px',
    padding: '24px',
    boxShadow: '0 24px 64px rgba(0, 0, 0, 0.5)',
  },
  headerRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: '12px',
  },
  title: {
    margin: 0,
    fontSize: '1.4rem',
    color: '#f8fafc',
  },
  subtitle: {
    margin: '6px 0 20px',
    color: '#94a3b8',
    fontSize: '0.85rem',
  },
  close: {
    background: 'transparent',
    border: 'none',
    color: '#94a3b8',
    fontSize: '1.6rem',
    cursor: 'pointer',
    lineHeight: 1,
  },
  label: {
    margin: '0 0 10px',
    color: '#94a3b8',
    fontSize: '0.7rem',
    letterSpacing: '0.06em',
  },
  error: {
    backgroundColor: '#7f1d1d',
    color: '#fecaca',
    padding: '10px 12px',
    borderRadius: '8px',
    fontSize: '0.8rem',
    marginBottom: '14px',
  },
  empty: {
    color: '#64748b',
    fontStyle: 'italic',
    fontSize: '0.85rem',
    margin: '4px 0 18px',
  },
  gapRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '12px',
    flexWrap: 'wrap',
    backgroundColor: '#1e293b',
    borderRadius: '10px',
    padding: '12px 14px',
    marginBottom: '8px',
  },
  gapInfo: {
    minWidth: '150px',
  },
  gapTime: {
    color: '#f8fafc',
    fontWeight: 600,
    fontSize: '0.9rem',
  },
  gapMeta: {
    color: '#f87171',
    fontSize: '0.75rem',
    marginTop: '2px',
  },
  templates: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
  },
  templateButton: {
    backgroundColor: '#1e3a8a',
    color: '#93c5fd',
    border: 'none',
    borderRadius: '6px',
    padding: '7px 10px',
    fontSize: '0.72rem',
    fontWeight: 600,
    cursor: 'pointer',
  },
  inputLabel: {
    display: 'block',
    color: '#cbd5e1',
    fontSize: '0.85rem',
    fontWeight: 600,
    margin: '18px 0 6px',
  },
  textarea: {
    width: '100%',
    minHeight: '90px',
    boxSizing: 'border-box',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#f8fafc',
    padding: '12px',
    fontSize: '0.9rem',
    fontFamily: 'inherit',
    resize: 'vertical',
  },
  input: {
    width: '100%',
    boxSizing: 'border-box',
    backgroundColor: '#1e293b',
    border: '1px solid #334155',
    borderRadius: '8px',
    color: '#f8fafc',
    padding: '11px 12px',
    fontSize: '0.9rem',
    fontFamily: 'inherit',
  },
  primary: {
    width: '100%',
    marginTop: '20px',
    backgroundColor: '#16a34a',
    color: '#fff',
    border: 'none',
    borderRadius: '8px',
    padding: '13px',
    fontSize: '0.9rem',
    fontWeight: 700,
    letterSpacing: '0.04em',
    cursor: 'pointer',
  },
  completion: {
    textAlign: 'center',
    padding: '20px 0',
  },
  confetti: {
    fontSize: '3rem',
  },
  fidelity: {
    color: '#4ade80',
    fontSize: '1.1rem',
    fontWeight: 700,
    textTransform: 'uppercase',
    marginTop: '8px',
  },
  completionMeta: {
    color: '#94a3b8',
    fontSize: '0.85rem',
    marginTop: '10px',
  },
};
