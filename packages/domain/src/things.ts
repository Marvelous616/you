import { EventThing, TypeDefinition, UUID } from './types.js';

export interface TypeDefinitionDraft {
  name: string;
  fieldType: string;
  schema?: Record<string, unknown>;
}

export interface TypeInstanceDraft {
  typeDefinitionId: UUID;
  subjectType?: 'event';
  subjectId?: UUID;
  value: Record<string, unknown>;
}

/**
 * Validates a TypeDefinition draft. Things are intentionally schema-less at
 * the storage layer (values are JSON), so only the essentials are enforced here.
 */
export function validateTypeDefinitionDraft(draft: TypeDefinitionDraft): string | null {
  if (!draft || typeof draft.name !== 'string' || draft.name.trim().length === 0) {
    return 'TypeDefinition name is required';
  }
  if (typeof draft.fieldType !== 'string' || draft.fieldType.trim().length === 0) {
    return 'TypeDefinition fieldType is required';
  }
  if (draft.schema !== undefined && draft.schema !== null) {
    try {
      JSON.stringify(draft.schema);
    } catch {
      return 'TypeDefinition schema must be valid JSON';
    }
  }
  return null;
}

/**
 * Validates a TypeInstance before it is attached to a subject event.
 */
export function validateTypeInstance(
  instance: TypeInstanceDraft,
  typeDefinitions: TypeDefinition[] = []
): string | null {
  if (!instance.typeDefinitionId) {
    return 'TypeInstance typeDefinitionId is required';
  }
  const typeDefinition = typeDefinitions.find((td) => td.id === instance.typeDefinitionId);
  if (!typeDefinition) {
    return `Unknown TypeDefinition: ${instance.typeDefinitionId}`;
  }
  if (instance.subjectType && instance.subjectType !== 'event') {
    return `Unsupported subjectType: ${instance.subjectType}`;
  }
  if (!instance.subjectId) {
    return 'TypeInstance subjectId is required';
  }
  const keys = Object.keys(instance.value ?? {});
  if (keys.length === 0) {
    return 'TypeInstance value must not be empty';
  }
  return null;
}

export function buildEventThing(
  draft: TypeInstanceDraft,
  options: { id?: UUID; now?: Date } = {}
): EventThing {
  const now = (options.now ?? new Date()).toISOString();

  return {
    id: options.id ?? `thing-${now}-${Math.random().toString(36).slice(2, 8)}`,
    eventId: draft.subjectId as UUID,
    typeDefinitionId: draft.typeDefinitionId,
    value: draft.value ?? {},
    createdAt: now,
    updatedAt: now,
    isDeleted: false,
  };
}
