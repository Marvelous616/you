import {
  ISODateTimeString,
  Template,
  TemplateTag,
  UUID,
} from './types.js';

export interface TemplateDraft {
  name: string;
  title: string;
  defaultDurationMinutes?: number;
  tagIds: UUID[];
  special?: 'wake' | 'sleep';
  isPinned?: boolean;
  sortOrder?: number;
}

export interface TemplatePatchInput {
  name?: string;
  title?: string;
  defaultDurationMinutes?: number | null;
  tagIds?: UUID[];
  special?: 'wake' | 'sleep' | null;
  isPinned?: boolean;
  sortOrder?: number;
}

export interface TemplateEventDraft {
  event: {
    title: string;
    startAt: ISODateTimeString;
    endAt?: ISODateTimeString;
  };
  tagIds: UUID[];
  setWakeOrSleep?: 'wake' | 'sleep';
}

function defaultTemplateId(name: string): string {
  return `template-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

export function buildTemplate(
  draft: TemplateDraft,
  options: { id?: UUID; now?: Date } = {}
): Template {
  const now = options.now ?? new Date();
  const timestamp = now.toISOString();

  return {
    id: options.id ?? defaultTemplateId(draft.name),
    name: draft.name,
    title: draft.title,
    defaultDurationMinutes: draft.defaultDurationMinutes ?? undefined,
    tagIds: draft.tagIds,
    special: draft.special,
    isPinned: draft.isPinned ?? false,
    sortOrder: draft.sortOrder ?? 0,
    createdAt: timestamp,
    updatedAt: timestamp,
    isDeleted: false,
  };
}

export function patchTemplate(
  template: Template,
  patch: TemplatePatchInput,
  now: Date = new Date()
): Template {
  return {
    ...template,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.defaultDurationMinutes !== undefined
      ? { defaultDurationMinutes: patch.defaultDurationMinutes ?? undefined }
      : {}),
    ...(patch.tagIds !== undefined ? { tagIds: patch.tagIds } : {}),
    ...(patch.special !== undefined ? { special: patch.special ?? undefined } : {}),
    ...(patch.isPinned !== undefined ? { isPinned: patch.isPinned } : {}),
    ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    updatedAt: now.toISOString(),
  };
}

export function buildTemplateTag(
  templateId: UUID,
  tagId: UUID,
  isPrimary: boolean
): TemplateTag {
  return { templateId, tagId, isPrimary };
}

export function templateToEventDraft(
  template: Template,
  startAt: string
): TemplateEventDraft {
  const startMs = new Date(startAt).getTime();
  if (Number.isNaN(startMs)) {
    throw new Error(`Invalid template start time: ${startAt}`);
  }

  const draft: TemplateEventDraft = {
    event: {
      title: template.title,
      startAt,
    },
    tagIds: template.tagIds,
  };

  if (template.defaultDurationMinutes) {
    const endMs = startMs + template.defaultDurationMinutes * 60_000;
    draft.event.endAt = new Date(endMs).toISOString();
  }

  if (template.special === 'wake' || template.special === 'sleep') {
    draft.setWakeOrSleep = template.special;
  }

  return draft;
}

export function defaultStarterTemplates(): Template[] {
  const now = new Date().toISOString();
  return [
    {
      id: 'template-wake-up',
      name: 'Wake up',
      title: 'Wake up',
      defaultDurationMinutes: undefined,
      tagIds: [],
      special: 'wake',
      isPinned: true,
      sortOrder: 0,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    },
    {
      id: 'template-breakfast',
      name: 'Breakfast',
      title: 'Breakfast',
      defaultDurationMinutes: 30,
      tagIds: [],
      isPinned: true,
      sortOrder: 1,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    },
    {
      id: 'template-lunch',
      name: 'Lunch',
      title: 'Lunch',
      defaultDurationMinutes: 45,
      tagIds: [],
      isPinned: true,
      sortOrder: 2,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    },
    {
      id: 'template-dinner',
      name: 'Dinner',
      title: 'Dinner',
      defaultDurationMinutes: 45,
      tagIds: [],
      isPinned: true,
      sortOrder: 3,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    },
    {
      id: 'template-brush-teeth',
      name: 'Brush teeth',
      title: 'Brush teeth',
      defaultDurationMinutes: 5,
      tagIds: [],
      isPinned: true,
      sortOrder: 4,
      createdAt: now,
      updatedAt: now,
      isDeleted: false,
    },
  ];
}
