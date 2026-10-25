import React, { useCallback, useEffect, useState } from 'react';
import { TimelineGap, parseQuickEntry } from '@life-logger/domain';
import {
  DayTimeline,
  ReviewInput,
  ReviewResult,
  createEvent,
  fetchActiveDay,
  fetchDayTimeline,
  reviewDay,
  updateDay,
} from './api.js';
import { Timeline } from './components/Timeline.js';
import { GapTemplate, ReviewModal } from './components/ReviewModal.js';

function newId(prefix: string): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  return `${prefix}-${random}`;
}

export const App: React.FC = () => {
  const [timeline, setTimeline] = useState<DayTimeline | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [reviewOpen, setReviewOpen] = useState<boolean>(false);

  const loadData = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const activeDay = await fetchActiveDay(timezone);
      const dayTimeline = await fetchDayTimeline(activeDay.id);
      setTimeline(dayTimeline);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
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
    async (gap: TimelineGap, template: GapTemplate): Promise<TimelineGap[]> => {
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
    [timeline]
  );

  const handleCompleteReview = useCallback(
    async (input: ReviewInput): Promise<ReviewResult> => {
      if (!timeline) throw new Error('No day loaded');
      const result = await reviewDay(timeline.day.id, input);
      const refreshed = await fetchDayTimeline(timeline.day.id);
      setTimeline(refreshed);
      return result;
    },
    [timeline]
  );

  return (
    <div>
      {error && (
        <div style={styles.errorBanner}>
          Server connection notice: {error} (Check if the Fastify server is running on port 4000)
        </div>
      )}
      <Timeline
        day={timeline?.day ?? null}
        events={timeline?.events ?? []}
        tags={timeline?.tags ?? []}
        eventTags={timeline?.eventTags ?? []}
        markers={timeline?.markers ?? []}
        journalEntries={timeline?.journalEntries ?? []}
        people={timeline?.people ?? []}
        gaps={timeline?.gaps ?? []}
        coverage={timeline?.coverage ?? 0}
        isLoading={isLoading}
        onRefresh={loadData}
        onWake={handleWake}
        onQuickEntry={handleQuickEntry}
        onOpenReview={() => setReviewOpen(true)}
      />
      {reviewOpen && timeline && (
        <ReviewModal
          day={timeline.day}
          gaps={timeline.gaps}
          initialJournal={timeline.journalEntries[0]?.body ?? ''}
          onClose={() => setReviewOpen(false)}
          onFillGap={handleFillGap}
          onComplete={handleCompleteReview}
        />
      )}
    </div>
  );
};

const styles: Record<string, React.CSSProperties> = {
  errorBanner: {
    backgroundColor: '#ef4444',
    color: '#fff',
    padding: '10px 16px',
    textAlign: 'center',
    fontSize: '0.9rem',
  },
};
