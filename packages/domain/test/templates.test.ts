import { describe, it, expect } from 'vitest';
import {
  buildTemplate,
  patchTemplate,
  templateToEventDraft,
  defaultStarterTemplates,
} from '@life-logger/domain';
import { Template } from '@life-logger/domain';

describe('buildTemplate', () => {
  const now = new Date('2026-01-15T10:00:00.000Z');

  it('creates a template with all fields', () => {
    const t = buildTemplate(
      {
        name: 'Wake up',
        title: 'Wake up',
        defaultDurationMinutes: undefined,
        tagIds: [],
        special: 'wake',
        isPinned: true,
        sortOrder: 0,
      },
      { id: 't1', now }
    );

    expect(t.id).toBe('t1');
    expect(t.name).toBe('Wake up');
    expect(t.title).toBe('Wake up');
    expect(t.defaultDurationMinutes).toBeUndefined();
    expect(t.tagIds).toEqual([]);
    expect(t.special).toBe('wake');
    expect(t.isPinned).toBe(true);
    expect(t.sortOrder).toBe(0);
    expect(t.createdAt).toBe(now.toISOString());
    expect(t.updatedAt).toBe(now.toISOString());
    expect(t.isDeleted).toBe(false);
  });

  it('generates an ID from name when not provided', () => {
    const t = buildTemplate({ name: 'My Template', title: 'My Template' });
    expect(t.id).toBe('template-my-template');
  });

  it('defaults isPinned to false and sortOrder to 0', () => {
    const t = buildTemplate({ name: 'Test', title: 'Test' });
    expect(t.isPinned).toBe(false);
    expect(t.sortOrder).toBe(0);
  });
});

describe('patchTemplate', () => {
  const template: Template = {
    id: 't1',
    name: 'Wake up',
    title: 'Wake up',
    defaultDurationMinutes: undefined,
    tagIds: [],
    special: 'wake',
    isPinned: true,
    sortOrder: 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    isDeleted: false,
  };

  it('patches individual fields', () => {
    const updated = patchTemplate(template, {
      name: 'Wake Up',
      title: 'Wake Up Early',
    });
    expect(updated.name).toBe('Wake Up');
    expect(updated.title).toBe('Wake Up Early');
    expect(updated.defaultDurationMinutes).toBeUndefined();
    expect(updated.special).toBe('wake');
    expect(updated.updatedAt).not.toBe(template.updatedAt);
  });

  it('clears defaultDurationMinutes when set to null', () => {
    const templateWithDuration: Template = { ...template, defaultDurationMinutes: 30, special: undefined };
    const updated = patchTemplate(templateWithDuration, {
      defaultDurationMinutes: null,
    });
    expect(updated.defaultDurationMinutes).toBeUndefined();
  });

  it('clears special when set to null', () => {
    const updated = patchTemplate(template, { special: null });
    expect(updated.special).toBeUndefined();
  });
});

describe('templateToEventDraft', () => {
  const now = new Date('2026-01-15T10:00:00.000Z');

  const templateWithDuration: Template = {
    id: 't1',
    name: 'Lunch',
    title: 'Lunch',
    defaultDurationMinutes: 45,
    tagIds: ['t-food'],
    special: undefined,
    isPinned: false,
    sortOrder: 1,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    isDeleted: false,
  };

  const templatePoint: Template = {
    id: 't2',
    name: 'Wake up',
    title: 'Wake up',
    defaultDurationMinutes: undefined,
    tagIds: [],
    special: 'wake',
    isPinned: true,
    sortOrder: 0,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    isDeleted: false,
  };

  it('sets endAt from defaultDurationMinutes', () => {
    const draft = templateToEventDraft(templateWithDuration, '2026-01-15T12:00:00.000Z');
    expect(draft.event.title).toBe('Lunch');
    expect(draft.event.startAt).toBe('2026-01-15T12:00:00.000Z');
    expect(draft.event.endAt).toBe('2026-01-15T12:45:00.000Z');
    expect(draft.tagIds).toEqual(['t-food']);
  });

  it('creates a point event when no duration', () => {
    const draft = templateToEventDraft(templatePoint, '2026-01-15T07:00:00.000Z');
    expect(draft.event.title).toBe('Wake up');
    expect(draft.event.startAt).toBe('2026-01-15T07:00:00.000Z');
    expect(draft.event.endAt).toBeUndefined();
    expect(draft.setWakeOrSleep).toBe('wake');
  });

  it('marks sleep template for sleep time', () => {
    const sleepTemplate: Template = { ...templatePoint, special: 'sleep', title: 'Sleep' };
    const draft = templateToEventDraft(sleepTemplate, '2026-01-15T23:00:00.000Z');
    expect(draft.event.title).toBe('Sleep');
    expect(draft.event.endAt).toBeUndefined();
    expect(draft.setWakeOrSleep).toBe('sleep');
  });

  it('throws on invalid start time', () => {
    expect(() => templateToEventDraft(templateWithDuration, 'not-a-time')).toThrow(
      /Invalid template start time/
    );
  });
});

describe('defaultStarterTemplates', () => {
  it('returns 5 starter templates', () => {
    const templates = defaultStarterTemplates();
    expect(templates.length).toBe(5);
  });

  it('has no duplicate IDs', () => {
    const templates = defaultStarterTemplates();
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('has wake and sleep templates', () => {
    const templates = defaultStarterTemplates();
    const wake = templates.find((t) => t.special === 'wake');
    const sleep = templates.find((t) => t.special === 'sleep');
    expect(wake).toBeDefined();
    expect(wake?.name).toBe('Wake up');
    expect(sleep).toBeUndefined(); // No sleep template in starter set
  });

  it('all templates are pinned', () => {
    const templates = defaultStarterTemplates();
    templates.forEach((t) => expect(t.isPinned).toBe(true));
  });

  it('has sort orders 0-4', () => {
    const templates = defaultStarterTemplates();
    const sortOrders = templates.map((t) => t.sortOrder).sort();
    expect(sortOrders).toEqual([0, 1, 2, 3, 4]);
  });
});
