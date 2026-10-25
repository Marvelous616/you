import React, { useState, useEffect, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  FlatList,
  SafeAreaView,
  StatusBar,
  Vibration,
  Modal,
  ScrollView,
} from 'react-native';
import {
  Day,
  Event,
  JournalEntry,
  Marker,
  Person,
  Suggestion,
  SuggestionOverrides,
  Tag,
  TimelineGap,
  acceptSuggestion,
  buildEventFromQuickEntry,
  buildEventFromSuggestion,
  calculateDayCoverage,
  calendarEventsToSuggestions,
  completeDayReview,
  computeTimelineLanes,
  editSuggestion,
  findTimelineGaps,
  getLocalDateString,
  parseIcsCalendar,
  parseQuickEntry,
  rejectSuggestion,
  resolvePeopleForEvent,
  resolveTagsForEvent,
  wakeDay,
} from '@life-logger/domain';
import { InMemoryMobileStorage } from './src/local-store';
import { MobileSyncClient } from './src/sync-client';

const storage = new InMemoryMobileStorage();
const syncClient = new MobileSyncClient(storage, {
  serverUrl: 'http://10.0.2.2:4000', // standard Android emulator host alias
  clientId: 'android-companion-1',
});

const MIN_GAP_MINUTES = 15;

function formatClock(iso?: string): string {
  if (!iso) return '--:--';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toTimeInput(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

function timeOnDate(iso: string, timeText: string): string | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(timeText.trim());
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;

  const base = new Date(iso);
  const candidate = new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    hours,
    minutes,
    0,
    0
  );
  return candidate.toISOString();
}

function parseSleepTime(value: string, day: Day, now: Date): string | undefined {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return undefined;

  const candidate = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    hours,
    minutes,
    0,
    0
  );

  if (day.wakeAt && candidate.getTime() < new Date(day.wakeAt).getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }

  return candidate.toISOString();
}

function buildDay(now: Date): Day {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const localDate = getLocalDateString(now, timezone);
  return {
    id: `day-${localDate}`,
    localDate,
    timezone,
    reviewStatus: 'unreviewed',
    fidelity: 'skipped',
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    isDeleted: false,
  };
}

interface PersistEventInput {
  title: string;
  startAt: string;
  endAt?: string;
  tagPaths?: string[];
  peopleNames?: string[];
  capture?: {
    rawText: string;
    capturedAt: string;
    parsedBy: string;
  };
}

interface PersistEventResult {
  event: Event;
  events: Event[];
  saveDurationMs: number;
}

export default function App() {
  const [day, setDay] = useState<Day | null>(null);
  const [events, setEvents] = useState<Event[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
  const [markers, setMarkers] = useState<Marker[]>([]);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);

  const [icsText, setIcsText] = useState('');
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [suggestionError, setSuggestionError] = useState<string | null>(null);
  const [suggestionBusyId, setSuggestionBusyId] = useState<string | null>(null);
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(null);
  const [suggestionTitleDraft, setSuggestionTitleDraft] = useState('');
  const [suggestionStartDraft, setSuggestionStartDraft] = useState('');
  const [suggestionEndDraft, setSuggestionEndDraft] = useState('');

  const [quickText, setQuickText] = useState('');
  const [noteText, setNoteText] = useState('');
  const [pendingCount, setPendingCount] = useState(0);
  const [lastSaveLatency, setLastSaveLatency] = useState<number | null>(null);
  const [syncStatus, setSyncStatus] = useState<string>('Ready');

  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewGaps, setReviewGaps] = useState<TimelineGap[]>([]);
  const [journalDraft, setJournalDraft] = useState('');
  const [sleepDraft, setSleepDraft] = useState('');
  const [reviewResult, setReviewResult] = useState<{
    fidelity: Day['fidelity'];
    coverage: number;
    gapsRemaining: number;
  } | null>(null);

  const refreshOutbox = useCallback(async () => {
    const count = await storage.getPendingCount();
    setPendingCount(count);
  }, []);

  const loadDayData = useCallback(async () => {
    const now = new Date();
    let current = await storage.getDay(buildDay(now).id);

    if (!current) {
      current = buildDay(now);
      await storage.saveDayAndEnqueueOutbox(current);
    }

    const [dayEvents, allTags, allPeople, journal, markerList, pendingSuggestions] =
      await Promise.all([
        storage.getEventsForDay(current.id),
        storage.getTags(),
        storage.getPeople(),
        storage.getJournalEntries(current.id),
        storage.getMarkerList(),
        storage.getPendingSuggestions(),
      ]);

    setDay(current);
    setEvents(dayEvents);
    setTags(allTags);
    setPeople(allPeople);
    setJournalEntries(journal);
    setMarkers(markerList.filter((marker) => !marker.dayId || marker.dayId === current.id));
    setSuggestions(pendingSuggestions);
    await refreshOutbox();
  }, [refreshOutbox]);

  useEffect(() => {
    loadDayData();
  }, [loadDayData]);

  const persistEvent = useCallback(
    async (input: PersistEventInput): Promise<PersistEventResult | null> => {
      if (!day) return null;

      const now = new Date();
      const timestamp = now.toISOString();
      const eventId = `event-phone-${Date.now()}`;

      const event: Event = {
        id: eventId,
        dayId: day.id,
        title: input.title,
        startAt: input.startAt,
        endAt: input.endAt,
        startPrecision: 'exact',
        endPrecision: 'exact',
        source: 'live',
        createdAt: timestamp,
        updatedAt: timestamp,
        isDeleted: false,
      };

      const resolvedTags = resolveTagsForEvent(event.id, input.tagPaths ?? [], tags, { now });
      const resolvedPeople = resolvePeopleForEvent(event.id, input.peopleNames ?? [], people, {
        now,
      });

      const capture = input.capture
        ? {
            id: `capture-phone-${Date.now()}`,
            rawText: input.capture.rawText,
            capturedAt: input.capture.capturedAt,
            parsedBy: input.capture.parsedBy,
            createdAt: timestamp,
            updatedAt: timestamp,
            isDeleted: false,
          }
        : undefined;

      const { saveDurationMs } = await storage.saveQuickEntryAndEnqueueOutbox({
        event,
        capture,
        tags: resolvedTags.tags,
        eventTags: resolvedTags.eventTags,
        people: resolvedPeople.people,
        participants: resolvedPeople.participants,
      });

      const nextEvents = [...events, event].sort((a, b) => a.startAt.localeCompare(b.startAt));
      setEvents(nextEvents);
      if (resolvedTags.tags.length > 0) {
        setTags((previous) => [...previous, ...resolvedTags.tags]);
      }
      if (resolvedPeople.people.length > 0) {
        setPeople((previous) => [...previous, ...resolvedPeople.people]);
      }
      await refreshOutbox();

      return { event, events: nextEvents, saveDurationMs };
    },
    [day, events, people, refreshOutbox, tags]
  );

  const handleQuickEntry = async () => {
    if (!day || quickText.trim().length === 0) return;

    const now = new Date();
    const parsed = parseQuickEntry(quickText, now);
    const built = buildEventFromQuickEntry(parsed, {
      id: `event-phone-${Date.now()}`,
      dayId: day.id,
      source: 'live',
      now,
    });

    const result = await persistEvent({
      title: built.title,
      startAt: built.startAt,
      endAt: built.endAt,
      tagPaths: parsed.tagPaths,
      peopleNames: parsed.peopleNames,
      capture: {
        rawText: parsed.rawText,
        capturedAt: parsed.startAt,
        parsedBy: parsed.parsedBy,
      },
    });

    if (result) {
      setLastSaveLatency(result.saveDurationMs);
      setQuickText('');
    }
  };

  const handleMarkNow = async () => {
    if (!day) return;
    Vibration.vibrate(50);
    const now = new Date();
    const newMarker: Marker = {
      id: `m-phone-${Date.now()}`,
      dayId: day.id,
      markedAt: now.toISOString(),
      timezoneOffsetMinutes: -new Date().getTimezoneOffset(),
      note: noteText.trim() || undefined,
      precision: 'exact',
      source: 'live',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      isDeleted: false,
    };

    const { saveDurationMs } = await storage.saveMarkerAndEnqueueOutbox(newMarker);
    setLastSaveLatency(saveDurationMs);
    setMarkers((prev) => [newMarker, ...prev]);
    setNoteText('');
    await refreshOutbox();
  };

  const handleWake = async () => {
    if (!day || day.wakeAt) return;
    const updated = wakeDay(day, new Date().toISOString());
    await storage.saveDayAndEnqueueOutbox(updated);
    setDay(updated);
    await refreshOutbox();
  };

  const handleSyncNow = async () => {
    setSyncStatus('Syncing...');
    const res = await syncClient.syncNow();
    if (res.error) {
      setSyncStatus(`Sync error: ${res.error}`);
    } else {
      setSyncStatus(`Synced ${res.syncedCount}, pulled ${res.appliedCount}`);
    }
    await loadDayData();
  };

  const handleImportIcs = async () => {
    if (!icsText.trim()) return;
    setSuggestionError(null);
    setImportNotice(null);
    try {
      const parsed = parseIcsCalendar(icsText);
      const candidates = calendarEventsToSuggestions(parsed.events);
      const existing = await storage.getSuggestions();
      const known = new Set(
        existing
          .filter((suggestion) => suggestion.source === 'calendar' && suggestion.externalId)
          .map((suggestion) => suggestion.externalId as string)
      );

      let imported = 0;
      for (const candidate of candidates) {
        if (candidate.externalId && known.has(candidate.externalId)) continue;
        await storage.saveSuggestionAndEnqueueOutbox(candidate);
        imported++;
      }

      setIcsText('');
      setImportNotice(
        `Imported ${imported} ${imported === 1 ? 'suggestion' : 'suggestions'}. ` +
          `${parsed.skipped.length} calendar entries skipped.`
      );
      await loadDayData();
    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : 'Calendar import failed');
    }
  };

  const handleAcceptSuggestion = async (suggestion: Suggestion) => {
    if (!day) return;
    const now = new Date();
    setSuggestionBusyId(suggestion.id);
    setSuggestionError(null);
    try {
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      const startAt = suggestion.proposed.startAt;
      const eventDayId =
        suggestion.proposed.dayId ?? `day-${getLocalDateString(new Date(startAt), timezone)}`;

      if (!(await storage.getDay(eventDayId))) {
        await storage.saveDayAndEnqueueOutbox(buildDay(new Date(startAt)));
      }

      const eventId = `event-phone-${Date.now()}`;
      const { suggestion: accepted, proposed } = acceptSuggestion(suggestion, undefined, {
        eventId,
        dayId: eventDayId,
        now,
        source: 'imported',
      });
      const event = buildEventFromSuggestion(proposed, {
        eventId,
        dayId: eventDayId,
        now,
        source: 'imported',
      });
      const resolvedTags = resolveTagsForEvent(
        event.id,
        proposed.tagPaths ?? [],
        tags,
        { now }
      );
      const resolvedPeople = resolvePeopleForEvent(
        event.id,
        proposed.peopleNames ?? [],
        people,
        { now }
      );

      await storage.saveQuickEntryAndEnqueueOutbox({
        event,
        tags: resolvedTags.tags,
        eventTags: resolvedTags.eventTags,
        people: resolvedPeople.people,
        participants: resolvedPeople.participants,
      });
      await storage.saveSuggestionAndEnqueueOutbox(accepted);

      setEditingSuggestionId(null);
      await loadDayData();
    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : 'Failed to accept suggestion');
    } finally {
      setSuggestionBusyId(null);
    }
  };

  const handleRejectSuggestion = async (suggestion: Suggestion) => {
    setSuggestionBusyId(suggestion.id);
    setSuggestionError(null);
    try {
      const rejected = rejectSuggestion(suggestion, new Date());
      await storage.saveSuggestionAndEnqueueOutbox(rejected);
      setEditingSuggestionId(null);
      await loadDayData();
    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : 'Failed to reject suggestion');
    } finally {
      setSuggestionBusyId(null);
    }
  };

  const beginSuggestionEdit = (suggestion: Suggestion) => {
    setEditingSuggestionId(suggestion.id);
    setSuggestionTitleDraft(suggestion.proposed.title);
    setSuggestionStartDraft(toTimeInput(suggestion.proposed.startAt));
    setSuggestionEndDraft(toTimeInput(suggestion.proposed.endAt));
    setSuggestionError(null);
  };

  const handleSaveSuggestionEdit = async (suggestion: Suggestion) => {
    setSuggestionBusyId(suggestion.id);
    setSuggestionError(null);
    try {
      const startAt =
        timeOnDate(suggestion.proposed.startAt, suggestionStartDraft) ??
        suggestion.proposed.startAt;
      const endAt = suggestionEndDraft.trim()
        ? timeOnDate(
            suggestion.proposed.endAt ?? suggestion.proposed.startAt,
            suggestionEndDraft
          )
        : null;

      const overrides: SuggestionOverrides = {
        title: suggestionTitleDraft,
        startAt,
        endAt,
      };
      const edited = editSuggestion(suggestion, overrides, new Date());
      await storage.saveSuggestionAndEnqueueOutbox(edited);
      setEditingSuggestionId(null);
      await loadDayData();
    } catch (err) {
      setSuggestionError(err instanceof Error ? err.message : 'Failed to edit suggestion');
    } finally {
      setSuggestionBusyId(null);
    }
  };

  const openReview = () => {
    if (!day) return;
    const now = new Date();
    setReviewGaps(findTimelineGaps(day, events, MIN_GAP_MINUTES, now));
    setJournalDraft(journalEntries[0]?.body ?? '');
    setSleepDraft(toTimeInput(day.sleepAt));
    setReviewResult(null);
    setReviewOpen(true);
  };

  const handleFillGap = async (gap: TimelineGap) => {
    if (!day) return;
    const result = await persistEvent({
      title: 'Deep work',
      startAt: gap.startAt,
      endAt: gap.endAt,
      tagPaths: ['work/coding'],
    });
    if (result) {
      setReviewGaps(findTimelineGaps(day, result.events, MIN_GAP_MINUTES, new Date()));
    }
  };

  const handleCompleteReview = async () => {
    if (!day) return;

    const now = new Date();
    let nextJournalEntries = journalEntries;

    if (journalDraft.trim().length > 0) {
      const entry: JournalEntry = {
        id: `journal-${day.id}`,
        dayId: day.id,
        body: journalDraft.trim(),
        writtenAt: now.toISOString(),
        source: 'live',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        isDeleted: false,
      };
      await storage.saveJournalAndEnqueueOutbox(entry);
      nextJournalEntries = [entry];
      setJournalEntries(nextJournalEntries);
    }

    const sleepAt = parseSleepTime(sleepDraft, day, now);
    const closing = completeDayReview(day, events, nextJournalEntries, {
      now,
      sleepAt,
    });

    await storage.saveDayAndEnqueueOutbox(closing);

    const coverage = calculateDayCoverage(closing, events, now);
    const remainingGaps = findTimelineGaps(closing, events, MIN_GAP_MINUTES, now);

    setDay(closing);
    setReviewGaps(remainingGaps);
    setReviewResult({
      fidelity: closing.fidelity,
      coverage,
      gapsRemaining: remainingGaps.length,
    });
    await refreshOutbox();
  };

  const activeDay = day;
  const lanes = computeTimelineLanes(events);
  const nowMs = Date.now();
  const windowStartMs = activeDay?.wakeAt ? new Date(activeDay.wakeAt).getTime() : nowMs;
  const windowEndMs = activeDay?.sleepAt ? new Date(activeDay.sleepAt).getTime() : nowMs;
  const spanMs = Math.max(windowEndMs - windowStartMs, 60 * 60 * 1000);
  const laneCount =
    lanes.reduce((max, item) => Math.max(max, item.totalLanes), 1) || 1;
  const timelineGaps = activeDay
    ? findTimelineGaps(activeDay, events, MIN_GAP_MINUTES, new Date(nowMs))
    : [];
  const coverage = activeDay ? calculateDayCoverage(activeDay, events, new Date(nowMs)) : 0;

  const renderTimelineBar = () => {
    if (!activeDay?.wakeAt) {
      return (
        <Text style={styles.emptyText}>
          Wake up to start the day timeline. Quick entries are still saved offline.
        </Text>
      );
    }

    return (
      <View style={[styles.miniTimeline, { height: 12 * laneCount + 8 }]}>
        <View style={styles.timelineTrack} />
        {timelineGaps.map((gap) => {
          const start = Math.max(
            0,
            ((new Date(gap.startAt).getTime() - windowStartMs) / spanMs) * 100
          );
          const width = Math.max(
            0.5,
            ((new Date(gap.endAt).getTime() - new Date(gap.startAt).getTime()) / spanMs) * 100
          );
          return (
            <View
              key={`gap-${gap.startAt}`}
              style={[
                styles.gapBlock,
                { left: `${start}%`, width: `${Math.min(width, 100 - start)}%` },
              ]}
            />
          );
        })}
        {lanes.map(({ event, laneIndex }) => {
          const startMs = new Date(event.startAt).getTime();
          const endMs = event.endAt ? new Date(event.endAt).getTime() : startMs;
          const left = Math.max(0, ((startMs - windowStartMs) / spanMs) * 100);
          const width = Math.max(0.7, ((endMs - startMs) / spanMs) * 100);
          return (
            <View
              key={event.id}
              style={[
                styles.eventBlock,
                {
                  left: `${Math.min(left, 99)}%`,
                  width: `${Math.min(width, 100 - left)}%`,
                  top: 4 + laneIndex * 12,
                },
              ]}
            />
          );
        })}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0f172a" />

      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Life Logger</Text>
            <Text style={styles.subtitle}>
              {activeDay ? activeDay.localDate : 'Loading day...'} · Daily Loop
            </Text>
          </View>
          {activeDay && (
            <View style={styles.fidelityPill}>
              <Text style={styles.fidelityText}>{activeDay.fidelity}</Text>
            </View>
          )}
        </View>

        <View style={styles.dayCard}>
          <View style={styles.dayRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.dayLabel}>
                {activeDay?.wakeAt ? `Awake since ${formatClock(activeDay.wakeAt)}` : 'Not awake yet'}
              </Text>
              <Text style={styles.dayMeta}>
                {Math.round(coverage * 100)}% timeline coverage ·{' '}
                {timelineGaps.length} {timelineGaps.length === 1 ? 'gap' : 'gaps'} ·{' '}
                {activeDay?.reviewStatus ?? 'unreviewed'}
              </Text>
            </View>
            {!activeDay?.wakeAt && (
              <TouchableOpacity style={styles.wakeButton} onPress={handleWake}>
                <Text style={styles.wakeButtonText}>WAKE UP</Text>
              </TouchableOpacity>
            )}
          </View>

          {renderTimelineBar()}

          <TouchableOpacity style={styles.reviewButton} onPress={openReview}>
            <Text style={styles.reviewButtonText}>
              {activeDay?.reviewStatus === 'completed' ? 'Reopen Day Review' : 'Start Day Review'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>QUICK ENTRY</Text>
          <TextInput
            style={styles.input}
            placeholder="lunch with @rahul at 1pm #food/lunch"
            placeholderTextColor="#94a3b8"
            value={quickText}
            onChangeText={setQuickText}
            onSubmitEditing={handleQuickEntry}
            returnKeyType="done"
            multiline
          />
          {(tags.length > 0 || people.length > 0) && (
            <View style={styles.suggestionRow}>
              {tags.slice(0, 4).map((tag) => (
                <TouchableOpacity
                  key={`suggest-tag-${tag.id}`}
                  style={styles.suggestionChip}
                  onPress={() => setQuickText((previous) => `${previous} #${tag.path} `.trimStart())}
                >
                  <Text style={styles.suggestionText}>#{tag.path}</Text>
                </TouchableOpacity>
              ))}
              {people.slice(0, 3).map((person) => (
                <TouchableOpacity
                  key={`suggest-person-${person.id}`}
                  style={[styles.suggestionChip, styles.suggestionPerson]}
                  onPress={() =>
                    setQuickText((previous) => `${previous} @${person.displayName} `.trimStart())
                  }
                >
                  <Text style={styles.suggestionText}>@{person.displayName}</Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          <TouchableOpacity
            style={[styles.quickButton, !quickText.trim() && styles.disabledButton]}
            onPress={handleQuickEntry}
            disabled={!quickText.trim()}
            activeOpacity={0.8}
          >
            <Text style={styles.quickButtonText}>LOG ENTRY</Text>
          </TouchableOpacity>
          {lastSaveLatency !== null && (
            <Text style={styles.latencyText}>
              Saved offline in {lastSaveLatency.toFixed(3)} ms (&lt; 50 ms budget)
            </Text>
          )}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>1-TAP MARKER</Text>
          <TextInput
            style={styles.input}
            placeholder="Optional note (e.g., Coffee, Walk)..."
            placeholderTextColor="#94a3b8"
            value={noteText}
            onChangeText={setNoteText}
          />
          <TouchableOpacity style={styles.markButton} onPress={handleMarkNow} activeOpacity={0.8}>
            <Text style={styles.markButtonText}>MARK NOW</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.syncBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.syncStatus}>{syncStatus}</Text>
            <Text style={styles.pendingText}>{pendingCount} records pending sync</Text>
          </View>
          <TouchableOpacity style={styles.syncButton} onPress={handleSyncNow} activeOpacity={0.8}>
            <Text style={styles.syncButtonText}>Sync Now</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>TODAY'S EVENTS ({events.length})</Text>
          <FlatList
            data={events}
            scrollEnabled={false}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => {
              return (
                <View style={styles.eventRow}>
                  <Text style={styles.eventTime}>
                    {formatClock(item.startAt)}
                    {item.endAt ? `–${formatClock(item.endAt)}` : ''}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.eventTitle}>{item.title}</Text>
                    <Text style={styles.eventMeta}>
                      {item.source}
                      {item.endAt ? ' · interval' : ' · point'}
                    </Text>
                  </View>
                </View>
              );
            }}
            ListEmptyComponent={
              <Text style={styles.emptyText}>
                Nothing logged yet. Try a quick entry like "read #reading for 45m".
              </Text>
            }
          />
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>SUGGESTIONS ({suggestions.length})</Text>

          <View style={styles.card}>
            <Text style={styles.cardLabel}>IMPORT CALENDAR (.ICS)</Text>
            <TextInput
              style={[styles.input, styles.icsInput]}
              placeholder="Paste calendar file contents here"
              placeholderTextColor="#94a3b8"
              value={icsText}
              onChangeText={setIcsText}
              multiline
            />
            <TouchableOpacity
              style={[styles.quickButton, !icsText.trim() && styles.disabledButton]}
              onPress={handleImportIcs}
              disabled={!icsText.trim()}
              activeOpacity={0.8}
            >
              <Text style={styles.quickButtonText}>IMPORT ICS</Text>
            </TouchableOpacity>
            {importNotice && <Text style={styles.noticeText}>{importNotice}</Text>}
            {suggestionError && <Text style={styles.suggestionError}>{suggestionError}</Text>}

            {suggestions.length === 0 ? (
              <Text style={styles.emptyText}>
                No pending suggestions. Automated sources propose here, and only you add them to
                the timeline.
              </Text>
            ) : (
              suggestions.map((suggestion) => {
                const busy = suggestionBusyId === suggestion.id;
                const editing = editingSuggestionId === suggestion.id;
                return (
                  <View key={suggestion.id} style={styles.suggestionCard}>
                    {editing ? (
                      <>
                        <TextInput
                          style={styles.input}
                          value={suggestionTitleDraft}
                          onChangeText={setSuggestionTitleDraft}
                          placeholder="Title"
                          placeholderTextColor="#94a3b8"
                        />
                        <View style={styles.suggestionTimeRow}>
                          <TextInput
                            style={[styles.input, styles.suggestionTimeInput]}
                            value={suggestionStartDraft}
                            onChangeText={setSuggestionStartDraft}
                            placeholder="Start HH:MM"
                            placeholderTextColor="#94a3b8"
                          />
                          <TextInput
                            style={[styles.input, styles.suggestionTimeInput]}
                            value={suggestionEndDraft}
                            onChangeText={setSuggestionEndDraft}
                            placeholder="End HH:MM"
                            placeholderTextColor="#94a3b8"
                          />
                        </View>
                        <View style={styles.suggestionActions}>
                          <TouchableOpacity
                            style={styles.smallPrimary}
                            onPress={() => handleSaveSuggestionEdit(suggestion)}
                            disabled={busy}
                          >
                            <Text style={styles.smallPrimaryText}>
                              {busy ? 'SAVING' : 'SAVE'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.smallSecondary}
                            onPress={() => setEditingSuggestionId(null)}
                            disabled={busy}
                          >
                            <Text style={styles.smallSecondaryText}>CANCEL</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    ) : (
                      <>
                        <Text style={styles.suggestionTitle}>{suggestion.proposed.title}</Text>
                        <Text style={styles.suggestionMeta}>
                          {formatClock(suggestion.proposed.startAt)}
                          {suggestion.proposed.endAt
                            ? `–${formatClock(suggestion.proposed.endAt)}`
                            : ''}{' '}
                          · {suggestion.source} · {Math.round(suggestion.confidence * 100)}%
                        </Text>
                        {suggestion.proposed.notes && (
                          <Text style={styles.suggestionNotes} numberOfLines={3}>
                            {suggestion.proposed.notes}
                          </Text>
                        )}
                        <View style={styles.suggestionActions}>
                          <TouchableOpacity
                            style={styles.smallPrimary}
                            onPress={() => handleAcceptSuggestion(suggestion)}
                            disabled={busy}
                          >
                            <Text style={styles.smallPrimaryText}>
                              {busy ? 'WORKING' : 'ACCEPT'}
                            </Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.smallSecondary}
                            onPress={() => beginSuggestionEdit(suggestion)}
                            disabled={busy}
                          >
                            <Text style={styles.smallSecondaryText}>EDIT</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.smallSecondary}
                            onPress={() => handleRejectSuggestion(suggestion)}
                            disabled={busy}
                          >
                            <Text style={styles.smallSecondaryText}>REJECT</Text>
                          </TouchableOpacity>
                        </View>
                      </>
                    )}
                  </View>
                );
              })
            )}
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>JOURNAL</Text>
          {journalEntries.length === 0 ? (
            <Text style={styles.emptyText}>No journal entry yet. Write one during review.</Text>
          ) : (
            journalEntries.map((entry) => (
              <View key={entry.id} style={styles.journalCard}>
                <Text style={styles.journalBody}>{entry.body}</Text>
                <Text style={styles.journalMeta}>{formatClock(entry.writtenAt)}</Text>
              </View>
            ))
          )}
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionHeader}>TODAY'S MARKERS ({markers.length})</Text>
          {markers.length === 0 ? (
            <Text style={styles.emptyText}>No markers logged on this device yet.</Text>
          ) : (
            markers.map((marker) => (
              <View key={marker.id} style={styles.markerRow}>
                <Text style={styles.markerTime}>{formatClock(marker.markedAt)}</Text>
                <Text style={styles.markerNote}>{marker.note || 'Quick Marker'}</Text>
              </View>
            ))
          )}
        </View>
      </ScrollView>

      <Modal
        visible={reviewOpen}
        animationType="slide"
        transparent
        onRequestClose={() => setReviewOpen(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <ScrollView keyboardShouldPersistTaps="handled">
              {reviewResult ? (
                <View style={styles.completion}>
                  <View style={styles.completionRule} />
                  <Text style={styles.completionTitle}>Day complete</Text>
                  <Text style={styles.completionFidelity}>
                    Fidelity: {reviewResult.fidelity}
                  </Text>
                  <Text style={styles.completionMeta}>
                    {Math.round(reviewResult.coverage * 100)}% of waking hours covered ·{' '}
                    {reviewResult.gapsRemaining} gaps left
                  </Text>
                  <TouchableOpacity
                    style={styles.completeButton}
                    onPress={() => setReviewOpen(false)}
                  >
                    <Text style={styles.completeButtonText}>DONE</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <>
                  <Text style={styles.modalTitle}>End-of-Day Review</Text>
                  <Text style={styles.modalSubtitle}>
                    Fill the gaps, capture a reflection, then record sleep.
                  </Text>

                  <Text style={styles.cardLabel}>UNLOGGED GAPS &gt; 15 MIN</Text>
                  {reviewGaps.length === 0 ? (
                    <Text style={styles.emptyText}>No gaps. Beautifully logged day!</Text>
                  ) : (
                    reviewGaps.map((gap) => (
                      <View key={`review-gap-${gap.startAt}`} style={styles.gapRow}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.gapTime}>
                            {formatClock(gap.startAt)} – {formatClock(gap.endAt)}
                          </Text>
                          <Text style={styles.gapMeta}>
                            {Math.round(gap.durationMinutes)} min unlogged
                          </Text>
                        </View>
                        <TouchableOpacity
                          style={styles.gapFillButton}
                          onPress={() => handleFillGap(gap)}
                        >
                          <Text style={styles.gapFillText}>Deep Work #work/coding</Text>
                        </TouchableOpacity>
                      </View>
                    ))
                  )}

                  <Text style={styles.inputLabel}>Reflections on today?</Text>
                  <TextInput
                    style={[styles.input, styles.journalInput]}
                    placeholder="What mattered? What did you learn?"
                    placeholderTextColor="#94a3b8"
                    value={journalDraft}
                    onChangeText={setJournalDraft}
                    multiline
                  />

                  <Text style={styles.inputLabel}>Sleep time (HH:MM)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="23:30"
                    placeholderTextColor="#94a3b8"
                    value={sleepDraft}
                    onChangeText={setSleepDraft}
                    keyboardType="numbers-and-punctuation"
                  />

                  <TouchableOpacity
                    style={styles.completeButton}
                    onPress={handleCompleteReview}
                  >
                    <Text style={styles.completeButtonText}>COMPLETE DAY REVIEW</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cancelButton}
                    onPress={() => setReviewOpen(false)}
                  >
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0f172a',
  },
  scrollContent: {
    padding: 16,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: 16,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#f8fafc',
  },
  subtitle: {
    fontSize: 14,
    color: '#94a3b8',
    marginTop: 2,
  },
  fidelityPill: {
    backgroundColor: '#334155',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  fidelityText: {
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  dayCard: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  dayLabel: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
  },
  dayMeta: {
    color: '#94a3b8',
    fontSize: 12,
    marginTop: 3,
  },
  wakeButton: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  wakeButtonText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
  },
  miniTimeline: {
    backgroundColor: '#0f172a',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 12,
  },
  timelineTrack: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#1e293b',
  },
  gapBlock: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(148, 163, 184, 0.16)',
  },
  eventBlock: {
    position: 'absolute',
    height: 8,
    borderRadius: 4,
    backgroundColor: '#cbd5e1',
  },
  reviewButton: {
    backgroundColor: '#334155',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
  },
  reviewButtonText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '700',
  },
  card: {
    backgroundColor: '#1e293b',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  cardLabel: {
    color: '#94a3b8',
    fontSize: 11,
    fontWeight: 'bold',
    letterSpacing: 0.6,
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#334155',
    color: '#f8fafc',
    borderRadius: 8,
    padding: 12,
    fontSize: 16,
  },
  journalInput: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  suggestionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 10,
  },
  suggestionChip: {
    backgroundColor: '#334155',
    borderRadius: 999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  suggestionPerson: {
    backgroundColor: '#3f3f46',
  },
  suggestionText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
  },
  icsInput: {
    minHeight: 84,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  noticeText: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 8,
  },
  suggestionError: {
    color: '#e2e8f0',
    fontSize: 12,
    marginTop: 8,
  },
  suggestionCard: {
    backgroundColor: '#0f172a',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#334155',
    padding: 12,
    marginTop: 10,
  },
  suggestionTitle: {
    color: '#f8fafc',
    fontSize: 15,
    fontWeight: '600',
  },
  suggestionMeta: {
    color: '#94a3b8',
    fontSize: 11,
    marginTop: 3,
    textTransform: 'capitalize',
  },
  suggestionNotes: {
    color: '#94a3b8',
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  suggestionActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 10,
  },
  suggestionTimeRow: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 8,
    marginBottom: 8,
  },
  suggestionTimeInput: {
    flex: 1,
  },
  smallPrimary: {
    backgroundColor: '#e2e8f0',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  smallPrimaryText: {
    color: '#0f172a',
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  smallSecondary: {
    backgroundColor: '#334155',
    borderRadius: 6,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  smallSecondaryText: {
    color: '#e2e8f0',
    fontSize: 12,
    fontWeight: '600',
  },
  quickButton: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  quickButtonText: {
    color: '#0f172a',
    fontSize: 16,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  disabledButton: {
    opacity: 0.45,
  },
  markButton: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 18,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  markButtonText: {
    color: '#0f172a',
    fontSize: 18,
    fontWeight: 'bold',
    letterSpacing: 1,
  },
  latencyText: {
    color: '#cbd5e1',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 10,
    fontWeight: '500',
  },
  syncBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 8,
    marginBottom: 16,
  },
  syncStatus: {
    color: '#f8fafc',
    fontSize: 13,
    fontWeight: '600',
  },
  pendingText: {
    color: '#94a3b8',
    fontSize: 12,
  },
  syncButton: {
    backgroundColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 6,
  },
  syncButtonText: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    color: '#94a3b8',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  eventRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 6,
    marginBottom: 6,
  },
  eventTime: {
    color: '#cbd5e1',
    fontWeight: '600',
    width: 95,
    fontSize: 13,
  },
  eventTitle: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '500',
  },
  eventMeta: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 2,
  },
  journalCard: {
    backgroundColor: '#1e293b',
    padding: 14,
    borderRadius: 8,
    marginBottom: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#64748b',
  },
  journalBody: {
    color: '#e2e8f0',
    fontSize: 14,
    lineHeight: 20,
  },
  journalMeta: {
    color: '#64748b',
    fontSize: 11,
    marginTop: 6,
  },
  markerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    padding: 12,
    borderRadius: 6,
    marginBottom: 6,
  },
  markerTime: {
    color: '#cbd5e1',
    fontWeight: '600',
    width: 65,
    fontSize: 14,
  },
  markerNote: {
    color: '#f8fafc',
    fontSize: 14,
    flex: 1,
  },
  emptyText: {
    color: '#64748b',
    textAlign: 'center',
    marginTop: 12,
    marginBottom: 8,
    fontStyle: 'italic',
    fontSize: 13,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(2, 6, 23, 0.82)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#0f172a',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    maxHeight: '88%',
    borderTopWidth: 1,
    borderColor: '#334155',
  },
  modalTitle: {
    color: '#f8fafc',
    fontSize: 22,
    fontWeight: 'bold',
  },
  modalSubtitle: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 4,
    marginBottom: 18,
  },
  gapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1e293b',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  gapTime: {
    color: '#f8fafc',
    fontSize: 14,
    fontWeight: '600',
  },
  gapMeta: {
    color: '#cbd5e1',
    fontSize: 12,
    marginTop: 2,
  },
  gapFillButton: {
    backgroundColor: '#334155',
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginLeft: 8,
    maxWidth: 150,
  },
  gapFillText: {
    color: '#cbd5e1',
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  inputLabel: {
    color: '#cbd5e1',
    fontSize: 13,
    fontWeight: '600',
    marginTop: 14,
    marginBottom: 6,
  },
  completeButton: {
    backgroundColor: '#e2e8f0',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 18,
  },
  completeButtonText: {
    color: '#0f172a',
    fontSize: 15,
    fontWeight: 'bold',
    letterSpacing: 0.5,
  },
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  cancelButtonText: {
    color: '#94a3b8',
    fontSize: 13,
  },
  completion: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  completionRule: {
    width: 48,
    height: 2,
    backgroundColor: '#64748b',
    marginBottom: 16,
  },
  completionTitle: {
    color: '#f8fafc',
    fontSize: 24,
    fontWeight: 'bold',
    marginTop: 8,
  },
  completionFidelity: {
    color: '#e2e8f0',
    fontSize: 16,
    fontWeight: '700',
    marginTop: 8,
    textTransform: 'uppercase',
  },
  completionMeta: {
    color: '#94a3b8',
    fontSize: 13,
    marginTop: 8,
    textAlign: 'center',
  },
});
