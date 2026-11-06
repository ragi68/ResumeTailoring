/** chrome.storage.local persistence with Zod validation on every read. */
import { z } from 'zod';
import {
  DEFAULT_SETTINGS,
  MasterResumeSchema,
  PinsSchema,
  SelectionSchema,
  SettingsSchema,
  type MasterResume,
  type Selection,
  type Settings,
} from './schemas';
import { SEED_MASTER } from './seed';

export interface PersistedState {
  master: MasterResume;
  selections: Record<string, Selection>;
  activeSelectionId: string | null;
  settings: Settings;
  pins: string[];
}

export type PersistedKey = keyof PersistedState;
export const PERSISTED_KEYS: PersistedKey[] = ['master', 'selections', 'activeSelectionId', 'settings', 'pins'];

export const API_KEY_STORAGE_KEY = 'anthropicApiKey';

const SelectionsSchema = z.record(z.string(), SelectionSchema);

/** Parse a stored value; on failure return the default and an error description. */
type Parser<K extends PersistedKey> = (raw: unknown) => { value: PersistedState[K]; error?: string };

function describe(err: z.ZodError): string {
  return err.issues
    .slice(0, 3)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

export const PARSERS: { [K in PersistedKey]: Parser<K> } = {
  master(raw) {
    if (raw === undefined) return { value: structuredClone(SEED_MASTER) };
    const r = MasterResumeSchema.safeParse(raw);
    return r.success ? { value: r.data } : { value: structuredClone(SEED_MASTER), error: `Master resume invalid (${describe(r.error)}). Showing the sample until you import a valid one.` };
  },
  selections(raw) {
    if (raw === undefined) return { value: {} };
    if (typeof raw !== 'object' || raw === null) return { value: {}, error: 'Saved jobs were unreadable and were reset.' };
    // Keep each valid selection even if one is corrupt.
    const out: Record<string, Selection> = {};
    let dropped = 0;
    for (const [id, v] of Object.entries(raw)) {
      const r = SelectionSchema.safeParse(v);
      if (r.success) out[id] = r.data;
      else dropped++;
    }
    return dropped ? { value: out, error: `${dropped} saved job(s) were unreadable and were skipped.` } : { value: out };
  },
  activeSelectionId(raw) {
    return { value: typeof raw === 'string' ? raw : null };
  },
  settings(raw) {
    if (raw === undefined) return { value: DEFAULT_SETTINGS };
    const merged: unknown = typeof raw === 'object' && raw !== null ? { ...DEFAULT_SETTINGS, ...raw } : raw;
    const r = SettingsSchema.safeParse(merged);
    return r.success ? { value: r.data } : { value: DEFAULT_SETTINGS, error: `Settings invalid (${describe(r.error)}); using defaults.` };
  },
  pins(raw) {
    const r = PinsSchema.safeParse(raw ?? []);
    return { value: r.success ? r.data : [] };
  },
};

export function parseKey<K extends PersistedKey>(key: K, raw: unknown): { value: PersistedState[K]; error?: string } {
  return PARSERS[key](raw);
}

export async function loadAll(): Promise<{ state: PersistedState; errors: string[] }> {
  const raw = await chrome.storage.local.get(PERSISTED_KEYS);
  const errors: string[] = [];
  const read = <K extends PersistedKey>(k: K): PersistedState[K] => {
    const r = parseKey(k, raw[k]);
    if (r.error) errors.push(r.error);
    return r.value;
  };
  return {
    state: {
      master: read('master'),
      selections: read('selections'),
      activeSelectionId: read('activeSelectionId'),
      settings: read('settings'),
      pins: read('pins'),
    },
    errors,
  };
}

export async function saveKey<K extends PersistedKey>(key: K, value: PersistedState[K]): Promise<void> {
  await chrome.storage.local.set({ [key]: value });
}

export async function getApiKey(): Promise<string> {
  const v = (await chrome.storage.local.get(API_KEY_STORAGE_KEY))[API_KEY_STORAGE_KEY];
  return typeof v === 'string' ? v : '';
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [API_KEY_STORAGE_KEY]: key.trim() });
}

/** Validate an imported master JSON file. */
export function parseMasterImport(json: string): { ok: true; master: MasterResume } | { ok: false; error: string } {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${e instanceof Error ? e.message : String(e)}` };
  }
  const r = MasterResumeSchema.safeParse(data);
  return r.success ? { ok: true, master: r.data } : { ok: false, error: describe(r.error) };
}
