import { EventTag, Tag, UUID } from './types.js';

export interface TagNode {
  tag: Tag;
  children: TagNode[];
}

/**
 * Normalizes a free-form tag into the canonical slash-separated path form.
 * Examples: " #Work/Coding " -> "work/coding", "food & drink" -> "food-drink".
 */
export function normalizeTagPath(raw: string): string {
  return raw
    .trim()
    .replace(/^#+/, '')
    .split('/')
    .map((segment) =>
      segment
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9_-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
    )
    .filter((segment) => segment.length > 0)
    .join('/');
}

export function tagNameFromPath(path: string): string {
  const segments = normalizeTagPath(path).split('/').filter(Boolean);
  const name = segments[segments.length - 1] ?? '';
  return name.replace(/[-_]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
}

export function tagParentPath(path: string): string | undefined {
  const segments = normalizeTagPath(path).split('/').filter(Boolean);
  return segments.length > 1 ? segments.slice(0, -1).join('/') : undefined;
}

/**
 * Builds a stable hierarchy from a flat tag list. Orphans are attached at the
 * root so bad incoming data can never break the tree.
 */
export function buildTagTree(tags: Tag[]): TagNode[] {
  const active = tags.filter((tag) => !tag.isDeleted);
  const byId = new Map<UUID, TagNode>();
  for (const tag of active) {
    byId.set(tag.id, { tag, children: [] });
  }

  const roots: TagNode[] = [];
  for (const tag of active) {
    const node = byId.get(tag.id)!;
    const parent = tag.parentId ? byId.get(tag.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }

  const sortNodes = (nodes: TagNode[]): void => {
    nodes.sort((a, b) => a.tag.path.localeCompare(b.tag.path));
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);

  return roots;
}

export interface ResolveTagsOptions {
  now?: Date;
  makeId?: (path: string) => string;
}

export interface ResolvedTagsForEvent {
  /** Existing and newly-created tags (including implicit ancestors). */
  tags: Tag[];
  eventTags: EventTag[];
  primaryTag?: Tag;
}

function defaultTagId(path: string): string {
  return `tag-${path.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

/**
 * Turns parser tag paths into persisted Tag records (creating missing
 * ancestors) plus event-tag links. The first requested tag is primary.
 */
export function resolveTagsForEvent(
  eventId: UUID,
  tagPaths: string[],
  existingTags: Tag[],
  options: ResolveTagsOptions = {}
): ResolvedTagsForEvent {
  const now = options.now ?? new Date();
  const makeId = options.makeId ?? defaultTagId;
  const known = new Map<string, Tag>();
  for (const tag of existingTags) {
    if (!tag.isDeleted) known.set(tag.path, tag);
  }

  const requested = Array.from(
    new Set(tagPaths.map(normalizeTagPath).filter((path) => path.length > 0))
  );

  const allPaths = new Set<string>();
  for (const path of requested) {
    const segments = path.split('/');
    for (let i = 1; i <= segments.length; i++) {
      allPaths.add(segments.slice(0, i).join('/'));
    }
  }

  const created: Tag[] = [];
  const orderedPaths = Array.from(allPaths).sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  for (const path of orderedPaths) {
    if (known.has(path)) continue;

    const parentPath = tagParentPath(path);
    const parent = parentPath ? known.get(parentPath) : undefined;
    const tag: Tag = {
      id: makeId(path),
      name: tagNameFromPath(path),
      path,
      parentId: parent?.id,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      isDeleted: false,
    };
    known.set(path, tag);
    created.push(tag);
  }

  const requestedTags = requested
    .map((path) => known.get(path))
    .filter((tag): tag is Tag => Boolean(tag));

  const eventTags: EventTag[] = requestedTags.map((tag, index) => ({
    eventId,
    tagId: tag.id,
    isPrimary: index === 0,
  }));

  return {
    tags: created,
    eventTags,
    primaryTag: requestedTags[0],
  };
}
