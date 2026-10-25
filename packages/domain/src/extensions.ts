import { Suggestion } from './types.js';

/**
 * An extension registers the tags, dimensions and tables it owns. The core
 * never absorbs extension data; modules attach by reference and propose
 * Suggestions instead of writing Events directly.
 */
export interface ExtensionRegistration {
  id: string;
  name: string;
  version: string;
  /** Tag paths the extension may create, e.g. "calendar". */
  tags: string[];
  /** Observation dimensions the extension writes. */
  dimensions: string[];
  /** Extension-owned tables, never core tables. */
  tables: string[];
}

export const CALENDAR_EXTENSION: ExtensionRegistration = {
  id: 'calendar',
  name: 'Calendar',
  version: '1.0.0',
  tags: ['calendar'],
  dimensions: [],
  tables: ['calendar_items'],
};

export const BUILT_IN_EXTENSIONS: readonly ExtensionRegistration[] = [CALENDAR_EXTENSION];

function validateRegistration(registration: ExtensionRegistration): void {
  if (!/^[a-z][a-z0-9_-]*$/.test(registration.id)) {
    throw new Error(`Invalid extension id: ${registration.id}`);
  }
  if (!registration.name.trim()) {
    throw new Error(`Extension ${registration.id} must have a name`);
  }
  if (!registration.version.trim()) {
    throw new Error(`Extension ${registration.id} must have a version`);
  }

  const uniqueLists: Array<[string, string[]]> = [
    ['tags', registration.tags],
    ['dimensions', registration.dimensions],
    ['tables', registration.tables],
  ];
  for (const [label, values] of uniqueLists) {
    if (new Set(values).size !== values.length) {
      throw new Error(`Extension ${registration.id} declares duplicate ${label}`);
    }
  }
}

export class ExtensionRegistry {
  private readonly extensions = new Map<string, ExtensionRegistration>();

  register(registration: ExtensionRegistration): void {
    validateRegistration(registration);
    if (this.extensions.has(registration.id)) {
      throw new Error(`Extension already registered: ${registration.id}`);
    }
    this.extensions.set(registration.id, {
      ...registration,
      tags: [...registration.tags],
      dimensions: [...registration.dimensions],
      tables: [...registration.tables],
    });
  }

  get(id: string): ExtensionRegistration | undefined {
    return this.extensions.get(id);
  }

  list(): ExtensionRegistration[] {
    return Array.from(this.extensions.values()).sort((a, b) => a.id.localeCompare(b.id));
  }
}

export function createDefaultExtensionRegistry(): ExtensionRegistry {
  const registry = new ExtensionRegistry();
  for (const extension of BUILT_IN_EXTENSIONS) {
    registry.register(extension);
  }
  return registry;
}

/**
 * The only core write surface offered to extensions. Implementations persist
 * the suggestion and leave timeline mutations to an explicit user acceptance.
 */
export interface SuggestionWriter {
  propose(suggestion: Suggestion): Promise<void>;
  proposeBatch(suggestions: Suggestion[]): Promise<void>;
}
