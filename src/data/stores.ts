// Four small stores over chrome.storage.local, plus an in-memory double of the same shape for tests.
/**
 * No storage.sync — a technician's learned mappings and captured service ids
 * are machine-local, and syncing them would put desk data on Google's
 * servers, which the design forbids.
 *
 * There is deliberately no requestor store. Requestor fields include student
 * records; they live in panel memory (Task 15) and die with the page.
 */

import type { Example, LearnedStore, Settings, SettingsStore, Stores, Template } from '../types.ts';

export const DEFAULT_SETTINGS: Settings = { threshold: 0.35, overwrite: false, diagnostics: false };

const KEYS = {
  templates: 'tdxa.templates',
  examples: 'tdxa.examples',
  learned: 'tdxa.learned',
  settings: 'tdxa.settings',
} as const;

/** The slice of chrome.storage.local this module calls — narrow enough that no @types/chrome dependency is needed. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

function defaultArea(): StorageArea | undefined {
  // The one place a bare global is read. globalThis has no ambient chrome
  // type without @types/chrome, so this is typed by hand and left undefined
  // outside a real extension (tests always pass an area explicitly).
  const g = globalThis as { chrome?: { storage?: { local?: StorageArea } } };
  return g.chrome?.storage?.local;
}

async function readValue<T>(area: StorageArea, key: string, fallback: T): Promise<T> {
  const bag = await area.get(key);
  // The store owns everything ever written under `key`; this cast declares
  // that contract rather than hiding an unrelated type error.
  return (bag[key] as T | undefined) ?? fallback;
}

function writeValue(area: StorageArea, key: string, value: unknown): Promise<void> {
  return area.set({ [key]: value });
}

/** A save-by-id, remove-by-id list, generic over templates and examples alike. */
function collection<T extends { id: string }>(area: StorageArea, key: string) {
  return {
    async list(): Promise<T[]> {
      return readValue(area, key, [] as T[]);
    },
    async save(item: T): Promise<T> {
      // Copy so a caller mutating their object after save() can't reach back
      // into the store — chrome.storage.local would drop this aliasing for
      // free via structured clone; the in-memory double below does not.
      const record = { ...item };
      const items = await readValue(area, key, [] as T[]);
      const index = items.findIndex((existing) => existing.id === record.id);
      if (index === -1) items.push(record);
      else items[index] = record;
      await writeValue(area, key, items);
      return record;
    },
    async remove(id: string): Promise<void> {
      const items = await readValue(area, key, [] as T[]);
      await writeValue(area, key, items.filter((item) => item.id !== id));
    },
  };
}

function newId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function learnedStore(area: StorageArea): LearnedStore {
  return {
    async get(signature) {
      const all = await readValue(area, KEYS.learned, {} as Record<string, Record<string, string>>);
      return all[signature] ?? {};
    },
    async set(signature, mapping) {
      const all = await readValue(area, KEYS.learned, {} as Record<string, Record<string, string>>);
      all[signature] = { ...(all[signature] ?? {}), ...mapping };
      await writeValue(area, KEYS.learned, all);
    },
    async clearAll() {
      await writeValue(area, KEYS.learned, {});
    },
  };
}

function settingsStore(area: StorageArea): SettingsStore {
  return {
    async get() {
      const stored = await readValue(area, KEYS.settings, {} as Partial<Settings>);
      return { ...DEFAULT_SETTINGS, ...stored };
    },
    async patch(partial) {
      const stored = await readValue(area, KEYS.settings, {} as Partial<Settings>);
      await writeValue(area, KEYS.settings, { ...stored, ...partial });
    },
  };
}

export function createStores(area: StorageArea | undefined = defaultArea()): Stores {
  if (!area) {
    throw new Error('createStores: no storage area available — pass one explicitly (e.g. createMemoryArea() in tests)');
  }

  const templates = collection<Template>(area, KEYS.templates);
  const examples = collection<Example>(area, KEYS.examples);

  return {
    templates,
    examples: {
      list: examples.list,
      remove: examples.remove,
      async add(example) {
        return examples.save({ id: newId(), savedAt: new Date().toISOString(), ...example });
      },
    },
    learned: learnedStore(area),
    settings: settingsStore(area),
  };
}

/**
 * chrome.storage-shaped object backed by a Map, for tests.
 *
 * Real chrome.storage.local takes ownership of what it's given and hands
 * back its own copy of what it holds — structured-cloning on both set and
 * get. structuredClone on both sides matches that: without it, a caller
 * could mutate a value it just read (or just wrote) and silently corrupt
 * what's "stored", which real chrome.storage never allows.
 */
export function createMemoryArea(): StorageArea {
  const data = new Map<string, unknown>();
  return {
    async get(key) {
      return data.has(key) ? { [key]: structuredClone(data.get(key)) } : {};
    },
    async set(items) {
      for (const [key, value] of Object.entries(items)) data.set(key, structuredClone(value));
    },
  };
}
