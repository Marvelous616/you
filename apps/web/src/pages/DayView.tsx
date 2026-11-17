import React, { useCallback, useEffect, useState } from 'react';
import {
  Event,
  Suggestion,
  SuggestionOverrides,
  parseQuickEntry,
} from '@life-logger/domain';
import {
  acceptSuggestion,
  createEvent,
  fetchActiveDay,
  fetchDayTimeline,
  fetchHealth,
  fetchSuggestions,
  rejectSuggestion,
  reviewDay,
  saveJournal,
  updateDay,
  type DayTimeline,
} from '../api.js';
import { Timeline } from '../components/Timeline';
import { QuickEntry } from '../components/QuickEntry';
import { EventList } from '../components/EventList';
import { Markers } from '../components/Markers';
import { Journal } from '../components/Journal';
import { SearchBox } from '../components/SearchBox';
import { ReviewModal } from '../components/ReviewModal';
import { ServerStatus } from '../components/ServerStatus';
import { SuggestionCard } from '../components/SuggestionCard';
import { SuggestionEdit } from '../components/SuggestionEdit';
import { EventDetail } from '../components/EventDetail';
import { Diagnostics } from '../components/Diagnostics';

type Theme = 'light' | 'dark';

function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${random}`;
}

function formatClock(iso?: string): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface DayViewProps {
  theme: Theme;
  onThemeChange: (theme: Theme) => void;
  onSettingsOpen: () => void;
}

export const DayView: React.FC<DayViewProps> = ({
  theme,
  onThemeChange,
  onSettingsOpen,
}) => {
  const [timeline, setTimeline] = useState<DayTimeline | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [journalDraft, setJournalDraft] = useState('');

  // Modals
  const [eventDetailOpen, setEventDetailOpen] = useState(false);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [suggestionEditOpen, setSuggestionEditOpen] = useState(false);
  const [selectedSuggestionId, setSelectedSuggestionId] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const health = await fetchHealth();
      if (!health) throw new Error('Server unreachable');
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const activeDay = await fetchActiveDay(timezone);
      const [dayTimeline, pendingSuggestions] = await Promise.all([
        fetchDayTimeline(activeDay.id),
        fetchSuggestions('pending'),
      ]);
      setTimeline(dayTimeline);
      setSuggestions(pendingSuggestions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load day');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 10000);
    return () => clearInterval(interval);
  }, [loadData]);

  const handleWake = useCallback(async () => {
    if (!timeline) return;
    try {
      await updateDay(timeline.day.id, { wakeAt: new Date().toISOString() });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start day');
    }
  }, [timeline, loadData]);

  const handleQuickEntry = useCallback(
    async (text: string) => {
      if (!timeline) return;
      const now = new Date();
      const parsed = parseQuickEntry(text, now);

      await createEvent({
        event: {
          dayId: timeline.day.id,
          title: parsed.title,
          startAt: parsed.startAt,
          endAt: parsed.endAt,
          startPrecision: parsed.startPrecision,
          endPrecision: parsed.endPrecision,
          source: 'live',
        },
        tagPaths: parsed.tagPaths,
        peopleNames: parsed.peopleNames,
        capture: {
          id: newId('capture'),
          rawText: parsed.rawText,
          capturedAt: parsed.startAt,
          parsedBy: parsed.parsedBy,
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
        },
      });

      await loadData();
    },
    [timeline, loadData]
  );

  const handleFillGap = useCallback(
    async (
      gap: { startAt: string; endAt: string },
      template: { title: string; tagPaths: string[] }
    ) => {
      if (!timeline) return [];
      const now = new Date();

      await createEvent({
        event: {
          dayId: timeline.day.id,
          title: template.title,
          startAt: gap.startAt,
          endAt: gap.endAt,
          startPrecision: 'exact',
          endPrecision: 'exact',
          source: 'backfill',
        },
        tagPaths: template.tagPaths,
        capture: {
          id: newId('capture'),
          rawText: `review: ${template.title} ${gap.startAt} – ${gap.endAt}`,
          capturedAt: gap.startAt,
          parsedBy: 'manual-review',
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          isDeleted: false,
        },
      });

      const refreshed = await fetchDayTimeline(timeline.day.id);
      setTimeline(refreshed);
      return refreshed.gaps;
    },
    [timeline, loadData]
  );

  const handleAcceptSuggestion = useCallback(
    async (suggestionId: string) => {
      await acceptSuggestion(suggestionId);
      await loadData();
    },
    [loadData]
  );

  const handleRejectSuggestion = useCallback(
    async (suggestionId: string) => {
      await rejectSuggestion(suggestionId);
      await loadData();
    },
    [loadData]
  );

  const handleEventUpdated = useCallback(async () => {
    await loadData();
    setEventDetailOpen(false);
    setSelectedEventId(null);
  }, [loadData]);

  const handleEventClick = useCallback((event: Event) => {
    setSelectedEventId(event.id);
    setEventDetailOpen(true);
  }, []);

  const handleSuggestionEdit = useCallback((suggestion: Suggestion) => {
    setSelectedSuggestionId(suggestion.id);
    setSuggestionEditOpen(true);
  }, []);

  const handleSaveJournal = useCallback(async (body: string) => {
    if (!timeline) return;
    await saveJournal(timeline.day.id, body);
    await loadData();
  }, [timeline, loadData]);

  const handleCompleteReview = useCallback(
    async (input: { sleepAt?: string; journalBody?: string }) => {
      if (!timeline) throw new Error('No day loaded');
      const result = await reviewDay(timeline.day.id, input);
      const refreshed = await fetchDayTimeline(timeline.day.id);
      setTimeline(refreshed);
      return result;
    },
    [timeline]
  );

  const handleRetry = useCallback(() => {
    loadData();
  }, [loadData]);

  const day = timeline?.day ?? null;
  const events = timeline?.events ?? [];
  const gaps = timeline?.gaps ?? [];
  const coverage = timeline?.coverage ?? 0;
  const markers = timeline?.markers ?? [];
  const journalEntries = timeline?.journalEntries ?? [];
  const eventTags = timeline?.eventTags ?? [];
  const allTags = timeline?.tags ?? [];
  const allPeople = timeline?.people ?? [];

  return (
    <div className="shell">
      <header className="header">
        <div className="brand">
          <span className="brand-accent">LL</span> Life Logger
        </div>
        <div className="nav">
          <div className="nav-item">
            <span>{day ? day.localDate : '—'}</span>
          </div>
          <ServerStatus onRetry={handleRetry} />
          <button
            type="button"
            className="nav-item"
            onClick={() => onSettingsOpen()}
          >
            Settings
          </button>
          <button
            type="button"
            className="nav-item"
            onClick={() => setDiagnosticsOpen(true)}
          >
            Diagnostics
          </button>
          <button
            type="button"
            className="nav-item"
            onClick={() => onThemeChange(theme === 'light' ? 'dark' : 'light')}
          >
            {theme === 'light' ? 'Dark mode' : 'Light mode'}
          </button>
        </div>
      </header>

      <div className="content">
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
            Server connection notice: {error}
          </div>
        )}

        {!isLoading && day && (
          <>
            <SearchBox
              onEventClick={(eventId) => {
                const event = events.find((e) => e.id === eventId);
                if (event) handleEventClick(event);
              }}
            />

            <div className="card compact">
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '10px' }}>
                <div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 600, letterSpacing: '0.05em', textTransform: 'uppercase', color: '#94a3b8' }}>
                    {day.wakeAt ? `Awake since ${formatClock(day.wakeAt)}` : 'Wake time not set'}
                  </div>
                  <div style={{ fontSize: '0.85rem', color: '#cbd5e1', fontWeight: 600 }}>
                    {Math.round(coverage * 100)}% covered · {gaps.length} gap{gaps.length === 1 ? '' : 's'} · {events.length} event{events.length === 1 ? '' : 's'}
                  </div>
                </div>
                {!day.wakeAt && (
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={handleWake}
                    disabled={!day}
                  >
                    Wake up
                  </button>
                )}
              </div>
              <div className="coverage-track">
                <div className="coverage-fill" style={{ width: `${Math.round(Math.min(1, coverage) * 100)}%` }} />
              </div>
            </div>

            <Timeline
              day={day}
              events={events}
              eventTags={eventTags}
              tags={allTags}
              gaps={gaps}
              onEventClick={handleEventClick}
            />

            <QuickEntry
              tags={allTags.map((t: { id: string; path: string }) => ({ id: t.id, path: t.path }))}
              people={allPeople.map((p: { id: string; displayName: string }) => ({ id: p.id, displayName: p.displayName }))}
              onSubmit={handleQuickEntry}
            />

            <div className="card compact">
              <div className="card-header">
                <h3 className="card-title">Events ({events.length})</h3>
              </div>
              <EventList
                events={events}
                eventTags={eventTags}
                tags={allTags}
                onEventClick={handleEventClick}
              />
            </div>

            <div className="card compact">
              <div className="card-header">
                <h3 className="card-title">Markers ({markers.length})</h3>
              </div>
              <Markers markers={markers} />
            </div>

            <Journal
              entries={journalEntries}
              onSave={handleSaveJournal}
              currentDraft={journalDraft}
              setCurrentDraft={setJournalDraft}
            />
          </>
        )}

        <div className="card compact">
          <div className="card-header">
            <h3 className="card-title">Suggestions ({suggestions.length})</h3>
          </div>
          <div style={{ marginTop: '12px' }}>
            {suggestions.length === 0 ? (
              <p className="empty-state" style={{ textAlign: 'left' }}>
                Nothing waiting. Automated sources propose here, and only you put events on the timeline.
              </p>
            ) : (
              suggestions.map((s) => (
                <div key={s.id} style={{ marginBottom: '12px' }}>
                  <SuggestionCard
                    suggestion={s}
                    busy={false}
                    isLoading={isLoading}
                    onAccept={handleAcceptSuggestion}
                    onReject={handleRejectSuggestion}
                    onEdit={async (_id: string, _overrides: SuggestionOverrides) => {
                      handleSuggestionEdit(s);
                    }}
                  />
                </div>
              ))
            )}
          </div>
        </div>

        {day && (
          <ReviewModal
            day={day}
            gaps={gaps}
            initialJournal={journalEntries[0]?.body ?? ''}
            isOpen={reviewOpen}
            onClose={() => setReviewOpen(false)}
            onFillGap={handleFillGap}
            onComplete={handleCompleteReview}
            busy={isLoading}
          />
        )}

        <EventDetail
          eventId={selectedEventId ?? ''}
          isOpen={eventDetailOpen}
          onClose={() => setEventDetailOpen(false)}
          onEventUpdated={handleEventUpdated}
        />

        <Diagnostics
          isOpen={diagnosticsOpen}
          onClose={() => setDiagnosticsOpen(false)}
        />

        <SuggestionEdit
          suggestion={suggestions.find((s) => s.id === selectedSuggestionId) ?? suggestions[0]}
          isOpen={suggestionEditOpen}
          onClose={() => setSuggestionEditOpen(false)}
          onSuggestionUpdated={loadData}
        />
      </div>

      <footer className="footer">
        Life Logger · schema · sync protocol
      </footer>
    </div>
  );
};
