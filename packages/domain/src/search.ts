/**
 * A single full-text search hit. `title` is the display title (event title or
 * journal body excerpt); `snippet` carries the matching text used for context.
 */
export interface SearchHit {
  entityType: 'event' | 'journal_entry';
  entityId: string;
  title: string;
  snippet: string;
  updatedAt: string;
  /** Internal ranking hint: 3 title prefix, 2 title contains, 1 body/notes match. */
  score?: number;
}

/**
 * Normalizes a user search string: trimmed, lower-cased and whitespace
 * collapsed. Returns an empty string for missing or blank input.
 */
export function normalizeSearchQuery(raw: string | null | undefined): string {
  const trimmed = (raw ?? '').trim().toLowerCase();
  return trimmed.replace(/\s+/g, ' ');
}

/**
 * Ranks a search hit. Title prefix matches rank highest, then title contains,
 * then body/notes matches. Used to order merged event + journal results.
 */
export function rankSearchHit(hit: SearchHit, normalizedQuery: string): number {
  if (hit.entityType === 'event') {
    const title = (hit.title ?? '').toLowerCase();
    const notes = (hit.snippet ?? '').toLowerCase();
    if (normalizedQuery && title.startsWith(normalizedQuery)) return 3;
    if (normalizedQuery && title.includes(normalizedQuery)) return 2;
    if (normalizedQuery && notes.includes(normalizedQuery)) return 1;
  }
  if (hit.entityType === 'journal_entry') {
    const body = (hit.snippet ?? '').toLowerCase();
    if (normalizedQuery && body.includes(normalizedQuery)) return 1;
  }
  return 0;
}
