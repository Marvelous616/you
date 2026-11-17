import { describe, it, expect } from 'vitest';
import {
  buildEventThing,
  validateTypeDefinitionDraft,
  validateTypeInstance,
} from '@life-logger/domain';
import { TypeDefinition } from '@life-logger/domain';

describe('Things: type definitions and event things rules', () => {
  describe('validateTypeDefinitionDraft', () => {
    it('accepts a valid draft', () => {
      expect(
        validateTypeDefinitionDraft({ name: 'Sleep', fieldType: 'number', schema: { unit: 'hours' } })
      ).toBeNull();
    });

    it('rejects a missing name', () => {
      expect(validateTypeDefinitionDraft({ name: '', fieldType: 'number' })).not.toBeNull();
    });

    it('rejects a missing field type', () => {
      expect(validateTypeDefinitionDraft({ name: 'Sleep', fieldType: '' })).not.toBeNull();
    });
  });

  describe('validateTypeInstance', () => {
    const typeDefinitions: TypeDefinition[] = [
      {
        id: 'type-1',
        name: 'Sleep',
        fieldType: 'number',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        isDeleted: false,
      },
    ];

    it('accepts a well-formed event instance', () => {
      expect(
        validateTypeInstance(
          { typeDefinitionId: 'type-1', subjectType: 'event', subjectId: 'event-1', value: { hours: 7.5 } },
          typeDefinitions
        )
      ).toBeNull();
    });

    it('rejects an unknown type definition', () => {
      expect(
        validateTypeInstance(
          { typeDefinitionId: 'type-missing', subjectType: 'event', subjectId: 'event-1', value: { hours: 7.5 } },
          typeDefinitions
        )
      ).not.toBeNull();
    });

    it('rejects an unsupported subject type', () => {
      expect(
        validateTypeInstance(
          { typeDefinitionId: 'type-1', subjectType: 'person', subjectId: 'p-1', value: { hours: 7.5 } },
          typeDefinitions
        )
      ).not.toBeNull();
    });

    it('rejects an empty value', () => {
      expect(
        validateTypeInstance(
          { typeDefinitionId: 'type-1', subjectType: 'event', subjectId: 'event-1', value: {} },
          typeDefinitions
        )
      ).not.toBeNull();
    });
  });

  describe('buildEventThing', () => {
    it('builds a thing bound to an event', () => {
      const thing = buildEventThing(
        { typeDefinitionId: 'type-1', subjectType: 'event', subjectId: 'event-1', value: { hours: 7.5 } },
        { now: new Date('2026-01-01T08:00:00.000Z') }
      );
      expect(thing.eventId).toBe('event-1');
      expect(thing.typeDefinitionId).toBe('type-1');
      expect(thing.value).toEqual({ hours: 7.5 });
      expect(thing.isDeleted).toBe(false);
      expect(thing.updatedAt).toBe('2026-01-01T08:00:00.000Z');
    });
  });
});
