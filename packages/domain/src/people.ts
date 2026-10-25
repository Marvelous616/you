import { EventParticipant, Person, UUID } from './types.js';

export function normalizePersonName(name: string): string {
  return name.trim().replace(/^@+/, '').replace(/\s+/g, ' ').toLowerCase();
}

export function findPersonByNameOrAlias(
  people: Person[],
  name: string
): Person | undefined {
  const needle = normalizePersonName(name);
  if (!needle) return undefined;

  return people.find((person) => {
    if (person.isDeleted) return false;
    if (normalizePersonName(person.displayName) === needle) return true;
    return person.aliases.some((alias) => normalizePersonName(alias) === needle);
  });
}

export interface ResolvePeopleOptions {
  now?: Date;
  makeId?: (normalized: string) => string;
  role?: string;
}

export interface ResolvedPeopleForEvent {
  people: Person[];
  participants: EventParticipant[];
}

function defaultPersonId(name: string): string {
  return `person-${name.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * Resolves @mentions to existing people (by display name or alias), creating
 * a minimal Person for genuinely new names. Matching is case-insensitive.
 */
export function resolvePeopleForEvent(
  eventId: UUID,
  names: string[],
  existingPeople: Person[],
  options: ResolvePeopleOptions = {}
): ResolvedPeopleForEvent {
  const now = options.now ?? new Date();
  const makeId = options.makeId ?? defaultPersonId;
  const known = [...existingPeople.filter((person) => !person.isDeleted)];
  const created: Person[] = [];
  const participants: EventParticipant[] = [];
  const seen = new Set<string>();
  const seenPersonIds = new Set<UUID>();

  for (const rawName of names) {
    const displayName = rawName.trim().replace(/^@+/, '').replace(/\s+/g, ' ');
    const normalized = normalizePersonName(displayName);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);

    let person = findPersonByNameOrAlias(known, normalized);
    if (!person) {
      person = {
        id: makeId(normalized),
        displayName,
        aliases: [],
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
        isDeleted: false,
      };
      known.push(person);
      created.push(person);
    }

    if (seenPersonIds.has(person.id)) continue;
    seenPersonIds.add(person.id);

    participants.push({
      eventId,
      personId: person.id,
      role: options.role ?? 'with',
      medium: 'in_person',
      initiatedBy: 'mutual',
    });
  }

  return { people: created, participants };
}
