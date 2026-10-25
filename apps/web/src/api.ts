import {
  Capture,
  Day,
  Event,
  EventParticipant,
  EventTag,
  JournalEntry,
  Marker,
  Person,
  Suggestion,
  SuggestionOverrides,
  SuggestionStatus,
  Tag,
  TimelineGap,
} from '@life-logger/domain';

const API_BASE = '';

export interface DayTimeline {
  day: Day;
  markers: Marker[];
  events: Event[];
  tags: Tag[];
  eventTags: EventTag[];
  people: Person[];
  participants: EventParticipant[];
  journalEntries: JournalEntry[];
  gaps: TimelineGap[];
  coverage: number;
}

export interface CreateEventInput {
  event: Partial<Event> & Pick<Event, 'title' | 'startAt'>;
  tagPaths?: string[];
  peopleNames?: string[];
  capture?: Capture;
}

export interface CreateEventResult {
  event: Event;
  tags: Tag[];
  eventTags: EventTag[];
  people: Person[];
  participants: EventParticipant[];
  capture: Capture | null;
}

export interface DayPatchInput {
  wakeAt?: string;
  sleepAt?: string;
  reviewStatus?: Day['reviewStatus'];
  timezone?: string;
}

export interface ReviewInput {
  sleepAt?: string;
  journalId?: string;
  journalBody?: string;
}

export interface ReviewResult {
  day: Day;
  fidelity: Day['fidelity'];
  coverage: number;
  gaps: TimelineGap[];
  journalEntries: JournalEntry[];
}

async function readJson<T>(res: Response, fallbackMessage: string): Promise<T> {
  if (!res.ok) {
    const detail = await res.text();
    throw new Error(`${fallbackMessage} (HTTP ${res.status})${detail ? `: ${detail}` : ''}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchActiveDay(timezone?: string): Promise<Day> {
  const query = timezone ? `?timezone=${encodeURIComponent(timezone)}` : '';
  const res = await fetch(`${API_BASE}/api/v1/days/active${query}`);
  return readJson<Day>(res, 'Failed to fetch active day');
}

export async function fetchDayTimeline(dayId: string): Promise<DayTimeline> {
  const res = await fetch(`${API_BASE}/api/v1/days/${encodeURIComponent(dayId)}/timeline`);
  return readJson<DayTimeline>(res, 'Failed to fetch day timeline');
}

export async function fetchMarkers(dayId?: string): Promise<Marker[]> {
  const url = dayId
    ? `${API_BASE}/api/v1/markers?dayId=${encodeURIComponent(dayId)}`
    : `${API_BASE}/api/v1/markers`;
  const res = await fetch(url);
  return readJson<Marker[]>(res, 'Failed to fetch markers');
}

export async function updateDay(dayId: string, patch: DayPatchInput): Promise<Day> {
  const res = await fetch(`${API_BASE}/api/v1/days/${encodeURIComponent(dayId)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return readJson<Day>(res, 'Failed to update day');
}

export async function createEvent(input: CreateEventInput): Promise<CreateEventResult> {
  const res = await fetch(`${API_BASE}/api/v1/events`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<CreateEventResult>(res, 'Failed to create event');
}

export async function saveJournal(dayId: string, body: string): Promise<JournalEntry> {
  const res = await fetch(`${API_BASE}/api/v1/days/${encodeURIComponent(dayId)}/journal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ body }),
  });
  return readJson<JournalEntry>(res, 'Failed to save journal');
}

export async function reviewDay(dayId: string, input: ReviewInput): Promise<ReviewResult> {
  const res = await fetch(`${API_BASE}/api/v1/days/${encodeURIComponent(dayId)}/review`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<ReviewResult>(res, 'Failed to complete day review');
}

export interface AcceptSuggestionResult {
  suggestion: Suggestion;
  event: Event;
  tags: Tag[];
  eventTags: EventTag[];
  people: Person[];
  participants: EventParticipant[];
}

export interface CalendarImportResult {
  extension: { id: string; name: string; version: string };
  importedCount: number;
  duplicateCount: number;
  suggestions: Suggestion[];
  duplicates: Array<{ externalId: string; suggestionId: string; status: SuggestionStatus }>;
  skipped: Array<{ title?: string; reason: string }>;
}

export interface ExtensionInfo {
  id: string;
  name: string;
  version: string;
  tags: string[];
  dimensions: string[];
  tables: string[];
}

export async function fetchSuggestions(
  status?: SuggestionStatus
): Promise<Suggestion[]> {
  const query = status ? `?status=${encodeURIComponent(status)}` : '';
  const res = await fetch(`${API_BASE}/api/v1/suggestions${query}`);
  return readJson<Suggestion[]>(res, 'Failed to fetch suggestions');
}

export async function editSuggestion(
  suggestionId: string,
  overrides: SuggestionOverrides
): Promise<Suggestion> {
  const res = await fetch(
    `${API_BASE}/api/v1/suggestions/${encodeURIComponent(suggestionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrides),
    }
  );
  return readJson<Suggestion>(res, 'Failed to edit suggestion');
}

export async function acceptSuggestion(
  suggestionId: string,
  overrides?: SuggestionOverrides
): Promise<AcceptSuggestionResult> {
  const res = await fetch(
    `${API_BASE}/api/v1/suggestions/${encodeURIComponent(suggestionId)}/accept`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(overrides ? { overrides } : {}),
    }
  );
  return readJson<AcceptSuggestionResult>(res, 'Failed to accept suggestion');
}

export async function rejectSuggestion(suggestionId: string): Promise<Suggestion> {
  const res = await fetch(
    `${API_BASE}/api/v1/suggestions/${encodeURIComponent(suggestionId)}/reject`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    }
  );
  return readJson<Suggestion>(res, 'Failed to reject suggestion');
}

export async function fetchExtensions(): Promise<ExtensionInfo[]> {
  const res = await fetch(`${API_BASE}/api/v1/extensions`);
  return readJson<ExtensionInfo[]>(res, 'Failed to fetch extensions');
}

export async function importCalendarIcs(ics: string): Promise<CalendarImportResult> {
  const res = await fetch(`${API_BASE}/api/v1/extensions/calendar/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ics }),
  });
  return readJson<CalendarImportResult>(res, 'Failed to import calendar');
}

export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
