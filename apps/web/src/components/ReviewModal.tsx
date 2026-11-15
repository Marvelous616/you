import React, { useState } from 'react';
import { Day, TimelineGap } from '@life-logger/domain';
import { ReviewInput, ReviewResult } from '../api.js';

interface GapTemplate {
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
  isOpen: boolean;
  onClose: () => void;
  onFillGap: (gap: TimelineGap, template: GapTemplate) => Promise<TimelineGap[]>;
  onComplete: (input: ReviewInput) => Promise<ReviewResult>;
  busy: boolean;
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
  isOpen,
  onClose,
  onFillGap,
  onComplete,
  busy,
}) => {
  if (!isOpen) return null;

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
    <div className="review-backdrop" role="dialog" aria-modal="true">
      <div className="review-panel">
        {result ? (
          <div className="review-completion">
            <div className="review-rule" />
            <h2>Day complete</h2>
            <div className="review-fidelity">{result.fidelity}</div>
            <p className="review-meta">
              {Math.round(result.coverage * 100)}% of waking hours covered · {result.gaps.length} gaps left
            </p>
            <button type="button" className="btn btn-primary btn-full" onClick={onClose}>
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="review-header">
              <div>
                <h2>End-of-Day Review</h2>
                <p style={{ margin: '6px 0 0', color: '#94a3b8', fontSize: '0.85rem' }}>
                  Fill the gaps, capture a reflection, then record sleep.
                </p>
              </div>
              <button type="button" className="btn-icon" title="Close" onClick={onClose} aria-label="Close review">
                ×
              </button>
            </div>

            {error && <div className="error-text">{error}</div>}

            <h3 style={{ margin: '0 0 10px', fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: '#94a3b8' }}>
              Unlogged gaps &gt; 15 min
            </h3>
            {currentGaps.length === 0 ? (
              <p className="empty-state" style={{ textAlign: 'left' }}>No gaps. Beautifully logged day!</p>
            ) : (
              currentGaps.map((gap) => (
                <div key={`gap-${gap.startAt}`} className="gap-row">
                  <div className="gap-info">
                    <div className="gap-time">{formatClock(gap.startAt)} – {formatClock(gap.endAt)}</div>
                    <div className="gap-meta">{Math.round(gap.durationMinutes)} min unlogged</div>
                  </div>
                  <div className="gap-templates">
                    {GAP_TEMPLATES.map((template) => (
                      <button
                        key={template.label}
                        type="button"
                        className="btn-template"
                        disabled={busyGap === gap.startAt || busy}
                        onClick={() => handleFill(gap, template)}
                      >
                        {template.label}
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}

            <div style={{ margin: '20px 0' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#94a3b8' }}>
                Reflections on today?
              </label>
              <textarea
                className="textarea"
                placeholder="What mattered? What did you learn?"
                value={journal}
                onChange={(e) => setJournal(e.target.value)}
                rows={4}
              />
            </div>

            <div style={{ margin: '20px 0' }}>
              <label style={{ display: 'block', marginBottom: '6px', fontSize: '0.7rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#94a3b8' }}>
                Sleep time
              </label>
              <input
                type="time"
                className="input"
                value={sleepTime}
                onChange={(e) => setSleepTime(e.target.value)}
              />
            </div>

            <button type="button" className="btn btn-primary btn-full" disabled={submitting || busy} onClick={handleComplete}>
              {submitting ? 'Completing…' : 'Complete Day Review'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};
