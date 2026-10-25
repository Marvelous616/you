import React, { useMemo, useState } from 'react';
import {
  Day,
  Event,
  EventTag,
  JournalEntry,
  Marker,
  Person,
  Suggestion,
  SuggestionOverrides,
  Tag,
  TimelineGap,
  computeTimelineLanes,
  parseQuickEntry,
} from '@life-logger/domain';
import { MarkerItem } from './MarkerItem.js';
import { SuggestionInbox } from './SuggestionInbox.js';
import type { CalendarImportResult } from '../api.js';

interface TimelineProps {
  day: Day | null;
  events: Event[];
  eventTags: EventTag[];
  markers: Marker[];
  journalEntries: JournalEntry[];
  tags: Tag[];
  people: Person[];
  gaps: TimelineGap[];
  suggestions: Suggestion[];
  coverage: number;
  isLoading: boolean;
  onRefresh: () => void;
  onWake: () => Promise<void>;
  onQuickEntry: (text: string) => Promise<void>;
  onOpenReview: () => void;
  onAcceptSuggestion: (suggestionId: string) => Promise<void>;
  onRejectSuggestion: (suggestionId: string) => Promise<void>;
  onEditSuggestion: (
    suggestionId: string,
    overrides: SuggestionOverrides
  ) => Promise<void>;
  onImportCalendar: (ics: string) => Promise<CalendarImportResult>;
}

function formatClock(iso?: string): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes: number): string {
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const rest = Math.round(minutes % 60);
    return rest > 0 ? `${hours}h ${rest}m` : `${hours}h`;
  }
  return `${Math.round(minutes)}m`;
}

export const Timeline: React.FC<TimelineProps> = ({
  day,
  events,
  eventTags,
  markers,
  journalEntries,
  tags,
  people,
  gaps,
  suggestions,
  coverage,
  isLoading,
  onRefresh,
  onWake,
  onQuickEntry,
  onOpenReview,
  onAcceptSuggestion,
  onRejectSuggestion,
  onEditSuggestion,
  onImportCalendar,
}) => {
  const [quickText, setQuickText] = useState('');
  const [quickError, setQuickError] = useState<string | null>(null);
  const [savingQuick, setSavingQuick] = useState(false);
  const [waking, setWaking] = useState(false);

  const preview = useMemo(
    () => (quickText.trim() ? parseQuickEntry(quickText, new Date()) : null),
    [quickText]
  );

  const tagById = useMemo(() => {
    const map = new Map<string, Tag>();
    for (const tag of tags) map.set(tag.id, tag);
    return map;
  }, [tags]);

  const tagsForEvent = (eventId: string): string[] =>
    eventTags
      .filter((link) => link.eventId === eventId)
      .map((link) => tagById.get(link.tagId)?.path ?? link.tagId);

  const lanes = computeTimelineLanes(events);
  const laneCount = lanes.reduce((max, item) => Math.max(max, item.totalLanes), 1) || 1;

  const nowMs = Date.now();
  const eventStarts = events.map((event) => new Date(event.startAt).getTime());
  const fallbackStart = eventStarts.length > 0 ? Math.min(...eventStarts) : nowMs;
  const windowStartMs = day?.wakeAt
    ? new Date(day.wakeAt).getTime()
    : Math.min(fallbackStart, nowMs - 60 * 60 * 1000);
  const windowEndMs = day?.sleepAt ? new Date(day.sleepAt).getTime() : nowMs;
  const spanMs = Math.max(windowEndMs - windowStartMs, 60 * 60 * 1000);

  const handleQuickSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!quickText.trim() || savingQuick) return;
    setSavingQuick(true);
    setQuickError(null);
    try {
      await onQuickEntry(quickText);
      setQuickText('');
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : 'Failed to save quick entry');
    } finally {
      setSavingQuick(false);
    }
  };

  const handleWake = async () => {
    setWaking(true);
    try {
      await onWake();
    } finally {
      setWaking(false);
    }
  };

  const positionStart = (startMs: number): number =>
    Math.max(0, Math.min(100, ((startMs - windowStartMs) / spanMs) * 100));
  const positionWidth = (startMs: number, endMs: number): number => {
    const left = positionStart(startMs);
    return Math.max(0.7, Math.min(100 - left, ((endMs - startMs) / spanMs) * 100));
  };

  return (
    <div style={styles.page}>
      <header style={styles.header}>
        <div>
          <h1 style={styles.title}>Life Logger</h1>
          <div style={styles.subtitle}>
            {day ? `${day.localDate} · ${day.timezone}` : 'Loading day…'}
          </div>
        </div>
        <div style={styles.headerActions}>
          {day && (
            <span style={styles.fidelityPill}>{day.reviewStatus === 'completed' ? day.fidelity : 'open'}</span>
          )}
          <button style={styles.secondaryButton} onClick={onRefresh} disabled={isLoading}>
            {isLoading ? 'Refreshing…' : 'Refresh'}
          </button>
          <button style={styles.reviewButton} onClick={onOpenReview} disabled={!day}>
            {day?.reviewStatus === 'completed' ? 'Reopen Review' : 'Start Day Review'}
          </button>
        </div>
      </header>

      <section style={styles.card}>
        <div style={styles.summaryRow}>
          <div>
            <div style={styles.summaryTitle}>
              {day?.wakeAt ? `Awake since ${formatClock(day.wakeAt)}` : 'Wake time not set'}
            </div>
            <div style={styles.summaryMeta}>
              {Math.round(coverage * 100)}% of waking hours covered · {gaps.length}{' '}
              {gaps.length === 1 ? 'gap' : 'gaps'} · {events.length}{' '}
              {events.length === 1 ? 'event' : 'events'}
            </div>
          </div>
          {!day?.wakeAt && (
            <button style={styles.wakeButton} onClick={handleWake} disabled={waking || !day}>
              {waking ? 'Starting…' : 'WAKE UP'}
            </button>
          )}
        </div>

        <div style={styles.coverageTrack}>
          <div
            style={{
              ...styles.coverageFill,
              width: `${Math.round(Math.min(1, coverage) * 100)}%`,
            }}
          />
        </div>

        <div style={styles.timelineFrame}>
          <div
            style={{
              ...styles.timelineInner,
              height: `${Math.max(86, 10 + laneCount * 38)}px`,
            }}
          >
            {day?.wakeAt && gaps.map((gap) => {
              const startMs = new Date(gap.startAt).getTime();
              const endMs = new Date(gap.endAt).getTime();
              return (
                <div
                  key={`gap-${gap.startAt}`}
                  title={`Unlogged ${formatClock(gap.startAt)}–${formatClock(gap.endAt)}`}
                  style={{
                    ...styles.gapBlock,
                    left: `${positionStart(startMs)}%`,
                    width: `${positionWidth(startMs, endMs)}%`,
                  }}
                />
              );
            })}

            {lanes.map(({ event, laneIndex }) => {
              const startMs = new Date(event.startAt).getTime();
              const endMs = event.endAt ? new Date(event.endAt).getTime() : startMs;
              const paths = tagsForEvent(event.id);
              return (
                <div
                  key={event.id}
                  title={`${event.title} (${formatClock(event.startAt)}–${formatClock(event.endAt)})`}
                  style={{
                    ...styles.eventBlock,
                    left: `${positionStart(startMs)}%`,
                    width: `${positionWidth(startMs, endMs)}%`,
                    top: 10 + laneIndex * 38,
                  }}
                >
                  <span style={styles.eventBlockTitle}>{event.title}</span>
                  <span style={styles.eventBlockTime}>
                    {formatClock(event.startAt)}
                    {event.endAt ? `–${formatClock(event.endAt)}` : ''}
                  </span>
                  {paths.length > 0 && (
                    <span style={styles.eventBlockTags}>#{paths.join(' #')}</span>
                  )}
                </div>
              );
            })}

            {!day?.wakeAt && events.length === 0 && (
              <div style={styles.timelineEmpty}>
                Set your wake time or log a quick entry to start today's timeline.
              </div>
            )}
          </div>
        </div>

        <div style={styles.axis}>
          <span>{formatClock(new Date(windowStartMs).toISOString())}</span>
          <span>{formatClock(new Date((windowStartMs + windowEndMs) / 2).toISOString())}</span>
          <span>{formatClock(new Date(windowEndMs).toISOString())}</span>
        </div>

        {gaps.length > 0 && day?.wakeAt && (
          <div style={styles.gapList}>
            {gaps.slice(0, 3).map((gap) => (
              <span key={`gap-chip-${gap.startAt}`} style={styles.gapChip}>
                Gap {formatClock(gap.startAt)}–{formatClock(gap.endAt)} ·{' '}
                {formatDuration(gap.durationMinutes)}
              </span>
            ))}
            {gaps.length > 3 && <span style={styles.gapChip}>+{gaps.length - 3} more</span>}
          </div>
        )}
      </section>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>QUICK ENTRY</h2>
        <form onSubmit={handleQuickSubmit} style={styles.quickForm}>
          <input
            style={styles.quickInput}
            placeholder="lunch with @rahul at 1pm #food/lunch"
            value={quickText}
            onChange={(event) => setQuickText(event.target.value)}
          />
          <button type="submit" style={styles.quickButton} disabled={!quickText.trim() || savingQuick}>
            {savingQuick ? 'Saving…' : 'LOG'}
          </button>
        </form>
        {(tags.length > 0 || people.length > 0) && (
          <div style={styles.suggestions}>
            {tags.slice(0, 5).map((tag) => (
              <button
                key={`suggest-tag-${tag.id}`}
                type="button"
                style={styles.tagSuggestion}
                onClick={() =>
                  setQuickText((previous) => `${previous} #${tag.path} `.trimStart())
                }
              >
                #{tag.path}
              </button>
            ))}
            {people.slice(0, 4).map((person) => (
              <button
                key={`suggest-person-${person.id}`}
                type="button"
                style={styles.personSuggestion}
                onClick={() =>
                  setQuickText((previous) => `${previous} @${person.displayName} `.trimStart())
                }
              >
                @{person.displayName}
              </button>
            ))}
          </div>
        )}
        {preview && (
          <div style={styles.previewRow}>
            <span style={styles.previewTitle}>“{preview.title}”</span>
            <span style={styles.previewTime}>
              {formatClock(preview.startAt)}
              {preview.endAt ? `–${formatClock(preview.endAt)}` : ''}
            </span>
            {preview.tagPaths.map((path) => (
              <span key={`preview-tag-${path}`} style={styles.tagChip}>
                #{path}
              </span>
            ))}
            {preview.peopleNames.map((name) => (
              <span key={`preview-person-${name}`} style={styles.personChip}>
                @{name}
              </span>
            ))}
          </div>
        )}
        {quickError && <div style={styles.quickError}>{quickError}</div>}
      </section>

      <SuggestionInbox
        suggestions={suggestions}
        isLoading={isLoading}
        onAccept={onAcceptSuggestion}
        onReject={onRejectSuggestion}
        onEdit={onEditSuggestion}
        onImportCalendar={onImportCalendar}
      />

      <div style={styles.columns}>
        <section style={styles.column}>
          <h2 style={styles.cardTitle}>EVENTS ({events.length})</h2>
          {events.length === 0 ? (
            <p style={styles.empty}>No events logged. Try “read #reading for 45m”.</p>
          ) : (
            events.map((event) => {
              const paths = tagsForEvent(event.id);
              return (
                <div key={event.id} style={styles.eventRow}>
                  <div style={styles.eventRowTime}>
                    {formatClock(event.startAt)}
                    <div style={styles.eventRowTimeEnd}>
                      {event.endAt ? formatClock(event.endAt) : 'point'}
                    </div>
                  </div>
                  <div style={styles.eventRowBody}>
                    <div style={styles.eventRowTitle}>{event.title}</div>
                    <div style={styles.eventRowMeta}>
                      <span style={styles.sourceBadge}>{event.source}</span>
                      {paths.map((path) => (
                        <span key={`event-tag-${event.id}-${path}`} style={styles.tagChip}>
                          #{path}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </section>

        <section style={styles.column}>
          <h2 style={styles.cardTitle}>JOURNAL</h2>
          {journalEntries.length === 0 ? (
            <p style={styles.empty}>No reflection yet. The evening review will prompt you.</p>
          ) : (
            journalEntries.map((entry) => (
              <div key={entry.id} style={styles.journalCard}>
                <p style={styles.journalBody}>{entry.body}</p>
                <div style={styles.journalMeta}>{formatClock(entry.writtenAt)}</div>
              </div>
            ))
          )}
        </section>
      </div>

      <section style={styles.card}>
        <h2 style={styles.cardTitle}>MARKERS ({markers.length})</h2>
        {markers.length === 0 ? (
          <p style={styles.empty}>No markers recorded for this day yet.</p>
        ) : (
          markers.map((marker) => <MarkerItem key={marker.id} marker={marker} />)
        )}
      </section>
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  page: {
    maxWidth: '960px',
    margin: '0 auto',
    padding: '32px 20px 60px',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    flexWrap: 'wrap',
    marginBottom: '24px',
    paddingBottom: '16px',
    borderBottom: '1px solid #334155',
  },
  title: {
    margin: 0,
    fontSize: '1.75rem',
    fontWeight: 700,
    color: '#f8fafc',
  },
  subtitle: {
    color: '#94a3b8',
    fontSize: '0.9rem',
    marginTop: '4px',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    flexWrap: 'wrap',
  },
  fidelityPill: {
    backgroundColor: '#334155',
    color: '#cbd5e1',
    borderRadius: '999px',
    padding: '5px 12px',
    fontSize: '0.7rem',
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase',
  },
  secondaryButton: {
    padding: '9px 16px',
    borderRadius: '6px',
    backgroundColor: '#334155',
    color: '#e2e8f0',
    border: 'none',
    fontWeight: 600,
    fontSize: '0.82rem',
    cursor: 'pointer',
  },
  reviewButton: {
    padding: '9px 16px',
    borderRadius: '6px',
    backgroundColor: '#e2e8f0',
    color: '#0f172a',
    border: 'none',
    fontWeight: 700,
    fontSize: '0.82rem',
    cursor: 'pointer',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: '14px',
    padding: '20px',
    marginBottom: '20px',
  },
  summaryRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: '16px',
    marginBottom: '14px',
  },
  summaryTitle: {
    color: '#f8fafc',
    fontSize: '1rem',
    fontWeight: 600,
  },
  summaryMeta: {
    color: '#94a3b8',
    fontSize: '0.8rem',
    marginTop: '4px',
  },
  wakeButton: {
    backgroundColor: '#e2e8f0',
    color: '#0f172a',
    border: 'none',
    borderRadius: '6px',
    padding: '10px 16px',
    fontWeight: 700,
    fontSize: '0.78rem',
    letterSpacing: '0.05em',
    cursor: 'pointer',
  },
  coverageTrack: {
    height: '6px',
    backgroundColor: '#0f172a',
    borderRadius: '999px',
    overflow: 'hidden',
    marginBottom: '18px',
  },
  coverageFill: {
    height: '100%',
    backgroundColor: '#cbd5e1',
    borderRadius: '999px',
    transition: 'width 0.3s ease',
  },
  timelineFrame: {
    backgroundColor: '#0f172a',
    borderRadius: '10px',
    padding: '10px',
    overflow: 'hidden',
  },
  timelineInner: {
    position: 'relative',
    minHeight: '86px',
  },
  gapBlock: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
    borderLeft: '1px dashed rgba(148, 163, 184, 0.55)',
    borderRight: '1px dashed rgba(148, 163, 184, 0.55)',
    borderRadius: '4px',
  },
  eventBlock: {
    position: 'absolute',
    height: '32px',
    backgroundColor: '#475569',
    border: '1px solid #64748b',
    borderRadius: '6px',
    padding: '3px 7px',
    boxSizing: 'border-box',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    gap: '1px',
  },
  eventBlockTitle: {
    color: '#f8fafc',
    fontSize: '0.72rem',
    fontWeight: 700,
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  eventBlockTime: {
    color: '#cbd5e1',
    fontSize: '0.62rem',
    whiteSpace: 'nowrap',
  },
  eventBlockTags: {
    color: '#94a3b8',
    fontSize: '0.6rem',
    whiteSpace: 'nowrap',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  timelineEmpty: {
    color: '#64748b',
    fontStyle: 'italic',
    fontSize: '0.82rem',
    textAlign: 'center',
    paddingTop: '32px',
  },
  axis: {
    display: 'flex',
    justifyContent: 'space-between',
    color: '#64748b',
    fontSize: '0.7rem',
    marginTop: '8px',
    padding: '0 2px',
  },
  gapList: {
    display: 'flex',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '14px',
  },
  gapChip: {
    backgroundColor: 'rgba(148, 163, 184, 0.14)',
    border: '1px solid rgba(148, 163, 184, 0.32)',
    color: '#e2e8f0',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '0.7rem',
  },
  cardTitle: {
    margin: '0 0 12px',
    color: '#94a3b8',
    fontSize: '0.72rem',
    fontWeight: 700,
    letterSpacing: '0.07em',
  },
  quickForm: {
    display: 'flex',
    gap: '10px',
  },
  quickInput: {
    flex: 1,
    backgroundColor: '#0f172a',
    border: '1px solid #334155',
    borderRadius: '8px',
    padding: '12px 14px',
    color: '#f8fafc',
    fontSize: '0.95rem',
    fontFamily: 'inherit',
  },
  quickButton: {
    backgroundColor: '#e2e8f0',
    color: '#0f172a',
    border: 'none',
    borderRadius: '8px',
    padding: '0 22px',
    fontWeight: 700,
    fontSize: '0.82rem',
    cursor: 'pointer',
  },
  suggestions: {
    display: 'flex',
    gap: '6px',
    flexWrap: 'wrap',
    marginTop: '10px',
  },
  tagSuggestion: {
    backgroundColor: '#334155',
    color: '#cbd5e1',
    border: 'none',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '0.7rem',
    cursor: 'pointer',
  },
  personSuggestion: {
    backgroundColor: '#3f3f46',
    color: '#d4d4d8',
    border: 'none',
    borderRadius: '999px',
    padding: '4px 10px',
    fontSize: '0.7rem',
    cursor: 'pointer',
  },
  previewRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap',
    marginTop: '12px',
  },
  previewTitle: {
    color: '#e2e8f0',
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  previewTime: {
    color: '#cbd5e1',
    fontSize: '0.78rem',
  },
  tagChip: {
    backgroundColor: '#334155',
    color: '#cbd5e1',
    borderRadius: '999px',
    padding: '2px 8px',
    fontSize: '0.7rem',
  },
  personChip: {
    backgroundColor: '#3f3f46',
    color: '#d4d4d8',
    borderRadius: '999px',
    padding: '2px 8px',
    fontSize: '0.7rem',
  },
  quickError: {
    marginTop: '10px',
    color: '#e2e8f0',
    fontSize: '0.8rem',
  },
  columns: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '20px',
    marginBottom: '20px',
  },
  column: {
    backgroundColor: '#1e293b',
    borderRadius: '14px',
    padding: '20px',
  },
  empty: {
    color: '#64748b',
    fontStyle: 'italic',
    fontSize: '0.84rem',
    margin: 0,
  },
  eventRow: {
    display: 'flex',
    gap: '12px',
    padding: '10px 0',
    borderBottom: '1px solid #334155',
  },
  eventRowTime: {
    minWidth: '64px',
    color: '#cbd5e1',
    fontWeight: 700,
    fontSize: '0.82rem',
  },
  eventRowTimeEnd: {
    color: '#64748b',
    fontWeight: 500,
    fontSize: '0.7rem',
    marginTop: '2px',
  },
  eventRowBody: {
    flex: 1,
    minWidth: 0,
  },
  eventRowTitle: {
    color: '#f1f5f9',
    fontSize: '0.9rem',
    fontWeight: 600,
  },
  eventRowMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    flexWrap: 'wrap',
    marginTop: '5px',
  },
  sourceBadge: {
    backgroundColor: '#334155',
    color: '#cbd5e1',
    borderRadius: '999px',
    padding: '2px 7px',
    fontSize: '0.65rem',
    textTransform: 'capitalize',
  },
  journalCard: {
    backgroundColor: '#0f172a',
    borderLeft: '3px solid #64748b',
    borderRadius: '8px',
    padding: '12px 14px',
    marginBottom: '10px',
  },
  journalBody: {
    margin: 0,
    color: '#e2e8f0',
    fontSize: '0.88rem',
    lineHeight: 1.55,
    whiteSpace: 'pre-wrap',
  },
  journalMeta: {
    color: '#64748b',
    fontSize: '0.7rem',
    marginTop: '8px',
  },
};
