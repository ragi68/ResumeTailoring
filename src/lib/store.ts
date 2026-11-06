/**
 * App state (Zustand). Persisted slices are mirrored to chrome.storage.local, and changes made in
 * another extension page (side panel <-> expanded tab <-> options) flow back in via storage.onChanged.
 */
import { create } from 'zustand';
import type { MasterResume, Selection, Settings } from './schemas';
import { reconcileSelection } from './selection';
import { PERSISTED_KEYS, loadAll, parseKey, saveKey, type PersistedKey, type PersistedState } from './storage';

export interface AppState extends PersistedState {
  hydrated: boolean;
  loadErrors: string[];
  mutateMaster(fn: (draft: MasterResume) => void): void;
  replaceMaster(master: MasterResume): void;
  updateSettings(patch: Partial<Settings>): void;
  togglePin(id: string): void;
  upsertSelection(sel: Selection): void;
  mutateSelection(id: string, fn: (draft: Selection) => void): void;
  deleteSelection(id: string): void;
  setActiveSelection(id: string | null): void;
  dismissLoadErrors(): void;
}

export const useApp = create<AppState>()((set, get) => ({
  master: { version: 1, header: { name: '', email: '', phone: '', location: '', links: [] }, summaries: [], experience: [], projects: [], skillGroups: [], education: [] },
  selections: {},
  activeSelectionId: null,
  settings: parseKey('settings', undefined).value,
  pins: [],
  hydrated: false,
  loadErrors: [],

  mutateMaster(fn) {
    const draft = structuredClone(get().master);
    fn(draft);
    set({ master: draft });
  },
  replaceMaster(master) {
    set({ master });
  },
  updateSettings(patch) {
    set({ settings: { ...get().settings, ...patch } });
  },
  togglePin(id) {
    const pins = get().pins;
    set({ pins: pins.includes(id) ? pins.filter((p) => p !== id) : [...pins, id] });
  },
  upsertSelection(sel) {
    set({ selections: { ...get().selections, [sel.id]: sel } });
  },
  mutateSelection(id, fn) {
    const current = get().selections[id];
    if (!current) return;
    const draft = structuredClone(current);
    fn(draft);
    draft.updatedAt = Date.now();
    set({ selections: { ...get().selections, [id]: draft } });
  },
  deleteSelection(id) {
    const { [id]: _removed, ...rest } = get().selections;
    set({ selections: rest, activeSelectionId: get().activeSelectionId === id ? null : get().activeSelectionId });
  },
  setActiveSelection(id) {
    set({ activeSelectionId: id });
  },
  dismissLoadErrors() {
    set({ loadErrors: [] });
  },
}));

// ---------------- persistence & cross-page sync ----------------

const lastSynced: Partial<Record<PersistedKey, string>> = {};
const timers: Partial<Record<PersistedKey, ReturnType<typeof setTimeout>>> = {};
let applyingRemote = false;
let started = false;

function scheduleWrite<K extends PersistedKey>(key: K, value: PersistedState[K]) {
  const json = JSON.stringify(value);
  if (lastSynced[key] === json) return;
  clearTimeout(timers[key]);
  timers[key] = setTimeout(() => {
    lastSynced[key] = json;
    void saveKey(key, value);
  }, 200);
}

/** Load persisted state and start syncing. Call once per extension page. */
export async function startStore(): Promise<void> {
  if (started) return;
  started = true;
  const { state, errors } = await loadAll();
  for (const k of PERSISTED_KEYS) lastSynced[k] = JSON.stringify(state[k]);
  useApp.setState({ ...state, hydrated: true, loadErrors: errors });

  // Keep saved selections consistent with the master (deleted items dropped, new ones appended).
  const reconcileAll = () => {
    const { master, selections } = useApp.getState();
    let changed = false;
    const next: Record<string, Selection> = {};
    for (const [id, sel] of Object.entries(selections)) {
      const r = reconcileSelection(sel, master);
      if (JSON.stringify(r) !== JSON.stringify(sel)) changed = true;
      next[id] = r;
    }
    if (changed) useApp.setState({ selections: next });
  };
  reconcileAll();
  useApp.subscribe((s, prev) => {
    if (s.master !== prev.master) reconcileAll();
  });

  useApp.subscribe((s, prev) => {
    if (!s.hydrated || applyingRemote) return;
    for (const k of PERSISTED_KEYS) {
      if (s[k] !== prev[k]) scheduleWrite(k, s[k]);
    }
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    const patch: Partial<PersistedState> = {};
    for (const k of PERSISTED_KEYS) {
      const change = changes[k];
      if (!change) continue;
      const json = JSON.stringify(change.newValue);
      if (json === lastSynced[k]) continue; // our own write echoing back
      lastSynced[k] = json;
      clearTimeout(timers[k]); // remote wins over a pending local write of the same key
      (patch as Record<PersistedKey, unknown>)[k] = parseKey(k, change.newValue).value;
    }
    if (Object.keys(patch).length) {
      applyingRemote = true;
      useApp.setState(patch);
      applyingRemote = false;
    }
  });
}

/** Flush pending writes (e.g. before tests or page unload). */
export function flushStore(): void {
  const s = useApp.getState();
  for (const k of PERSISTED_KEYS) {
    if (timers[k]) {
      clearTimeout(timers[k]);
      timers[k] = undefined;
      lastSynced[k] = JSON.stringify(s[k]);
      void saveKey(k, s[k]);
    }
  }
}
