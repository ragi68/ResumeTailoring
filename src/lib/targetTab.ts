/** Which browser tab the panel acts on (JD capture, attach). */

export const TARGET_TAB_KEY = 'targetTabId';

export function isWebUrl(url: string | undefined): url is string {
  return !!url && /^https?:\/\//.test(url);
}

/**
 * Chrome hides `tab.url` from extensions on sites they have no access to, so an unknown URL
 * usually means "a web page we haven't been granted yet". Our own pages and chrome:// pages are skipped.
 */
export function isCandidateTab(tab: chrome.tabs.Tab): boolean {
  if (tab.id === undefined || tab.id === chrome.tabs.TAB_ID_NONE) return false;
  const url = tab.url ?? tab.pendingUrl;
  if (!url) return true;
  return isWebUrl(url);
}

/**
 * In the side panel: the active tab of this window. In the expanded tab (an extension page),
 * fall back to the last web tab the user focused, tracked by the background worker.
 */
export async function getTargetTab(): Promise<chrome.tabs.Tab | null> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active && isCandidateTab(active)) return active;
  const stored = (await chrome.storage.session.get(TARGET_TAB_KEY))[TARGET_TAB_KEY] as number | undefined;
  if (stored === undefined) return null;
  try {
    const tab = await chrome.tabs.get(stored);
    return isCandidateTab(tab) ? tab : null;
  } catch {
    return null;
  }
}
