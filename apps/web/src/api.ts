import {
  Capture,
  CrashReport,
  Day,
  Event,
  EventParticipant,
  EventTag,
  EventThing,
  JournalEntry,
  Marker,
  PerfSample,
  Person,
  SearchHit,
  Suggestion,
  SuggestionOverrides,
  SuggestionStatus,
  Tag,
  Template,
  TimelineGap,
  TypeDefinition,
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

// ---------------------------------------------------------------------------
// Event read, edit, delete, restore
// ---------------------------------------------------------------------------

export interface EventDetailResult {
  event: Event;
  eventTags: EventTag[];
  participants: EventParticipant[];
  things?: EventThing[];
}

export async function getEvent(eventId: string): Promise<EventDetailResult> {
  const res = await fetch(`${API_BASE}/api/v1/events/${encodeURIComponent(eventId)}`);
  return readJson<EventDetailResult>(res, 'Failed to fetch event');
}

export interface PatchEventInput {
  title?: string;
  startAt?: string;
  endAt?: string | null;
  startPrecision?: 'exact' | 'approx' | 'unknown';
  endPrecision?: 'exact' | 'approx' | 'unknown' | null;
  notes?: string | null;
  tagPaths?: string[];
  peopleNames?: string[];
}

export async function patchEvent(
  eventId: string,
  input: PatchEventInput
): Promise<Event> {
  const res = await fetch(
    `${API_BASE}/api/v1/events/${encodeURIComponent(eventId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return readJson<Event>(res, 'Failed to update event');
}

export async function deleteEvent(eventId: string): Promise<{ id: string; isDeleted: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/events/${encodeURIComponent(eventId)}`,
    { method: 'DELETE' }
  );
  return readJson<{ id: string; isDeleted: boolean }>(res, 'Failed to delete event');
}

export async function restoreEvent(
  eventId: string
): Promise<{ id: string; isDeleted: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/events/${encodeURIComponent(eventId)}/restore`,
    { method: 'POST' }
  );
  return readJson<{ id: string; isDeleted: boolean }>(res, 'Failed to restore event');
}

// ---------------------------------------------------------------------------
// Tag management
// ---------------------------------------------------------------------------

export interface CreateTagInput {
  name: string;
  color?: string;
  parentId?: string;
}

export async function fetchTags(): Promise<Tag[]> {
  const res = await fetch(`${API_BASE}/api/v1/tags`);
  return readJson<Tag[]>(res, 'Failed to fetch tags');
}

export async function createTag(input: CreateTagInput): Promise<Tag> {
  const res = await fetch(`${API_BASE}/api/v1/tags`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<Tag>(res, 'Failed to create tag');
}

export interface PatchTagInput {
  name?: string;
  color?: string;
  parentId?: string | null;
}

export async function patchTag(tagId: string, input: PatchTagInput): Promise<Tag> {
  const res = await fetch(
    `${API_BASE}/api/v1/tags/${encodeURIComponent(tagId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return readJson<Tag>(res, 'Failed to update tag');
}

export async function archiveTag(tagId: string): Promise<{ id: string; archived: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/tags/${encodeURIComponent(tagId)}/archive`,
    { method: 'POST' }
  );
  return readJson<{ id: string; archived: boolean }>(res, 'Failed to archive tag');
}

export async function unarchiveTag(
  tagId: string
): Promise<{ id: string; archived: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/tags/${encodeURIComponent(tagId)}/unarchive`,
    { method: 'POST' }
  );
  return readJson<{ id: string; archived: boolean }>(res, 'Failed to unarchive tag');
}

export async function deleteTag(tagId: string): Promise<{ id: string; deleted: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/tags/${encodeURIComponent(tagId)}`,
    { method: 'DELETE' }
  );
  return readJson<{ id: string; deleted: boolean }>(res, 'Failed to delete tag');
}

// ---------------------------------------------------------------------------
// People management
// ---------------------------------------------------------------------------

export interface CreatePersonInput {
  displayName: string;
  aliases?: string[];
  notes?: string;
}

export interface PersonWithAliases extends Person {
  aliasesList: string[];
}

export async function fetchPeople(q?: string): Promise<Person[]> {
  const query = q ? `?q=${encodeURIComponent(q)}` : '';
  const res = await fetch(`${API_BASE}/api/v1/people${query}`);
  return readJson<Person[]>(res, 'Failed to fetch people');
}

export async function createPerson(input: CreatePersonInput): Promise<Person> {
  const res = await fetch(`${API_BASE}/api/v1/people`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<Person>(res, 'Failed to create person');
}

export interface PatchPersonInput {
  displayName?: string;
  notes?: string | null;
}

export async function patchPerson(
  personId: string,
  input: PatchPersonInput
): Promise<Person> {
  const res = await fetch(
    `${API_BASE}/api/v1/people/${encodeURIComponent(personId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return readJson<Person>(res, 'Failed to update person');
}

export async function putPersonAliases(
  personId: string,
  aliases: string[]
): Promise<{ aliases: string[] }> {
  const res = await fetch(
    `${API_BASE}/api/v1/people/${encodeURIComponent(personId)}/aliases`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ aliases }),
    }
  );
  return readJson<{ aliases: string[] }>(res, 'Failed to update aliases');
}

export async function archivePerson(
  personId: string
): Promise<{ id: string; archived: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/people/${encodeURIComponent(personId)}/archive`,
    { method: 'POST' }
  );
  return readJson<{ id: string; archived: boolean }>(res, 'Failed to archive person');
}

export async function unarchivePerson(
  personId: string
): Promise<{ id: string; archived: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/people/${encodeURIComponent(personId)}/unarchive`,
    { method: 'POST' }
  );
  return readJson<{ id: string; archived: boolean }>(res, 'Failed to unarchive person');
}

export async function deletePerson(
  personId: string
): Promise<{ id: string; deleted: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/people/${encodeURIComponent(personId)}`,
    { method: 'DELETE' }
  );
  return readJson<{ id: string; deleted: boolean }>(res, 'Failed to delete person');
}

// ---------------------------------------------------------------------------
// Template management
// ---------------------------------------------------------------------------

export interface CreateTemplateInput {
  name: string;
  title: string;
  defaultDurationMinutes?: number;
  tagIds?: string[];
  special?: 'wake' | 'sleep';
  isPinned?: boolean;
  sortOrder?: number;
}

export interface PatchTemplateInput {
  name?: string;
  title?: string;
  defaultDurationMinutes?: number | null;
  tagIds?: string[];
  special?: 'wake' | 'sleep' | null;
  isPinned?: boolean;
  sortOrder?: number;
}

export interface LogTemplateInput {
  startAt?: string;
}

export interface LogTemplateResult {
  event: Event;
  tags: Tag[];
  eventTags: EventTag[];
  dayId: string;
}

export async function fetchTemplates(): Promise<Template[]> {
  const res = await fetch(`${API_BASE}/api/v1/templates`);
  return readJson<Template[]>(res, 'Failed to fetch templates');
}

export async function createTemplate(input: CreateTemplateInput): Promise<Template> {
  const res = await fetch(`${API_BASE}/api/v1/templates`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<Template>(res, 'Failed to create template');
}

export async function patchTemplate(
  templateId: string,
  input: PatchTemplateInput
): Promise<Template> {
  const res = await fetch(
    `${API_BASE}/api/v1/templates/${encodeURIComponent(templateId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return readJson<Template>(res, 'Failed to update template');
}

export async function deleteTemplate(
  templateId: string
): Promise<{ id: string; isDeleted: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/templates/${encodeURIComponent(templateId)}`,
    { method: 'DELETE' }
  );
  return readJson<{ id: string; isDeleted: boolean }>(res, 'Failed to delete template');
}

export async function logTemplate(
  templateId: string,
  input: LogTemplateInput
): Promise<LogTemplateResult> {
  const res = await fetch(
    `${API_BASE}/api/v1/templates/${encodeURIComponent(templateId)}/log`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return readJson<LogTemplateResult>(res, 'Failed to log template');
}

// ---------------------------------------------------------------------------
// Things: typed dynamic fields (type definitions and event things)
// ---------------------------------------------------------------------------

export interface CreateTypeDefinitionInput {
  name: string;
  fieldType: string;
  schema?: Record<string, unknown>;
}

export interface PatchTypeDefinitionInput {
  name?: string;
  fieldType?: string;
  schema?: Record<string, unknown> | null;
}

export async function fetchTypeDefinitions(): Promise<TypeDefinition[]> {
  const res = await fetch(`${API_BASE}/api/v1/type-definitions`);
  return readJson<TypeDefinition[]>(res, 'Failed to fetch type definitions');
}

export async function createTypeDefinition(
  input: CreateTypeDefinitionInput
): Promise<TypeDefinition> {
  const res = await fetch(`${API_BASE}/api/v1/type-definitions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return readJson<TypeDefinition>(res, 'Failed to create type definition');
}

export async function patchTypeDefinition(
  typeDefinitionId: string,
  input: PatchTypeDefinitionInput
): Promise<TypeDefinition> {
  const res = await fetch(
    `${API_BASE}/api/v1/type-definitions/${encodeURIComponent(typeDefinitionId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return readJson<TypeDefinition>(res, 'Failed to update type definition');
}

export async function deleteTypeDefinition(
  typeDefinitionId: string
): Promise<{ id: string; isDeleted: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/type-definitions/${encodeURIComponent(typeDefinitionId)}`,
    { method: 'DELETE' }
  );
  return readJson<{ id: string; isDeleted: boolean }>(res, 'Failed delete type definition');
}

export interface AttachEventThingInput {
  typeDefinitionId: string;
  value?: Record<string, unknown>;
}

export async function attachEventThing(
  eventId: string,
  input: AttachEventThingInput
): Promise<EventThing> {
  const res = await fetch(
    `${API_BASE}/api/v1/events/${encodeURIComponent(eventId)}/things`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  return readJson<EventThing>(res, 'Failed attach event thing');
}

export async function deleteEventThing(
  eventId: string,
  typeDefinitionId: string
): Promise<{ id: string; eventId: string; isDeleted: boolean }> {
  const res = await fetch(
    `${API_BASE}/api/v1/events/${encodeURIComponent(eventId)}/things/${encodeURIComponent(
      typeDefinitionId
    )}`,
    { method: 'DELETE' }
  );
  return readJson<{ id: string; eventId: string; isDeleted: boolean }>(
    res,
    'Failed delete event thing'
  );
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

export async function search(query: string, limit?: number): Promise<SearchHit[]> {
  const searchQuery = query.trim();
  const params = new URLSearchParams({ q: searchQuery });
  if (limit) params.set('limit', String(limit));
  const res = await fetch(`${API_BASE}/api/v1/search?${params.toString()}`);
  return readJson<SearchHit[]>(res, 'Failed to search');
}

// ---------------------------------------------------------------------------
// Diagnostics: crash reports and perf samples (system data only)
// ---------------------------------------------------------------------------

export async function fetchCrashReports(includeDeleted = false): Promise<CrashReport[]> {
  const query = includeDeleted ? '?includeDeleted=true' : '';
  const res = await fetch(`${API_BASE}/api/v1/diagnostics/crash-reports${query}`);
  return readJson<CrashReport[]>(res, 'Failed to fetch crash reports');
}

export async function postCrashReport(report: CrashReport): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/api/v1/diagnostics/crash-reports`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
  });
  return readJson<{ id: string }>(res, 'Failed to post crash report');
}

export async function fetchPerfSamples(includeDeleted = false): Promise<PerfSample[]> {
  const query = includeDeleted ? '?includeDeleted=true' : '';
  const res = await fetch(`${API_BASE}/api/v1/diagnostics/perf-samples${query}`);
  return readJson<PerfSample[]>(res, 'Failed to fetch perf samples');
}

export async function postPerfSample(sample: PerfSample): Promise<{ id: string }> {
  const res = await fetch(`${API_BASE}/api/v1/diagnostics/perf-samples`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sample),
  });
  return readJson<{ id: string }>(res, 'Failed to post perf sample');
}

export async function pruneDiagnostics(retentionDays: number): Promise<{
  pruned: number;
  retentionDays: number;
}> {
  const res = await fetch(
    `${API_BASE}/api/v1/diagnostics/prune?retentionDays=${encodeURIComponent(
      String(retentionDays)
    )}`,
    { method: 'POST' }
  );
  return readJson<{ pruned: number; retentionDays: number }>(
    res,
    'Failed to prune diagnostics'
  );
}

// ---------------------------------------------------------------------------
// Server health
// ---------------------------------------------------------------------------

export interface ServerHealth {
  status: string;
  version: string;
  schemaVersion: number;
  syncProtocolVersion: number;
  database: string;
  timestamp: string;
}

export async function fetchHealth(): Promise<ServerHealth | null> {
  try {
    const res = await fetch(`${API_BASE}/health`);
    if (!res.ok) return null;
    return (await res.json()) as ServerHealth;
  } catch {
    return null;
  }
}
