import {
  Capture,
  Day,
  Event,
  EventParticipant,
  EventTag,
  JournalEntry,
  Marker,
  Person,
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

export async function checkServerHealth(): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    return res.ok;
  } catch {
    return false;
  }
}
