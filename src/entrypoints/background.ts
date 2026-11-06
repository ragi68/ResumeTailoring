import type { BackgroundApi } from '@/lib/backgroundApi';
import { createClient } from '@/lib/llm/client';
import { analyzeJd, selectContent, suggestRewrites } from '@/lib/llm/pipeline';
import { listen, type Handlers } from '@/lib/messaging';
import { modelFor } from '@/lib/schemas';
import { getApiKey, parseKey } from '@/lib/storage';

/** API key and model names are read fresh for every call so Settings changes apply immediately. */
async function llm() {
  const [apiKey, rawSettings] = await Promise.all([getApiKey(), chrome.storage.local.get('settings')]);
  const settings = parseKey('settings', rawSettings['settings']).value;
  return { client: createClient({ apiKey }), settings };
}
import { TARGET_TAB_KEY, isCandidateTab } from '@/lib/targetTab';

/** frames:<tabId> -> frameIds that announced a content script. Kept in session storage to survive worker restarts. */
const framesKey = (tabId: number) => `frames:${tabId}`;
let registryQueue: Promise<unknown> = Promise.resolve();

function updateFrames(tabId: number, fn: (frames: number[]) => number[]): Promise<number[]> {
  const run = registryQueue.then(async () => {
    const key = framesKey(tabId);
    const current = ((await chrome.storage.session.get(key))[key] as number[] | undefined) ?? [];
    const next = fn(current);
    await chrome.storage.session.set({ [key]: next });
    return next;
  });
  registryQueue = run.catch(() => undefined);
  return run;
}

async function rememberTarget(tabId: number): Promise<void> {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (isCandidateTab(tab)) await chrome.storage.session.set({ [TARGET_TAB_KEY]: tabId });
  } catch {
    /* tab closed */
  }
}

export default defineBackground(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  // Track the last focused web page so the expanded (full tab) view knows where to attach.
  chrome.tabs.onActivated.addListener(({ tabId }) => void rememberTarget(tabId));
  chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (info.status === 'loading' && info.url) void updateFrames(tabId, () => []);
    if (tab.active && info.status === 'complete') void rememberTarget(tabId);
  });
  chrome.tabs.onRemoved.addListener((tabId) => void chrome.storage.session.remove(framesKey(tabId)));

  const handlers: Handlers<BackgroundApi> = {
    async PING() {
      return { pong: true };
    },
    async FRAME_HELLO(_req, sender) {
      const tabId = sender.tab?.id;
      const frameId = sender.frameId;
      if (tabId === undefined || frameId === undefined) return { registered: false };
      await updateFrames(tabId, (f) => (f.includes(frameId) ? f : [...f, frameId]));
      return { registered: true };
    },
    async GET_FRAMES(req) {
      const key = framesKey(req.tabId);
      return ((await chrome.storage.session.get(key))[key] as number[] | undefined) ?? [];
    },
    async LLM_ANALYZE(req) {
      const { client, settings } = await llm();
      return analyzeJd(client, modelFor(settings, 'analyze'), req.jdText, { title: req.title, company: req.company });
    },
    async LLM_SELECT(req) {
      const { client, settings } = await llm();
      return selectContent(client, modelFor(settings, 'tailor'), {
        analysis: req.analysis,
        master: req.master,
        pins: req.pins,
        settings: { lineBudget: req.lineBudget, pageLimit: req.pageLimit },
      });
    },
    async LLM_REWRITE(req) {
      const { client, settings } = await llm();
      return suggestRewrites(client, modelFor(settings, 'tailor'), req);
    },
  };
  listen<BackgroundApi>(handlers);
});
